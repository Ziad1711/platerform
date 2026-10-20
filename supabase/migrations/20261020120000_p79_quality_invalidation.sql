-- P7.9 / P0-1 — invalidation ciblée des composantes qualité C3.
--
-- Constat : depuis P7.7, la réconciliation qualité lit `orders.subtotal_amount`
-- et `orders.rounding_adjustment`. Le trigger B13 (`dashboard_kpi_invalidate_trg`)
-- ne surveille ni l'un ni l'autre : une écriture isolée de ces deux colonnes
-- laisse la partition publiée avec une qualité périmée, sans aucun autre champ
-- modifié pour déclencher l'invalidation.
--
-- Chemins de mutation vérifiés :
--   * `sync_order_total_from_items()` (trigger sur order_items) écrit
--     `subtotal_amount` ET `total_selling_price` ; ce dernier est déjà surveillé,
--     donc l'invalidation existe déjà dans ce cas ;
--   * `sync_order_total_from_items()` sur suppression de la dernière ligne écrit
--     `subtotal_amount` et peut laisser `total_selling_price` inchangé lorsque la
--     formule est bornée à 0 : cas non couvert ;
--   * une correction de `rounding_adjustment` seule (outil d'exploitation,
--     réparation de données) ne change aucun champ surveillé : cas non couvert ;
--   * `order_items` (quantités, prix, coûts) invalide déjà systématiquement.
--
-- Correctif minimal : un trigger dédié, restreint par colonne, qui n'ajoute une
-- invalidation que si l'une des deux valeurs change réellement. Il ne remplace
-- pas le trigger B13 et ne modifie aucune définition financière.
--
-- Anti-doublon : l'index partiel `dashboard_kpi_invalidation_tx_uniq`
-- (store_id, business_date, note_tx) garantit au plus une ligne par journée et
-- par transaction, même si B13 et ce trigger s'exécutent tous les deux.
--
-- Conséquence documentaire : le contrôle post-activation du paquet P7.1
-- (« attendu : 5 triggers trg_kpi_% ») devient 6 après ce lot. Le paquet
-- historique n'est pas modifié.

create or replace function public.dashboard_kpi_invalidate_orders_quality_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tz text;
  v_tx bigint;
begin
  -- Aucune invalidation si les valeurs ne changent pas réellement.
  if new.subtotal_amount is not distinct from old.subtotal_amount
     and new.rounding_adjustment is not distinct from old.rounding_adjustment then
    return null;
  end if;

  if new.store_id is null or new.order_date is null then
    return null;
  end if;

  v_tz := public.dashboard_kpi_store_tz_cached(new.store_id);
  v_tx := txid_current();

  insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
  select v.s, v.d, v.r, v_tx
  from (values
    (new.store_id,
     (new.order_date at time zone v_tz)::date,
     'orders:UPDATE:quality:order'),
    (new.store_id,
     (coalesce(new.delivered_at, new.order_date) at time zone v_tz)::date,
     'orders:UPDATE:quality:delivery')
  ) v(s, d, r)
  where v.s is not null and v.d is not null
  on conflict do nothing;

  return null;
end;
$function$;

revoke all on function public.dashboard_kpi_invalidate_orders_quality_trg()
  from public, anon, authenticated;

drop trigger if exists trg_kpi_invalidate_orders_quality on public.orders;
create trigger trg_kpi_invalidate_orders_quality
  after update of subtotal_amount, rounding_adjustment on public.orders
  for each row execute function public.dashboard_kpi_invalidate_orders_quality_trg();

comment on function public.dashboard_kpi_invalidate_orders_quality_trg() is
  'P7.9 : invalidation KPI ciblée quand seules les composantes qualité C3 (sous-total, arrondi) changent. Dédupliquée par dashboard_kpi_invalidation_tx_uniq.';
