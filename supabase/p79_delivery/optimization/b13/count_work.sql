-- Comptage deterministe du travail d'invalidation (hors mesure de latence).
\set ON_ERROR_STOP on
create table if not exists public.p710_attempts(n bigint not null default 0);
truncate public.p710_attempts;
insert into public.p710_attempts values (0);
create or replace function public.p710_count_attempt() returns trigger language plpgsql as $fn$
begin
  update public.p710_attempts set n = n + 1;
  return new;
end $fn$;
drop trigger if exists p710_count on public.dashboard_kpi_invalidation;
create trigger p710_count before insert on public.dashboard_kpi_invalidation
  for each row execute function public.p710_count_attempt();

select public.dashboard_kpi_producer_arm(true);
select public.dashboard_kpi_producer_enable_store(p710_store(), null, 'count');
select p710_reset();
select p710_setup();

-- 1) changement REEL de prix d'article (100.00 -> 101.00)
delete from public.dashboard_kpi_invalidation where store_id = p710_store();
update public.p710_attempts set n = 0;
select p710_update_item(2);
select 'item_change_attempts' as metric, n::text as value from public.p710_attempts;
select 'item_change_persisted' as metric, count(*)::text as value
  from public.dashboard_kpi_invalidation where store_id = p710_store();

-- 2) mise a jour sans changement de valeur (aucun travail utile possible)
delete from public.dashboard_kpi_invalidation where store_id = p710_store();
update public.p710_attempts set n = 0;
select p710_update_item(2);
select 'item_noop_attempts' as metric, n::text as value from public.p710_attempts;

-- 3) import ensembliste de 600 commandes
delete from public.dashboard_kpi_invalidation where store_id = p710_store();
update public.p710_attempts set n = 0;
select p710_import_orders(600, 2);
select 'import600_attempts' as metric, n::text as value from public.p710_attempts;
select 'import600_persisted' as metric, count(*)::text as value
  from public.dashboard_kpi_invalidation where store_id = p710_store();

drop trigger if exists p710_count on public.dashboard_kpi_invalidation;
select p710_reset();
select public.dashboard_kpi_producer_disable_store(p710_store(), 'count done');
select public.dashboard_kpi_producer_arm(false);
