-- B13 — état final du chemin chaud d'invalidation KPI.
-- Ce fichier reproduit l'état testé : cache de fuseau, insertion groupée,
-- drapeaux transactionnels, statement INSERT orders et triggers finaux.
-- Aucun trigger métier n'est modifié.

create or replace function public.dashboard_kpi_store_tz_cached(p_store_id uuid)
returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare v_key text; v_tz text;
begin
  if p_store_id is null then return null; end if;
  v_key := 'app.kpi_tz_' || replace(p_store_id::text, '-', '_');
  v_tz := current_setting(v_key, true);
  if v_tz is null or v_tz = '' then
    select coalesce(st.tz, 'Africa/Casablanca') into v_tz
      from public.dashboard_kpi_store_state st where st.store_id = p_store_id;
    if v_tz is null then v_tz := 'Africa/Casablanca'; end if;
    perform set_config(v_key, v_tz, true);
  end if;
  return v_tz;
end;
$function$;
revoke all on function public.dashboard_kpi_store_tz_cached(uuid) from public, anon, authenticated;

create or replace function public.dashboard_kpi_invalidate_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_relevant boolean := false;
  v_ns uuid; v_nd1 date; v_nd2 date;
  v_os uuid; v_od1 date; v_od2 date;
  v_tz text;
  v_tx bigint;
  v_new_ok boolean := false;
  v_old_ok boolean := false;
  v_s uuid; v_od timestamptz; v_dd timestamptz;
begin
  if tg_table_name = 'orders' then
    if tg_op in ('INSERT', 'DELETE') then
      v_relevant := true;
    else
      v_relevant := (new.status is distinct from old.status)
        or (new.order_date is distinct from old.order_date)
        or (new.delivered_at is distinct from old.delivered_at)
        or (new.store_id is distinct from old.store_id)
        or (new.buy_price is distinct from old.buy_price)
        or (new.buy_price_source is distinct from old.buy_price_source)
        or (new.delivery_fee is distinct from old.delivery_fee)
        or (new.confirmation_cost_allocated is distinct from old.confirmation_cost_allocated)
        or (new.ads_cost_allocated is distinct from old.ads_cost_allocated)
        or (new.discount_amount is distinct from old.discount_amount)
        or (new.delivery_charge_to_customer is distinct from old.delivery_charge_to_customer)
        or (new.total_selling_price is distinct from old.total_selling_price);
      if not v_relevant then return null; end if;

      -- Si order_items a déjà invalidé cette commande dans la transaction et
      -- que ses dates/store n'ont pas changé, l'update financier est redondant.
      if tg_op = 'UPDATE'
         and new.store_id = old.store_id
         and new.order_date = old.order_date
         and new.delivered_at is not distinct from old.delivered_at
         and current_setting('app.kpi_inv_order_' || replace(new.id::text, '-', '_'), true) = '1' then
        return null;
      end if;
    end if;

    if tg_op <> 'DELETE' then
      v_ns := new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1 := (new.order_date at time zone v_tz)::date;
      v_nd2 := (coalesce(new.delivered_at, new.order_date) at time zone v_tz)::date;
      v_new_ok := true;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op = 'UPDATE'
         and old.store_id = new.store_id
         and old.order_date = new.order_date
         and old.delivered_at is not distinct from new.delivered_at then
        v_os := v_ns;
        v_od1 := v_nd1;
        v_od2 := v_nd2;
        v_old_ok := v_new_ok;
      else
        v_os := old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1 := (old.order_date at time zone v_tz)::date;
        v_od2 := (coalesce(old.delivered_at, old.order_date) at time zone v_tz)::date;
        v_old_ok := true;
      end if;
    end if;


  elsif tg_table_name = 'order_items' then
    v_relevant := true;
    if tg_op = 'INSERT'
       and current_setting('app.kpi_inv_order_' || replace(new.order_id::text, '-', '_'), true) = '1' then
      return null;
    end if;
    if tg_op <> 'DELETE' then
      select o.store_id, o.order_date, o.delivered_at into v_s, v_od, v_dd
        from public.orders o where o.id = new.order_id;
      if v_s is not null then
        v_ns := v_s;
        v_tz := public.dashboard_kpi_store_tz_cached(v_s);
        v_nd1 := (v_od at time zone v_tz)::date;
        v_nd2 := (coalesce(v_dd, v_od) at time zone v_tz)::date;
        v_new_ok := true;
      end if;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op = 'UPDATE' and old.order_id = new.order_id then
        v_os := v_ns;
        v_od1 := v_nd1;
        v_od2 := v_nd2;
        v_old_ok := v_new_ok;
      else
        select o.store_id, o.order_date, o.delivered_at into v_s, v_od, v_dd
          from public.orders o where o.id = old.order_id;
        if v_s is not null then
          v_os := v_s;
          v_tz := public.dashboard_kpi_store_tz_cached(v_s);
          v_od1 := (v_od at time zone v_tz)::date;
          v_od2 := (coalesce(v_dd, v_od) at time zone v_tz)::date;
          v_old_ok := true;
        end if;
      end if;
    end if;

  elsif tg_table_name = 'ad_spend_daily' then
    v_relevant := true;
    if tg_op <> 'DELETE' then
      v_ns := new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1 := (new.spend_date at time zone v_tz)::date;
      v_new_ok := true;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op = 'UPDATE' and old.store_id = new.store_id and old.spend_date = new.spend_date then
        v_os := v_ns;
        v_od1 := v_nd1;
        v_old_ok := v_new_ok;
      else
        v_os := old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1 := (old.spend_date at time zone v_tz)::date;
        v_old_ok := true;
      end if;
    end if;
  end if;

  if not v_relevant then return null; end if;

  v_tx := txid_current();

  insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
  select v.s, v.d, v.r, v_tx
  from (values
    (v_ns, v_nd1, case when v_new_ok then tg_table_name || ':' || tg_op || ':order' end),
    (v_ns, v_nd2, case when v_new_ok then tg_table_name || ':' || tg_op || ':delivery' end),
    (v_os, v_od1, case when v_old_ok then tg_table_name || ':' || tg_op || ':order:old' end),
    (v_os, v_od2, case when v_old_ok then tg_table_name || ':' || tg_op || ':delivery:old' end)
  ) v(s, d, r)
  where v.s is not null and v.d is not null
  on conflict do nothing;

  -- Marque la commande comme déjà invalidée dans cette transaction.
  -- Utilisé uniquement pour éviter les réinvalidations financières en cascade.
  if tg_table_name = 'order_items' then
    if v_new_ok then
      perform set_config(
        'app.kpi_inv_order_' || replace(new.order_id::text, '-', '_'), '1', true);
    end if;
    if v_old_ok and (tg_op <> 'UPDATE' or old.order_id is distinct from new.order_id) then
      perform set_config(
        'app.kpi_inv_order_' || replace(old.order_id::text, '-', '_'), '1', true);
    end if;
  end if;

  return null;
end;
$function$;

create or replace function public.dashboard_kpi_invalidate_insert_stmt()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare v_tx bigint := txid_current();
begin
  if tg_table_name = 'orders' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select o.store_id,
           (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'orders:INSERT:stmt', v_tx
    from new_rows o
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    where o.store_id is not null
    union all
    select o.store_id,
           (coalesce(o.delivered_at, o.order_date) at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'orders:INSERT:stmt', v_tx
    from new_rows o
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    where o.store_id is not null
    on conflict do nothing;
  elsif tg_table_name = 'order_items' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select o.store_id,
           (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id = ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    where o.store_id is not null
    union all
    select o.store_id,
           (coalesce(o.delivered_at, o.order_date) at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id = ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    where o.store_id is not null
    on conflict do nothing;
  elsif tg_table_name = 'ad_spend_daily' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select a.store_id,
           (a.spend_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date,
           'ad_spend_daily:INSERT:stmt', v_tx
    from new_rows a
    left join public.dashboard_kpi_store_state st on st.store_id = a.store_id
    where a.store_id is not null
    on conflict do nothing;
  end if;
  return null;
end;
$function$;

create or replace function public.dashboard_kpi_mark_order_insert()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  perform set_config(
    'app.kpi_inv_order_' || replace(new.id::text, '-', '_'), '1', true);
  return new;
end;
$function$;
revoke all on function public.dashboard_kpi_mark_order_insert() from public, anon, authenticated;

drop trigger if exists trg_kpi_mark_order_insert on public.orders;
create trigger trg_kpi_mark_order_insert
  before insert on public.orders
  for each row execute function public.dashboard_kpi_mark_order_insert();

drop trigger if exists trg_kpi_invalidate_orders on public.orders;
create trigger trg_kpi_invalidate_orders
  after update or delete on public.orders
  for each row execute function public.dashboard_kpi_invalidate_trg();

drop trigger if exists trg_kpi_invalidate_orders_insert on public.orders;
create trigger trg_kpi_invalidate_orders_insert
  after insert on public.orders
  referencing new table as new_rows
  for each statement execute function public.dashboard_kpi_invalidate_insert_stmt();

drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
create trigger trg_kpi_invalidate_order_items
  after insert or update or delete on public.order_items
  for each row execute function public.dashboard_kpi_invalidate_trg();

drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
create trigger trg_kpi_invalidate_ad_spend
  after insert or update or delete on public.ad_spend_daily
  for each row execute function public.dashboard_kpi_invalidate_trg();

