-- ---------- Coût d'achat d'une commande : une seule règle pour Ventes, Dashboard et Finances ----------
-- Constat : le coût d'achat saisi sur une commande (orders.buy_price) n'était propagé qu'aux
-- colonnes de la commande (profit). Tous les lecteurs agrégés (KPI dashboard, graphique de
-- revenus, graphique de bénéfice, top produits, Finances) recalculent le coût à partir de
-- order_items.unit_purchase_cost_snapshot : une correction manuelle restait donc invisible dans
-- le dashboard, et le moindre changement de ligne écrasait la valeur saisie.
--
-- Règle unique appliquée partout :
--   * buy_price_source = 'auto'   : le coût suit les lignes produits (comportement historique) ;
--   * buy_price_source = 'manual' : correction explicite saisie sur la commande, elle prime.
-- La source est dérivée automatiquement (trigger avant écriture) : une valeur identique au coût
-- des lignes est automatique, une valeur différente est une correction explicite. Une correction
-- redevient donc automatique dès qu'elle rejoint le coût des lignes (aucun état bloqué).
-- Les lecteurs utilisent public.order_purchase_cost(source, buy_price, cout_lignes).
-- Idempotent.

alter table public.orders
  add column if not exists buy_price_source text,
  add column if not exists buy_price_manual_at timestamptz;

update public.orders
set buy_price_source = 'auto'
where buy_price_source is null;

alter table public.orders
  alter column buy_price_source set default 'auto',
  alter column buy_price_source set not null;

alter table public.orders
  drop constraint if exists orders_buy_price_source_check;

alter table public.orders
  add constraint orders_buy_price_source_check
  check (buy_price_source in ('auto', 'manual'));

comment on column public.orders.buy_price_source is
  'Origine du coût d''achat de la commande : auto = calculé depuis les lignes produits, manual = correction explicite saisie sur la commande (prime sur les lignes).';
comment on column public.orders.buy_price_manual_at is
  'Horodatage de la dernière correction manuelle du coût d''achat de la commande.';

-- Corrections déjà saisies mais invisibles côté dashboard : elles sont marquées manuelles pour
-- être conservées telles quelles au lieu d'être écrasées par le coût des lignes.
update public.orders o
set
  buy_price_source = 'manual',
  buy_price_manual_at = coalesce(o.buy_price_manual_at, now())
where o.buy_price_source <> 'manual'
  and abs(
    coalesce(o.buy_price, 0) - coalesce((
      select sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))
      from public.order_items oi
      where oi.order_id = o.id
    ), 0)
  ) > 0.01;

-- ---------- Règle de lecture commune ----------
create or replace function public.order_purchase_cost(
  p_buy_price_source text,
  p_order_buy_price numeric,
  p_order_items_cost numeric
)
returns numeric
language sql
immutable
as $function$
  select case
    when p_buy_price_source = 'manual' then coalesce(p_order_buy_price, 0)::numeric
    else coalesce(p_order_items_cost, p_order_buy_price, 0)::numeric
  end;
$function$;

-- ---------- Dérivation de la source à chaque écriture du coût ----------
create or replace function public.orders_sync_buy_price_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_lines_cost numeric(12,2) := 0;
begin
  if new.buy_price is null then
    new.buy_price := 0;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0)), 0)::numeric(12,2)
    into v_lines_cost
    from public.order_items oi
    where oi.order_id = new.id;
  end if;

  if abs(coalesce(new.buy_price, 0) - v_lines_cost) > 0.01 then
    new.buy_price_source := 'manual';
    if new.buy_price is distinct from old.buy_price then
      new.buy_price_manual_at := now();
    end if;
  else
    new.buy_price_source := 'auto';
    new.buy_price_manual_at := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_orders_sync_buy_price_source on public.orders;

create trigger trg_orders_sync_buy_price_source
  before update of buy_price on public.orders
  for each row
  execute function public.orders_sync_buy_price_source();

-- ---------- Le recalcul des lignes ne doit plus écraser une correction explicite ----------
create or replace function public.recalc_order_financials(p_order_id uuid)
returns void
language plpgsql
as $function$
declare
  v_lines_cost numeric(12,2) := 0;
  v_source text;
  v_buy_price numeric(12,2) := 0;
begin
  if p_order_id is null then
    return;
  end if;

  select coalesce(sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0)), 0)::numeric(12,2)
  into v_lines_cost
  from public.order_items oi
  where oi.order_id = p_order_id;

  select coalesce(o.buy_price_source, 'auto'), coalesce(o.buy_price, 0)
  into v_source, v_buy_price
  from public.orders o
  where o.id = p_order_id;

  if v_source is null then
    return;
  end if;

  -- Une correction explicite prime sur le coût des lignes.
  if v_source <> 'manual' then
    v_buy_price := v_lines_cost;
  end if;

  update public.orders o
  set
    buy_price = v_buy_price,
    profit = (
      coalesce(o.total_selling_price, 0)
      - v_buy_price
      - coalesce(o.ads_cost_allocated, 0)
      - coalesce(o.confirmation_cost_allocated, 0)
      - coalesce(o.delivery_fee, 0)
      + coalesce(o.delivery_charge_to_customer, 0)
    )::numeric(12,2)
  where o.id = p_order_id;
end;
$function$;

-- ---------- Les lecteurs agrégés appliquent la même règle ----------
-- Ces fonctions font plusieurs milliers de caractères : on remplace uniquement l'expression de
-- coût, en vérifiant le nombre d'occurrences de chaque ancre pour échouer franchement plutôt que
-- de patcher à moitié.
do $migration$
declare
  v_targets jsonb;
  v_target jsonb;
  v_fn regprocedure;
  v_def text;
  v_new text;
  v_pair jsonb;
  v_anchor text;
  v_repl text;
  v_expected int;
  v_found int;
begin
  v_targets := jsonb_build_array(
    jsonb_build_object(
      'fn', 'public.rpc_dashboard_kpi_metrics(uuid, timestamptz, timestamptz)',
      'marker', 'public.order_purchase_cost(so.buy_price_source',
      'pairs', jsonb_build_array(jsonb_build_array(
        'coalesce(oit.item_purchase_cost, so.buy_price, 0)',
        'public.order_purchase_cost(so.buy_price_source, so.buy_price, coalesce(oit.item_purchase_cost, so.buy_price, 0))',
        1))
    ),
    jsonb_build_object(
      'fn', 'public.rpc_dashboard_revenue_chart(uuid, timestamptz, timestamptz, text, timestamptz, timestamptz)',
      'marker', 'public.order_purchase_cost(so.buy_price_source',
      'pairs', jsonb_build_array(jsonb_build_array(
        'coalesce(oit.item_purchase_cost, so.buy_price, 0)',
        'public.order_purchase_cost(so.buy_price_source, so.buy_price, coalesce(oit.item_purchase_cost, so.buy_price, 0))',
        2))
    ),
    jsonb_build_object(
      'fn', 'public.rpc_dashboard_profit_chart(uuid, timestamptz, timestamptz)',
      'marker', 'public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(op.purchase_cost',
      'pairs', jsonb_build_array(
        jsonb_build_array(
          E'    coalesce(o.delivery_fee, 0)::numeric as delivery_fee\n  from public.orders o',
          E'    coalesce(o.delivery_fee, 0)::numeric as delivery_fee,\n    coalesce(o.buy_price, 0)::numeric as buy_price,\n    coalesce(o.buy_price_source, ''auto'') as buy_price_source\n  from public.orders o',
          1),
        jsonb_build_array(
          '    - coalesce(op.purchase_cost, 0)',
          '    - public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(op.purchase_cost, 0))',
          1)
      )
    ),
    jsonb_build_object(
      'fn', 'public.rpc_dashboard_top_products(uuid, timestamptz, timestamptz)',
      'marker', $marker$d.buy_price_source = 'manual'$marker$,
      'pairs', jsonb_build_array(jsonb_build_array(
        '      (coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric as line_purchase_cost,',
        E'      case\n        when d.buy_price_source = ''manual'' and coalesce(oit.order_items_revenue, 0) > 0 then\n          ((coalesce(oi.quantity, 0) * coalesce(oi.unit_selling_price, 0)) / oit.order_items_revenue) * coalesce(d.buy_price, 0)\n        else (coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0))::numeric\n      end as line_purchase_cost,',
        1))
    ),
    jsonb_build_object(
      'fn', 'public.rpc_finance_overview(uuid, timestamptz, timestamptz)',
      'marker', 'public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(oit.item_purchase_cost',
      'pairs', jsonb_build_array(jsonb_build_array(
        'coalesce(oit.item_purchase_cost, d.buy_price, 0)',
        'public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(oit.item_purchase_cost, d.buy_price, 0))',
        2))
    ),
    jsonb_build_object(
      'fn', 'public.rpc_finance_daily_series(uuid, timestamptz, timestamptz)',
      'marker', 'public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(oit.item_purchase_cost',
      'pairs', jsonb_build_array(
        jsonb_build_array(
          E'      o.buy_price,\n      o.delivery_fee,',
          E'      o.buy_price,\n      o.buy_price_source,\n      o.delivery_fee,',
          1),
        jsonb_build_array(
          'coalesce(oit.item_purchase_cost, d.buy_price, 0)',
          'public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(oit.item_purchase_cost, d.buy_price, 0))',
          1)
      )
    )
  );

  for v_target in select value from jsonb_array_elements(v_targets) loop
    v_fn := (v_target ->> 'fn')::regprocedure;
    select pg_get_functiondef(v_fn) into v_def;

    if coalesce(btrim(v_def), '') = '' then
      raise exception 'FONCTION_INTROUVABLE: %', v_target ->> 'fn';
    end if;

    -- Les corps proviennent de fichiers de migrations aux fins de ligne variables : on compare en LF.
    v_def := replace(v_def, E'\r\n', E'\n');

    if position(v_target ->> 'marker' in v_def) > 0 then
      raise notice 'deja patche: %', v_target ->> 'fn';
      continue;
    end if;

    v_new := v_def;

    for v_pair in select value from jsonb_array_elements(v_target -> 'pairs') loop
      v_anchor := v_pair ->> 0;
      v_repl := v_pair ->> 1;
      v_expected := (v_pair ->> 2)::int;
      v_found := (length(v_new) - length(replace(v_new, v_anchor, ''))) / length(v_anchor);

      if v_found <> v_expected then
        raise exception 'ANCRE_INTROUVABLE: % occurrences de [%] dans %', v_found, v_anchor, v_target ->> 'fn';
      end if;

      v_new := replace(v_new, v_anchor, v_repl);
    end loop;

    execute v_new;

    select pg_get_functiondef(v_fn) into v_def;

    if position(v_target ->> 'marker' in v_def) = 0 then
      raise exception 'PATCH_NON_APPLIQUE: %', v_target ->> 'fn';
    end if;

    raise notice 'patche: %', v_target ->> 'fn';
  end loop;
end
$migration$;

-- ---------- Contrôle des divergences restantes ----------
-- Liste les commandes dont le coût d'achat diffère du coût de leurs lignes :
-- buy_price_source = manual signale une correction volontaire, auto une incohérence à vérifier.
create or replace view public.order_buy_price_divergences
with (security_invoker = true)
as
select
  o.id as order_id,
  o.store_id,
  o.status,
  o.order_date,
  o.buy_price_source,
  o.buy_price_manual_at,
  o.buy_price as order_buy_price,
  coalesce(sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0)), 0)::numeric(12,2) as order_items_cost,
  (
    coalesce(o.buy_price, 0)
    - coalesce(sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0)), 0)
  )::numeric(12,2) as difference
from public.orders o
left join public.order_items oi on oi.order_id = o.id
group by o.id
having abs(
  coalesce(o.buy_price, 0)
  - coalesce(sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0)), 0)
) > 0.01;

comment on view public.order_buy_price_divergences is
  'Controle : ecarts entre le cout d''achat de la commande (orders.buy_price) et la somme des couts de ses lignes. buy_price_source = manual = correction explicite ; auto = incoherence a verifier.';




