-- ============================================================================
-- JISRA — P7.1 / 30 — ACTIVATION DES INVALIDATIONS KPI (LOT SÉPARÉ)
-- ============================================================================
-- Crée uniquement les producteurs d'invalidations. Aucun worker, aucun job,
-- aucun réveil HTTP. Le journal peut accumuler sans traitement : c'est voulu.
--
-- Exécution : psql --single-transaction -v ON_ERROR_STOP=1
-- Autorisation : SET LOCAL p7.activate_invalidations = 'yes';
-- Prérequis : 10_install_objects.sql appliqué, worker désactivé.
-- ============================================================================

do $guard$
declare
  v_n integer;
begin
  if current_setting('p7.activate_invalidations', true) is distinct from 'yes' then
    raise exception 'P71_INVALIDATIONS_NOT_AUTHORIZED';
  end if;

  select count(*) into v_n
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'dashboard_kpi%' or p.proname = 'rpc_dashboard_kpi_reader');
  if v_n <> 23 then
    raise exception 'P71_FUNCTIONS_NOT_INSTALLED (found %)', v_n;
  end if;

  if exists (
    select 1 from pg_trigger
     where not tgisinternal and tgname like 'trg_kpi_%'
  ) then
    raise exception 'P71_KPI_TRIGGER_ALREADY_PRESENT';
  end if;

  if exists (
    select 1 from public.dashboard_kpi_worker_config c
     where c.id = 1 and c.enabled
  ) then
    raise exception 'P71_WORKER_MUST_BE_DISABLED_FIRST';
  end if;
end
$guard$;

-- Marque la commande avant les triggers métier (B13).
create trigger trg_kpi_mark_order_insert
  before insert on public.orders
  for each row execute function public.dashboard_kpi_mark_order_insert();

-- UPDATE / DELETE par ligne.
create trigger trg_kpi_invalidate_orders
  after update or delete on public.orders
  for each row execute function public.dashboard_kpi_invalidate_trg();

-- INSERT groupé par statement (table de transition).
create trigger trg_kpi_invalidate_orders_insert
  after insert on public.orders
  referencing new table as new_rows
  for each statement execute function public.dashboard_kpi_invalidate_insert_stmt();

-- Lignes de commande : par ligne (décision B13 finale).
create trigger trg_kpi_invalidate_order_items
  after insert or update or delete on public.order_items
  for each row execute function public.dashboard_kpi_invalidate_trg();

-- Publicité quotidienne : par ligne.
create trigger trg_kpi_invalidate_ad_spend
  after insert or update or delete on public.ad_spend_daily
  for each row execute function public.dashboard_kpi_invalidate_trg();

-- Contrôle post-activation (attendu : 5 triggers, aucun trg_kpi_wakeup) :
--   select c.relname, t.tgname, t.tgenabled
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where not t.tgisinternal and t.tgname like 'trg_kpi_%'
--    order by 1,2;
--
-- ROLLBACK immédiat (aucune donnée métier touchée) :
--   drop trigger if exists trg_kpi_mark_order_insert on public.orders;
--   drop trigger if exists trg_kpi_invalidate_orders on public.orders;
--   drop trigger if exists trg_kpi_invalidate_orders_insert on public.orders;
--   drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
--   drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
