-- ---------- Garde-fou d'émission : refus si les lignes ne reproduisent pas le total ----------
-- Le contrôle est posé avant toute attribution de numéro : une facture dont le
-- montant ne correspond pas à la commande ne doit pas consommer de numéro
-- séquentiel. Patch ciblé du corps de `public.rpc_issue_invoice` (créé par
-- `20260928010100`, corrigé par `20260928010300`) pour ne pas dupliquer 380
-- lignes dans ce fichier. Idempotent : sortie immédiate si la garde est déjà là.
do $migration$
declare
  v_def text;
  v_def_new text;
  v_anchor text := E'  v_total_ttc := round(v_ht + v_vat, 2);\n';
  v_guard text := $guard$
  -- ---------- Garde-fou : les lignes doivent reproduire le total de la commande ----------
  -- Un écart de plus d'un centime signifie que les prix, la remise ou la
  -- livraison ont bougé depuis l'enregistrement de la commande. En prix TTC la
  -- base HT + TVA redonne exactement le total stocké ; en prix hors taxe la TVA
  -- s'ajoute légitimement à ce total, on compare donc la base HT + port.
  if v_order.total_selling_price is not null
     and abs(round(v_net_total + v_shipping, 2) - v_order.total_selling_price) > 0.01 then
    raise exception 'INVOICE_TOTAL_MISMATCH';
  end if;
$guard$;
begin
  select pg_get_functiondef('public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb)'::regprocedure)
    into v_def;

  if coalesce(btrim(v_def), '') = '' then
    raise exception 'RPC_INTROUVABLE: public.rpc_issue_invoice';
  end if;

  if position('INVOICE_TOTAL_MISMATCH' in v_def) > 0 then
    raise notice 'garde INVOICE_TOTAL_MISMATCH deja presente : rien a faire';
    return;
  end if;

  if (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) then
    raise exception 'ANCRE_INTROUVABLE: calcul du total TTC dans public.rpc_issue_invoice';
  end if;

  v_def_new := replace(v_def, v_anchor, v_anchor || v_guard);
  execute v_def_new;

  select pg_get_functiondef('public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb)'::regprocedure)
    into v_def_new;

  if position('INVOICE_TOTAL_MISMATCH' in coalesce(v_def_new, '')) = 0 then
    raise exception 'GARDE_NON_APPLIQUEE: public.rpc_issue_invoice';
  end if;
end
$migration$;
