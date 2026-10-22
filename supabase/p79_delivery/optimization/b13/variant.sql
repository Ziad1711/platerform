-- JISRA - P7.10 : bascule des producteurs pour la mesure ciblee B13.
--   psql ... -v variant=A|C0|CF -f variant.sql
\set ON_ERROR_STOP on
\if :{?variant}
\else
  \echo 'ERREUR : -v variant=A|C0|CF obligatoire'
  \q
\endif
select set_config('p710.variant', :'variant', false);

drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
drop trigger if exists trg_kpi_invalidate_orders on public.orders;
drop trigger if exists trg_kpi_invalidate_orders_insert on public.orders;
drop trigger if exists trg_kpi_invalidate_orders_quality on public.orders;
drop trigger if exists trg_kpi_mark_order_insert on public.orders;

do $v$
declare v text := current_setting('p710.variant');
begin
  if v = 'A' then
    return;
  elsif v = 'C0' then
    execute 'create trigger trg_kpi_mark_order_insert before insert on public.orders for each row execute function public.p710_c0_mark_order_insert()';
    execute 'create trigger trg_kpi_invalidate_orders after update or delete on public.orders for each row execute function public.p710_c0_invalidate_trg()';
    execute 'create trigger trg_kpi_invalidate_orders_insert after insert on public.orders referencing new table as new_rows for each statement execute function public.p710_c0_invalidate_insert_stmt()';
    execute 'create trigger trg_kpi_invalidate_order_items after insert or update or delete on public.order_items for each row execute function public.p710_c0_invalidate_trg()';
    execute 'create trigger trg_kpi_invalidate_ad_spend after insert or update or delete on public.ad_spend_daily for each row execute function public.p710_c0_invalidate_trg()';
    execute 'create trigger trg_kpi_invalidate_orders_quality after update of subtotal_amount, rounding_adjustment on public.orders for each row execute function public.p710_c0_quality_trg()';
  elsif v = 'CF' then
    execute 'create trigger trg_kpi_mark_order_insert after insert on public.orders referencing new table as new_rows for each statement execute function public.dashboard_kpi_mark_order_insert()';
    execute 'create trigger trg_kpi_invalidate_orders after update or delete on public.orders for each row execute function public.dashboard_kpi_invalidate_trg()';
    execute 'create trigger trg_kpi_invalidate_orders_insert after insert on public.orders referencing new table as new_rows for each statement execute function public.dashboard_kpi_invalidate_insert_stmt()';
    execute 'create trigger trg_kpi_invalidate_order_items after insert or update or delete on public.order_items for each row execute function public.dashboard_kpi_invalidate_trg()';
    execute 'create trigger trg_kpi_invalidate_ad_spend after insert or update or delete on public.ad_spend_daily for each row execute function public.dashboard_kpi_invalidate_trg()';
    execute 'create trigger trg_kpi_invalidate_orders_quality after update of subtotal_amount, rounding_adjustment on public.orders for each row execute function public.dashboard_kpi_invalidate_orders_quality_trg()';
  else
    raise exception 'P710_VARIANT_UNKNOWN %', v;
  end if;
end
$v$;

select current_setting('p710.variant') as variant,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
           and t.tgname like 'trg_kpi_%' and t.tgenabled = 'O') as active_producers;
