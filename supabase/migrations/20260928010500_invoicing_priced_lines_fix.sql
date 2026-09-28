-- ---------- Correctif : fusion des lignes facturees dans v_priced ----------
-- `v_priced` est un tableau jsonb ('[]') : `v_priced || v_line.item || objet`
-- AJOUTE deux elements distincts au lieu de fusionner la ligne et ses montants.
-- Resultat : 4 elements pour 2 lignes, dont deux sans discount/net/ht/vat ;
-- l'insert dans invoice_items echouait alors sur `line_discount_ttc` (NOT NULL)
-- et aucune facture ne pouvait etre emise. Le correctif ajoute une parenthese
-- pour ne concatener qu'un seul element fusionne par ligne. Idempotent.
do $migration$
declare
  v_def text;
  v_def_new text;
  v_open_old text := E'    v_priced := v_priced || v_line.item || jsonb_build_object(';
  v_open_new text := E'    v_priced := v_priced || (v_line.item || jsonb_build_object(';
  v_close_old text := E'      ''vat'', v_line_vat\n    );\n';
  v_close_new text := E'      ''vat'', v_line_vat\n    ));\n';
begin
  select pg_get_functiondef('public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb)'::regprocedure)
    into v_def;

  if coalesce(btrim(v_def), '') = '' then
    raise exception 'RPC_INTROUVABLE: public.rpc_issue_invoice';
  end if;

  if position('v_priced := v_priced || (v_line.item' in v_def) > 0 then
    raise notice 'fusion des lignes deja corrigee : rien a faire';
    return;
  end if;

  if (length(v_def) - length(replace(v_def, v_open_old, ''))) <> length(v_open_old) then
    raise exception 'ANCRE_INTROUVABLE: accumulation v_priced dans public.rpc_issue_invoice';
  end if;

  if (length(v_def) - length(replace(v_def, v_close_old, ''))) <> length(v_close_old) then
    raise exception 'ANCRE_INTROUVABLE: fermeture jsonb_build_object de la boucle de tarification';
  end if;

  v_def_new := replace(v_def, v_open_old, v_open_new);
  v_def_new := replace(v_def_new, v_close_old, v_close_new);
  execute v_def_new;

  select pg_get_functiondef('public.rpc_issue_invoice(uuid, uuid, jsonb, jsonb, jsonb)'::regprocedure)
    into v_def_new;

  if position('v_priced := v_priced || (v_line.item' in coalesce(v_def_new, '')) = 0 then
    raise exception 'CORRECTIF_NON_APPLIQUE: public.rpc_issue_invoice';
  end if;
end
$migration$;
