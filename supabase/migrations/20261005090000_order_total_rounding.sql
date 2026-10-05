-- ---------- Arrondi automatique du total encaissé (option par boutique) ----------
-- Besoin : certaines boutiques encaissent à la livraison et préfèrent des montants ronds.
-- Règle retenue : un total entier se terminant par 9 (49 -> 50, 189 -> 190) et un total dont
-- les centimes valent exactement 99 (48,99 -> 49, 199,99 -> 200) sont arrondis à l'unité
-- supérieure. Tout autre montant reste inchangé.
--   * l'option vit sur la boutique (`stores.round_order_total`), désactivée par défaut ;
--   * l'arrondi est un écart explicite stocké sur la commande (`orders.rounding_adjustment`) :
--     `orders.total_selling_price` reste le montant réellement à encaisser ;
--   * seuls le total bougent : sous-total, remise et frais de livraison sont inchangés ;
--   * la facture reprend l'écart dans une colonne dédiée (`invoices.rounding_ttc`) pour rester
--     cohérente avec le contrôle `INVOICE_TOTAL_MISMATCH` (aucune base HT/TVA facturée en plus).
-- Idempotent.

alter table public.stores
  add column if not exists round_order_total boolean not null default false;

comment on column public.stores.round_order_total is
  'Arrondi automatique du total encaissé des commandes reçues : 49 -> 50, 48,99 -> 49, 99 -> 100. Désactivé par défaut.';

alter table public.orders
  add column if not exists rounding_adjustment numeric(12,2) not null default 0;

comment on column public.orders.rounding_adjustment is
  'Écart d''arrondi appliqué au total de la commande (0,01 ou 1). total_selling_price inclut déjà cet écart.';

alter table public.orders
  drop constraint if exists orders_rounding_adjustment_check;

alter table public.orders
  add constraint orders_rounding_adjustment_check
  check (rounding_adjustment >= 0 and rounding_adjustment <= 1);

alter table public.invoices
  add column if not exists rounding_ttc numeric(12,2) not null default 0;

comment on column public.invoices.rounding_ttc is
  'Écart d''arrondi du total de la commande, repris tel quel dans total_ttc (aucune base HT/TVA).';

-- ---------- La liste des stores expose l'option ----------
-- Le type de retour change : la fonction doit être recréée (aucun objet ne dépend d'elle).
drop function if exists public.get_my_stores();

create or replace function public.get_my_stores()
returns table(
  id uuid,
  name text,
  logo_url text,
  currency text,
  country text,
  role text,
  round_order_total boolean
)
language plpgsql
security definer
as $function$
begin
  return query
  select s.id, s.name, s.logo_url, s.currency, s.country, sm.role::text, s.round_order_total
  from stores s
  join store_members sm on sm.store_id = s.id
  where sm.user_id = auth.uid()
    and sm.status = 'active'
  order by s.created_at asc;
end;
$function$;

revoke all on function public.get_my_stores() from public;
revoke all on function public.get_my_stores() from anon;
grant execute on function public.get_my_stores() to authenticated, service_role;

comment on function public.get_my_stores() is
  'Stores actifs de l''utilisateur courant (nom, devise, pays, rôle, arrondi des totaux).';

-- ---------- Ingestion API custom : la commande porte l'écart d'arrondi ----------
-- Le total envoyé par le site est déjà arrondi côté serveur Jisra ; l'écart doit être persisté
-- sur la commande, sinon la facture ne pourrait plus justifier le total encaissé.
do $migration$
declare
  v_def text;
  v_def_new text;
begin
  select pg_get_functiondef('public.rpc_ingest_public_order(uuid, uuid, text, text, jsonb, jsonb)'::regprocedure)
    into v_def;

  if coalesce(btrim(v_def), '') = '' then
    raise exception 'RPC_INTROUVABLE: public.rpc_ingest_public_order';
  end if;

  if position('rounding_adjustment' in v_def) > 0 then
    raise notice 'rpc_ingest_public_order : ecart d''arrondi deja accepte';
    return;
  end if;

  v_def_new := replace(
    v_def,
    E'    total_selling_price,\n    delivery_charge_to_customer,\n',
    E'    total_selling_price,\n    delivery_charge_to_customer,\n    rounding_adjustment,\n'
  );

  v_def_new := replace(
    v_def_new,
    E'    coalesce((p_order->>''delivery_charge_to_customer'')::numeric, 0),\n',
    E'    coalesce((p_order->>''delivery_charge_to_customer'')::numeric, 0),\n    coalesce((p_order->>''rounding_adjustment'')::numeric, 0),\n'
  );

  if position(E'    rounding_adjustment,\n' in v_def_new) = 0
     or position(E'(p_order->>''rounding_adjustment'')' in v_def_new) = 0 then
    raise exception 'CORRECTIF_NON_APPLIQUE: public.rpc_ingest_public_order';
  end if;

  execute v_def_new;
end
$migration$;

-- ---------- Facture : l'ecart d'arrondi est repris tel quel dans le total ----------
-- `invoices.total_ttc` doit rester egal au montant encaisse : l'ecart est ajoute au TTC sans
-- toucher a la base HT/TVA, et le controle de coherence l'accepte comme un ajustement connu.
do $migration$
declare
  v_def text;
  v_def_new text;
  v_pairs jsonb;
  v_pair jsonb;
  v_anchor text;
  v_repl text;
  v_occurrences int;
begin
  select pg_get_functiondef('public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb)'::regprocedure)
    into v_def;

  if coalesce(btrim(v_def), '') = '' then
    raise exception 'RPC_INTROUVABLE: public.rpc_issue_invoice';
  end if;

  if position('''roundingTtc''' in v_def) > 0 then
    raise notice 'rpc_issue_invoice : ecart d''arrondi deja repris';
    return;
  end if;

  v_pairs := jsonb_build_array(
    jsonb_build_array(
      E'  v_total_ttc numeric := 0;\n',
      E'  v_total_ttc numeric := 0;\n  v_rounding numeric := 0;\n'
    ),
    jsonb_build_array(
      E'  v_notes := nullif(btrim(coalesce(p_options->>''notes'', '''')), '''');\n',
      E'  v_notes := nullif(btrim(coalesce(p_options->>''notes'', '''')), '''');\n\n  -- Arrondi du total encaisse : ecart explicite, aucune base HT/TVA facturee en plus.\n  v_rounding := round(greatest(coalesce(v_order.rounding_adjustment, 0), 0), 2);\n'
    ),
    jsonb_build_array(
      'abs(round(v_net_total + v_shipping, 2) - v_order.total_selling_price) > 0.01',
      'abs(round(v_net_total + v_shipping + v_rounding, 2) - v_order.total_selling_price) > 0.01'
    ),
    jsonb_build_array(
      'v_total_ttc := round(v_ht + v_vat, 2);',
      'v_total_ttc := round(v_ht + v_vat + v_rounding, 2);'
    ),
    jsonb_build_array(
      E'    items_ttc, discount_ttc, shipping_ttc, total_ht, total_vat, total_ttc,\n',
      E'    items_ttc, discount_ttc, shipping_ttc, rounding_ttc, total_ht, total_vat, total_ttc,\n'
    ),
    jsonb_build_array(
      E'    v_gross_total, v_discount_total, v_shipping, v_ht, v_vat, v_total_ttc,\n',
      E'    v_gross_total, v_discount_total, v_shipping, v_rounding, v_ht, v_vat, v_total_ttc,\n'
    ),
    jsonb_build_array(
      E'    ''totalTtc'', v_total_ttc,\n',
      E'    ''totalTtc'', v_total_ttc,\n    ''roundingTtc'', v_rounding,\n'
    )
  );

  v_def_new := v_def;

  for v_pair in select value from jsonb_array_elements(v_pairs)
  loop
    v_anchor := v_pair->>0;
    v_repl := v_pair->>1;

    v_occurrences := (length(v_def_new) - length(replace(v_def_new, v_anchor, ''))) / length(v_anchor);

    if v_occurrences <> 1 then
      raise exception 'ANCRE_INTROUVABLE (% occurrences) dans public.rpc_issue_invoice: %',
        v_occurrences, v_anchor;
    end if;

    v_def_new := replace(v_def_new, v_anchor, v_repl);
  end loop;

  execute v_def_new;
end
$migration$;
