-- Source de livraison P7.9, extraite sans changement de logique.
-- Ne pas confondre avec la restauration exacte C0 de qualification B13.
\set ON_ERROR_STOP on
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

comment on function public.dashboard_kpi_invalidate_orders_quality_trg() is
  'P7.9 : invalidation KPI ciblée quand seules les composantes qualité C3 (sous-total, arrondi) changent. Dédupliquée par dashboard_kpi_invalidation_tx_uniq.';

