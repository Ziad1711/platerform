-- B13 — conserve la coalescence statement pour orders uniquement.
-- Le trigger statement order_items s'est révélé plus coûteux que le trigger
-- ligne (joint sur la table de transition). Retour au ligne pour order_items
-- et ad_spend_daily ; orders garde AFTER INSERT STATEMENT + UPDATE/DELETE ROW.

drop trigger if exists trg_kpi_invalidate_order_items_insert on public.order_items;
drop trigger if exists trg_kpi_invalidate_ad_spend_insert on public.ad_spend_daily;

drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
create trigger trg_kpi_invalidate_order_items
  after insert or update or delete on public.order_items
  for each row execute function public.dashboard_kpi_invalidate_trg();

drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
create trigger trg_kpi_invalidate_ad_spend
  after insert or update or delete on public.ad_spend_daily
  for each row execute function public.dashboard_kpi_invalidate_trg();
