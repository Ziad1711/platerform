-- @@FUNCTION a13e12e991711542e511db56afcb4643 dashboard_kpi_access_level(p_store_id uuid)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_access_level(p_store_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when public.can_view_store_finances(p_store_id) then 'full'
    when exists (
      select 1 from public.store_members sm
       where sm.store_id = p_store_id
         and sm.user_id = auth.uid()
         and sm.status = 'active'
         and sm.role in ('marketer','viewer')
    ) then 'commercial'
    else 'none'
  end;
$function$

-- @@END

-- @@FUNCTION f2a5aa1662ad21a1910d3336ad99fc4d dashboard_kpi_aggregate_delivery(p_store_id uuid, p_date date, p_version integer, p_start timestamp with time zone, p_end timestamp with time zone, p_tz text, p_currency text, p_last_seq bigint)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_aggregate_delivery(p_store_id uuid, p_date date, p_version integer, p_start timestamp with time zone, p_end timestamp with time zone, p_tz text, p_currency text, p_last_seq bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_rows int;
begin
  delete from public.dashboard_daily_metrics m
   where m.store_id = p_store_id and m.business_date = p_date
     and m.axis = 'delivery' and m.definition_version = p_version;

  with scoped_deliv as (
    select o.id, o.buy_price, o.buy_price_source, o.delivery_fee, o.confirmation_cost_allocated,
           o.total_selling_price
    from public.orders o
    where o.store_id = p_store_id and o.status = 'delivered'
      and (
        (o.delivered_at >= p_start and o.delivered_at < p_end)
        -- repli documenté (contrat) : livrée sans date de livraison => cohorte order_date
        or (o.delivered_at is null and o.order_date >= p_start and o.order_date < p_end)
      )
  ), items as (
    select oi.order_id,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_selling_price,0)) as rev,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_purchase_cost_snapshot,0)) as pc,
           count(*) as n_lines
    from public.order_items oi join scoped_deliv d on d.id = oi.order_id
    group by oi.order_id
  ), joined as (
    select d.*, i.rev, i.pc, i.n_lines,
           public.order_purchase_cost(d.buy_price_source, d.buy_price, coalesce(i.pc, d.buy_price, 0)) as purchase
    from scoped_deliv d left join items i on i.order_id = d.id
  )
  insert into public.dashboard_daily_metrics (
    store_id, business_date, axis, definition_version, tz_used, currency_code,
    orders_count, delivered_count, cancelled_count, returned_count, refused_count,
    pending_count, confirmed_like_count, sent_like_count, unclassified_count,
    revenue_items_gross, revenue_estimated, discount_amount, delivery_charge_customer,
    purchase_cost, delivery_fee_cost, confirmation_cost,
    ads_tracked, ads_allocated_raw, ads_fallback_effective, ads_daily_rows,
    orders_without_lines, delivered_without_lines, line_vs_total_mismatch,
    zero_purchase_with_revenue, data_issues_count, last_event_seq, computed_at)
  select p_store_id, p_date, 'delivery', p_version, p_tz, p_currency,
    count(j.id)::int, count(j.id)::int, 0, 0, 0, 0, 0, 0, 0,
    coalesce(sum(coalesce(j.rev,0)), 0),
    coalesce(sum(coalesce(j.total_selling_price,0)) filter (where j.n_lines is null), 0),
    0, 0,
    coalesce(sum(j.purchase), 0),
    coalesce(sum(coalesce(j.delivery_fee,0)), 0),
    coalesce(sum(coalesce(j.confirmation_cost_allocated,0)), 0),
    0, 0, 0, 0,
    count(j.id) filter (where j.n_lines is null)::int,
    count(j.id) filter (where j.n_lines is null)::int,
    count(j.id) filter (where abs(coalesce(j.rev,0) - coalesce(j.total_selling_price,0)) > 0.01)::int,
    count(j.id) filter (where coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0)::int,
    count(j.id) filter (where j.n_lines is null
      or abs(coalesce(j.rev,0) - coalesce(j.total_selling_price,0)) > 0.01
      or (coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0))::int,
    p_last_seq, clock_timestamp()
  from joined j;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'KPI_AGGREGATE_DELIVERY_NO_ROW'; end if;
end;
$function$

-- @@END

-- @@FUNCTION 3f841fc9915007f1f6e4091fbdde4c4a dashboard_kpi_aggregate_order(p_store_id uuid, p_date date, p_version integer, p_start timestamp with time zone, p_end timestamp with time zone, p_tz text, p_currency text, p_last_seq bigint)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_aggregate_order(p_store_id uuid, p_date date, p_version integer, p_start timestamp with time zone, p_end timestamp with time zone, p_tz text, p_currency text, p_last_seq bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_rows int;
begin
  delete from public.dashboard_daily_metrics m
   where m.store_id = p_store_id and m.business_date = p_date
     and m.axis = 'order' and m.definition_version = p_version;

  with scoped as (
    select o.id, o.status, o.delivery_fee, o.confirmation_cost_allocated, o.ads_cost_allocated,
           o.buy_price, o.buy_price_source, o.discount_amount, o.delivery_charge_to_customer,
           o.total_selling_price
    from public.orders o
    where o.store_id = p_store_id and o.order_date >= p_start and o.order_date < p_end
  ), items as (
    select oi.order_id,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_selling_price,0)) as rev,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_purchase_cost_snapshot,0)) as pc,
           count(*) as n_lines
    from public.order_items oi join scoped s on s.id = oi.order_id
    group by oi.order_id
  ), joined as (
    select s.*, i.rev, i.pc, i.n_lines,
           public.order_purchase_cost(s.buy_price_source, s.buy_price, coalesce(i.pc, s.buy_price, 0)) as purchase
    from scoped s left join items i on i.order_id = s.id
  ), ads as (
    select coalesce(sum(coalesce(a.spend_converted, a.spend, 0)), 0) as tracked,
           count(*)::int as n_rows
    from public.ad_spend_daily a
    where a.store_id = p_store_id and a.spend_date >= p_start and a.spend_date < p_end
  )
  insert into public.dashboard_daily_metrics (
    store_id, business_date, axis, definition_version, tz_used, currency_code,
    orders_count, delivered_count, cancelled_count, returned_count, refused_count,
    pending_count, confirmed_like_count, sent_like_count, unclassified_count,
    revenue_items_gross, revenue_estimated, discount_amount, delivery_charge_customer,
    purchase_cost, delivery_fee_cost, confirmation_cost,
    ads_tracked, ads_allocated_raw, ads_fallback_effective, ads_daily_rows,
    orders_without_lines, delivered_without_lines, line_vs_total_mismatch,
    zero_purchase_with_revenue, data_issues_count, last_event_seq, computed_at)
  select p_store_id, p_date, 'order', p_version, p_tz, p_currency,
    count(j.id)::int,
    count(j.id) filter (where j.status = 'delivered')::int,
    count(j.id) filter (where j.status = 'cancelled')::int,
    count(j.id) filter (where j.status in ('returned_stocked','returned_not_stocked'))::int,
    count(j.id) filter (where j.status = 'refused')::int,
    count(j.id) filter (where j.status in ('new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected'))::int,
    -- funnels alignés sur le lecteur existant (recouvrement assumé, NON additif)
    count(j.id) filter (where j.status in ('confirmed','picked_up','sent','delivered','returned_not_stocked','returned_stocked'))::int,
    count(j.id) filter (where j.status in ('sent','delivered','returned_not_stocked','returned_stocked'))::int,
    -- non classifiées = hors des 4 familles publiées + pending : inclut `refused` et `dl_*` (BL-6 option A)
    count(j.id) filter (where coalesce(j.status,'') not in ('delivered','cancelled','returned_stocked','returned_not_stocked','new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected','confirmed','picked_up','sent'))::int,
    coalesce(sum(coalesce(j.rev,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.total_selling_price,0)) filter (where j.status = 'delivered' and j.n_lines is null), 0),
    coalesce(sum(coalesce(j.discount_amount,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.delivery_charge_to_customer,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(j.purchase) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.delivery_fee,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.confirmation_cost_allocated,0)) filter (where j.status = 'delivered'), 0),
    (select tracked from ads),
    coalesce(sum(coalesce(j.ads_cost_allocated,0)) filter (where j.status = 'delivered'), 0),
    case when (select n_rows from ads) > 0 then 0
         else coalesce(sum(coalesce(j.ads_cost_allocated,0)) filter (where j.status = 'delivered'), 0) end,
    (select n_rows from ads),
    count(j.id) filter (where j.n_lines is null)::int,
    count(j.id) filter (where j.status = 'delivered' and j.n_lines is null)::int,
    count(j.id) filter (where j.status = 'delivered' and abs(coalesce(j.rev,0) - coalesce(j.total_selling_price,0)) > 0.01)::int,
    count(j.id) filter (where j.status = 'delivered' and coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0)::int,
    count(j.id) filter (where j.n_lines is null
      or (j.status = 'delivered' and abs(coalesce(j.rev,0) - coalesce(j.total_selling_price,0)) > 0.01)
      or (j.status = 'delivered' and coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0))::int,
    p_last_seq, clock_timestamp()
  from joined j;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'KPI_AGGREGATE_ORDER_NO_ROW'; end if;
end;
$function$

-- @@END

-- @@FUNCTION 7c7499c41206c269ecbdc8c634d5f0be dashboard_kpi_backfill_enqueue(p_store_id uuid, p_from date, p_to date)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_backfill_enqueue(p_store_id uuid, p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n int; v_version int;
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'KPI_BAD_RANGE';
  end if;

  select coalesce((select st.active_definition_version from public.dashboard_kpi_store_state st
                    where st.store_id = p_store_id), 1) into v_version;

  insert into public.dashboard_kpi_invalidation (store_id, business_date, reason)
  select p_store_id, d::date, 'backfill:' || p_from::text || ':' || p_to::text
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
   where not exists (select 1 from public.dashboard_daily_metrics m
                      where m.store_id = p_store_id and m.business_date = d::date
                        and m.axis = 'order' and m.definition_version = v_version)
     and not exists (select 1 from public.dashboard_kpi_invalidation i
                      where i.store_id = p_store_id and i.business_date = d::date
                        and i.processed_at is null);
  get diagnostics v_n = row_count;

  insert into public.dashboard_kpi_store_state as st (store_id, backfill_state, coverage_from, coverage_to)
  values (p_store_id, 'running', p_from, p_to)
  on conflict (store_id) do update
    set backfill_state = 'running',
        coverage_from = least(coalesce(st.coverage_from, excluded.coverage_from), excluded.coverage_from),
        coverage_to   = greatest(coalesce(st.coverage_to,  excluded.coverage_to),  excluded.coverage_to),
        updated_at = clock_timestamp();
  return v_n;
end;
$function$

-- @@END

-- @@FUNCTION 86835f3507dad67879ede24208f13818 dashboard_kpi_business_date(p_ts timestamp with time zone, p_tz text)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_business_date(p_ts timestamp with time zone, p_tz text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$ select (p_ts at time zone coalesce(p_tz, 'Africa/Casablanca'))::date $function$

-- @@END

-- @@FUNCTION 2d888ec8f84515f7b066c5fd043fc728 dashboard_kpi_claim(p_limit integer, p_worker text)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_claim(p_limit integer DEFAULT 5, p_worker text DEFAULT 'worker'::text)
 RETURNS TABLE(r_store_id uuid, r_business_date date, r_token uuid, r_seqs bigint[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_part record;
  v_token uuid;
  v_seqs bigint[];
  v_taken int := 0;
begin
  for v_part in
    select i.store_id, i.business_date
      from public.dashboard_kpi_invalidation i
     where i.processed_at is null
       -- `lease_expires_at` n'est PLUS un bail de propriété : c'est un simple
       -- backoff « ne pas retenter avant » (posé après un échec).
       and (i.lease_expires_at is null or i.lease_expires_at <= clock_timestamp())
       and not (i.reason like 'backfill%' and exists (
             select 1 from public.dashboard_kpi_store_state st
              where st.store_id = i.store_id and st.backfill_state = 'paused'))
     group by i.store_id, i.business_date
     order by min(i.occurred_at), i.store_id, i.business_date
     limit greatest(1, least(p_limit, 50))
  loop
    -- exclusivité SANS attente : si la partition est déjà traitée, on passe
    if not pg_try_advisory_xact_lock(hashtextextended(v_part.store_id::text || '|' || v_part.business_date::text, 0)) then
      continue;
    end if;

    v_token := gen_random_uuid();

    with upd as (
      update public.dashboard_kpi_invalidation i
         set claim_token   = v_token,
             claimed_by    = p_worker,
             claimed_at    = clock_timestamp(),
             lease_expires_at = NULL,   -- plus de bail : le verrou transactionnel fait foi
             attempts      = i.attempts + 1
       where i.store_id = v_part.store_id
         and i.business_date = v_part.business_date
         and i.processed_at is null
      returning i.seq
    )
    select array_agg(u.seq order by u.seq) into v_seqs from upd u;

    if v_seqs is not null and array_length(v_seqs, 1) > 0 then
      r_store_id := v_part.store_id;
      r_business_date := v_part.business_date;
      r_token := v_token;
      r_seqs := v_seqs;
      return next;
      v_taken := v_taken + 1;
      exit when v_taken >= greatest(1, least(p_limit, 50));
    end if;
  end loop;
  return;
end;
$function$

-- @@END

-- @@FUNCTION 1f488ea44c405eeb1bbd5bac9e5469b2 dashboard_kpi_coverage(p_store_id uuid, p_from date, p_to date)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_coverage(p_store_id uuid, p_from date, p_to date)
 RETURNS TABLE(expected_days integer, computed_days integer, dirty_days integer, missing_days integer, pending_partitions integer, publish_counter bigint, last_rebuild_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_version int;
  v_counter bigint;
  v_rebuilt timestamptz;
  v_from date;
  v_to date;
  v_expected int;
  v_computed int;
  v_dirty int;
  v_pending int;
begin
  -- Plage de couverture DÉCLARÉE (fixée au backfill) : une journée sans source
  -- n'est pas « inexistante », elle doit être explicitement calculée (à zéro).
  select coalesce(st.active_definition_version, 1), coalesce(st.publish_counter, 0),
         st.last_rebuild_at,
         coalesce(st.coverage_from, p_from), coalesce(st.coverage_to, p_to)
    into v_version, v_counter, v_rebuilt, v_from, v_to
    from (select 1) one
    left join public.dashboard_kpi_store_state st on st.store_id = p_store_id;

  v_from := greatest(v_from, p_from);
  v_to := least(v_to, p_to);
  if v_from is null or v_to is null or v_from > v_to then
    return query select 0, 0, 0, 0, 0, coalesce(v_counter, 0), v_rebuilt;
    return;
  end if;

  v_expected := (v_to - v_from) + 1;

  with days as (
    select d::date as day
      from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
  ), flags as (
    select dy.day,
           exists (select 1 from public.dashboard_daily_metrics m
                    where m.store_id = p_store_id and m.business_date = dy.day
                      and m.axis = 'order' and m.definition_version = v_version) as has_part,
           exists (select 1 from public.dashboard_kpi_invalidation i
                    where i.store_id = p_store_id and i.business_date = dy.day
                      and i.processed_at is null) as is_dirty
      from days dy
  )
  select count(*) filter (where has_part and not is_dirty)::int,
         count(*) filter (where has_part and is_dirty)::int
    into v_computed, v_dirty
    from flags;

  select count(distinct i.business_date)::int into v_pending
    from public.dashboard_kpi_invalidation i
   where i.store_id = p_store_id and i.processed_at is null
     and i.business_date between v_from and v_to;

  expected_days := v_expected;
  computed_days := coalesce(v_computed, 0);
  dirty_days := coalesce(v_dirty, 0);
  -- Journées attendues ni calculées ni sales : elles doivent être backfillées,
  -- elles ne sont JAMAIS assimilées à zéro (B14=A).
  missing_days := greatest(0, v_expected - coalesce(v_computed, 0) - coalesce(v_dirty, 0));
  pending_partitions := coalesce(v_pending, 0);
  publish_counter := coalesce(v_counter, 0);
  last_rebuild_at := v_rebuilt;
  return next;
end;
$function$

-- @@END

-- @@FUNCTION 2c391f4c6ded13d4caf96fa31427c2a5 dashboard_kpi_direct_day(p_store_id uuid, p_date date, p_tz text)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_direct_day(p_store_id uuid, p_date date, p_tz text)
 RETURNS TABLE(orders_count integer, delivered_count integer, cancelled_count integer, returned_count integer, refused_count integer, pending_count integer, unclassified_count integer, revenue_items_gross numeric, revenue_estimated numeric, discount_amount numeric, delivery_charge_customer numeric, purchase_cost numeric, delivery_fee_cost numeric, confirmation_cost numeric, ads_tracked numeric, ads_allocated_raw numeric, ads_fallback_effective numeric, ads_daily_rows integer, orders_without_lines integer, delivered_without_lines integer, line_vs_total_mismatch integer, zero_purchase_with_revenue integer, data_issues_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with bounds as (
    select (p_date::timestamp at time zone p_tz) as b_start,
           ((p_date + 1)::timestamp at time zone p_tz) as b_end
  ), scoped as (
    select o.id, o.status, o.delivery_fee, o.confirmation_cost_allocated,
           o.ads_cost_allocated, o.buy_price, o.buy_price_source,
           o.discount_amount, o.delivery_charge_to_customer, o.total_selling_price
      from public.orders o, bounds b
     where o.store_id = p_store_id
       and o.order_date >= b.b_start and o.order_date < b.b_end
  ), items as (
    select oi.order_id,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_selling_price,0)) as rev,
           sum(coalesce(oi.quantity,0) * coalesce(oi.unit_purchase_cost_snapshot,0)) as pc,
           count(*) as n_lines
      from public.order_items oi join scoped s on s.id = oi.order_id
     group by oi.order_id
  ), joined as (
    select s.*, i.rev, i.pc, i.n_lines,
           public.order_purchase_cost(s.buy_price_source, s.buy_price,
                                      coalesce(i.pc, s.buy_price, 0)) as purchase
      from scoped s left join items i on i.order_id = s.id
  ), ads as (
    select coalesce(sum(coalesce(a.spend_converted, a.spend, 0)), 0) as tracked,
           count(*)::int as n_rows
      from public.ad_spend_daily a, bounds b
     where a.store_id = p_store_id
       and a.spend_date >= b.b_start and a.spend_date < b.b_end
  )
  select
    count(j.id)::int,
    count(j.id) filter (where j.status = 'delivered')::int,
    count(j.id) filter (where j.status = 'cancelled')::int,
    count(j.id) filter (where j.status in ('returned_stocked','returned_not_stocked'))::int,
    count(j.id) filter (where j.status = 'refused')::int,
    count(j.id) filter (where j.status in ('new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected'))::int,
    count(j.id) filter (where coalesce(j.status,'') not in ('delivered','cancelled','returned_stocked','returned_not_stocked','new','follow_up_1','follow_up_2','follow_up_3','follow_up_4','follow_up_5','no_answer','wrong_number','voicemail','confirmation_rejected','confirmed','picked_up','sent'))::int,
    coalesce(sum(coalesce(j.rev,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.total_selling_price,0)) filter (where j.status = 'delivered' and j.n_lines is null), 0),
    coalesce(sum(coalesce(j.discount_amount,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.delivery_charge_to_customer,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(j.purchase) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.delivery_fee,0)) filter (where j.status = 'delivered'), 0),
    coalesce(sum(coalesce(j.confirmation_cost_allocated,0)) filter (where j.status = 'delivered'), 0),
    (select tracked from ads),
    coalesce(sum(coalesce(j.ads_cost_allocated,0)) filter (where j.status = 'delivered'), 0),
    case when (select n_rows from ads) > 0 then 0
         else coalesce(sum(coalesce(j.ads_cost_allocated,0)) filter (where j.status = 'delivered'), 0) end,
    (select n_rows from ads),
    count(j.id) filter (where j.n_lines is null)::int,
    count(j.id) filter (where j.status = 'delivered' and j.n_lines is null)::int,
    count(j.id) filter (where j.status = 'delivered' and abs(coalesce(j.rev,0) - coalesce(j.total_selling_price,0)) > 0.01)::int,
    count(j.id) filter (where j.status = 'delivered' and coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0)::int,
    count(j.id) filter (where j.n_lines is null
      or (j.status = 'delivered' and abs(coalesce(j.rev,0) - coalesce(j.total_selling_price,0)) > 0.01)
      or (j.status = 'delivered' and coalesce(j.rev,0) > 0 and coalesce(j.purchase,0) = 0))::int
  from joined j;
$function$

-- @@END

-- @@FUNCTION 3aae1ffbfbbba014d6de0c321559be21 dashboard_kpi_invalidate_insert_stmt()
CREATE OR REPLACE FUNCTION public.dashboard_kpi_invalidate_insert_stmt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_tx bigint := txid_current();
begin
  if tg_table_name = 'orders' then
    insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
    select o.store_id,
           (o.order_date at time zone coalesce(st.tz,'Africa/Casablanca'))::date,
           'orders:INSERT:stmt', v_tx
    from new_rows o
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    union all
    select o.store_id,
           (coalesce(o.delivered_at,o.order_date) at time zone coalesce(st.tz,'Africa/Casablanca'))::date,
           'orders:INSERT:stmt', v_tx
    from new_rows o
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    on conflict do nothing;
  elsif tg_table_name = 'order_items' then
    insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
    select o.store_id,
           (o.order_date at time zone coalesce(st.tz,'Africa/Casablanca'))::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id=ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    union all
    select o.store_id,
           (coalesce(o.delivered_at,o.order_date) at time zone coalesce(st.tz,'Africa/Casablanca'))::date,
           'order_items:INSERT:stmt', v_tx
    from new_rows ni
    join public.orders o on o.id=ni.order_id
    left join public.dashboard_kpi_store_state st on st.store_id=o.store_id
    where o.store_id is not null
    on conflict do nothing;
  elsif tg_table_name = 'ad_spend_daily' then
    insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
    select a.store_id,(a.spend_date at time zone coalesce(st.tz,'Africa/Casablanca'))::date,'ad_spend_daily:INSERT:stmt',v_tx
    from new_rows a
    left join public.dashboard_kpi_store_state st on st.store_id=a.store_id
    where a.store_id is not null
    on conflict do nothing;
  end if;
  return null;
end;
$function$

-- @@END

-- @@FUNCTION b5211b6ea09373280e81a3f38c0aa01a dashboard_kpi_invalidate_trg()
CREATE OR REPLACE FUNCTION public.dashboard_kpi_invalidate_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_relevant boolean := false;
  v_ns uuid; v_nd1 date; v_nd2 date; v_os uuid; v_od1 date; v_od2 date;
  v_tz text; v_tx bigint; v_new_ok boolean := false; v_old_ok boolean := false;
  v_s uuid; v_od timestamptz; v_dd timestamptz;
begin
  if tg_table_name = 'orders' then
    if tg_op in ('INSERT','DELETE') then v_relevant := true;
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
      if tg_op = 'UPDATE' and new.store_id = old.store_id and new.order_date = old.order_date
         and new.delivered_at is not distinct from old.delivered_at
         and current_setting('app.kpi_inv_order_' || replace(new.id::text,'-','_'), true) = '1' then
        return null;
      end if;
    end if;
    if tg_op <> 'DELETE' then
      v_ns := new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1 := (new.order_date at time zone v_tz)::date;
      v_nd2 := (coalesce(new.delivered_at,new.order_date) at time zone v_tz)::date;
      v_new_ok := true;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op='UPDATE' and old.store_id=new.store_id and old.order_date=new.order_date and old.delivered_at is not distinct from new.delivered_at then
        v_os:=v_ns; v_od1:=v_nd1; v_od2:=v_nd2; v_old_ok:=v_new_ok;
      else
        v_os:=old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1:=(old.order_date at time zone v_tz)::date;
        v_od2:=(coalesce(old.delivered_at,old.order_date) at time zone v_tz)::date;
        v_old_ok:=true;
      end if;
    end if;
  elsif tg_table_name = 'order_items' then
    if tg_op = 'INSERT' and current_setting('app.kpi_inv_order_' || replace(new.order_id::text, '-', '_'), true) = '1' then
      return null;
    end if;
    v_relevant := true;
    if tg_op <> 'DELETE' then
      select o.store_id,o.order_date,o.delivered_at into v_s,v_od,v_dd from public.orders o where o.id=new.order_id;
      if v_s is not null then
        v_ns:=v_s;
        v_tz := public.dashboard_kpi_store_tz_cached(v_s);
        v_nd1:=(v_od at time zone v_tz)::date;
        v_nd2:=(coalesce(v_dd,v_od) at time zone v_tz)::date;
        v_new_ok:=true;
      end if;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op='UPDATE' and old.order_id=new.order_id then
        v_os:=v_ns; v_od1:=v_nd1; v_od2:=v_nd2; v_old_ok:=v_new_ok;
      else
        select o.store_id,o.order_date,o.delivered_at into v_s,v_od,v_dd from public.orders o where o.id=old.order_id;
        if v_s is not null then
          v_os:=v_s;
          v_tz := public.dashboard_kpi_store_tz_cached(v_s);
          v_od1:=(v_od at time zone v_tz)::date;
          v_od2:=(coalesce(v_dd,v_od) at time zone v_tz)::date;
          v_old_ok:=true;
        end if;
      end if;
    end if;
  elsif tg_table_name = 'ad_spend_daily' then
    v_relevant := true;
    if tg_op <> 'DELETE' then
      v_ns:=new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1:=(new.spend_date at time zone v_tz)::date;
      v_new_ok:=true;
    end if;
    if tg_op <> 'INSERT' then
      if tg_op='UPDATE' and old.store_id=new.store_id and old.spend_date=new.spend_date then
        v_os:=v_ns; v_od1:=v_nd1; v_old_ok:=v_new_ok;
      else
        v_os:=old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1:=(old.spend_date at time zone v_tz)::date;
        v_old_ok:=true;
      end if;
    end if;
  end if;
  if not v_relevant then return null; end if;
  v_tx := txid_current();
  insert into public.dashboard_kpi_invalidation (store_id,business_date,reason,note_tx)
  select v.s,v.d,v.r,v_tx from (values
    (v_ns,v_nd1,case when v_new_ok then tg_table_name||':'||tg_op||':order' end),
    (v_ns,v_nd2,case when v_new_ok then tg_table_name||':'||tg_op||':delivery' end),
    (v_os,v_od1,case when v_old_ok then tg_table_name||':'||tg_op||':order:old' end),
    (v_os,v_od2,case when v_old_ok then tg_table_name||':'||tg_op||':delivery:old' end)
  ) v(s,d,r)
  where v.s is not null and v.d is not null
  on conflict do nothing;
  if tg_table_name = 'order_items' then
    if tg_op = 'INSERT' and current_setting('app.kpi_inv_order_' || replace(new.order_id::text, '-', '_'), true) = '1' then
      return null;
    end if;
    if v_new_ok then
      perform set_config('app.kpi_inv_order_'||replace(new.order_id::text,'-','_'),'1',true);
    end if;
    if v_old_ok and (tg_op <> 'UPDATE' or old.order_id is distinct from new.order_id) then
      perform set_config('app.kpi_inv_order_'||replace(old.order_id::text,'-','_'),'1',true);
    end if;
  end if;
  return null;
end;
$function$

-- @@END

-- @@FUNCTION 51396e7b26984fc83a72852f79f9490e dashboard_kpi_mark_order_insert()
CREATE OR REPLACE FUNCTION public.dashboard_kpi_mark_order_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform set_config('app.kpi_inv_order_' || replace(new.id::text, '-', '_'), '1', true);
  return new;
end;
$function$

-- @@END

-- @@FUNCTION 81d9589acf86211d2f780540ebf7837f dashboard_kpi_note(p_store_id uuid, p_date date, p_reason text)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_note(p_store_id uuid, p_date date, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_noop int;
begin
  if p_store_id is null or p_date is null then return; end if;
  -- V4 : insertion INCONDITIONNELLE. Aucun état de session, aucune
  -- déduplication : une mutation pertinente ne peut pas être perdue.
  insert into public.dashboard_kpi_invalidation (store_id, business_date, reason)
  values (p_store_id, p_date, p_reason);
  v_noop := 1;
end;
$function$

-- @@END

-- @@FUNCTION 3008527119454e669ed7120c882cc8c3 dashboard_kpi_purge_orphans(p_limit integer)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_purge_orphans(p_limit integer DEFAULT 2000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_deleted int;
begin
  with victims as (
    select i.seq
      from public.dashboard_kpi_invalidation i
     where not exists (select 1 from public.stores s where s.id = i.store_id)
     order by i.seq
     limit greatest(1, least(p_limit, 20000))
  )
  delete from public.dashboard_kpi_invalidation i
   using victims v where i.seq = v.seq;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$

-- @@END

-- @@FUNCTION 853e33c7cc31d7b55713f086e675a3e0 dashboard_kpi_purge_processed(p_before timestamp with time zone, p_limit integer)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_purge_processed(p_before timestamp with time zone, p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_n int;
begin
  if p_before is null then raise exception 'KPI_PURGE_BEFORE_REQUIRED'; end if;
  with doomed as (
    select i.seq
      from public.dashboard_kpi_invalidation i
     where i.processed_at is not null
       and i.processed_at < p_before
     order by i.seq
     limit greatest(1, least(p_limit, 50000))
  ), del as (
    delete from public.dashboard_kpi_invalidation i
     using doomed d
     where i.seq = d.seq
       and i.processed_at is not null      -- double garde : jamais un non traité
    returning i.seq
  )
  select count(*)::int into v_n from del;
  return v_n;
end;
$function$

-- @@END

-- @@FUNCTION 8aec8d63bf32704a59ae2911448df0b5 dashboard_kpi_rebuild_day(p_store_id uuid, p_date date, p_token uuid, p_seqs bigint[])
CREATE OR REPLACE FUNCTION public.dashboard_kpi_rebuild_day(p_store_id uuid, p_date date, p_token uuid, p_seqs bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_version int;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_currency text;
  v_lock_key bigint;
  v_expected int := coalesce(array_length(p_seqs, 1), 0);
  v_acked int;
  v_owned int;
  v_pending int;
begin
  if v_expected = 0 then raise exception 'KPI_EMPTY_CLAIM'; end if;

  -- Le verrou a été pris par dashboard_kpi_claim dans la MÊME transaction.
  -- V4 : clé de verrou en BIGINT (hashtextextended renvoie bigint ; la V3
  -- stockait ce résultat dans un `int`, ce qui pouvait échouer au dépassement).
  v_lock_key := hashtextextended(p_store_id::text || '|' || p_date::text, 0);
  if not pg_try_advisory_xact_lock(v_lock_key) then
    raise exception 'KPI_PARTITION_NOT_LOCKED';
  end if;

  v_tz := public.dashboard_kpi_store_tz(p_store_id);
  v_start := (p_date::timestamp at time zone v_tz);
  v_end := ((p_date + 1)::timestamp at time zone v_tz);
  select s.currency into v_currency from public.stores s where s.id = p_store_id;
  select coalesce((select st.active_definition_version from public.dashboard_kpi_store_state st
                    where st.store_id = p_store_id), 1) into v_version;

  -- Les événements capturés doivent tous être encore NON traités (aucun autre
  -- worker ne peut les avoir pris : verrou exclusif de partition).
  select count(*) into v_owned
    from public.dashboard_kpi_invalidation i
   where i.store_id = p_store_id and i.business_date = p_date
     and i.processed_at is null and i.seq = any(p_seqs);
  if v_owned <> v_expected then raise exception 'KPI_LEASE_LOST'; end if;

  perform public.dashboard_kpi_aggregate_order(p_store_id, p_date, v_version, v_start, v_end, v_tz, v_currency, (select max(s) from unnest(p_seqs) s));
  perform public.dashboard_kpi_aggregate_delivery(p_store_id, p_date, v_version, v_start, v_end, v_tz, v_currency, (select max(s) from unnest(p_seqs) s));

  -- Acquittement NOMMATIF. La trace (claimed_by / claimed_at / claim_token)
  -- est CONSERVÉE pour l'observation (M08).
  update public.dashboard_kpi_invalidation i
     set processed_at = clock_timestamp(), last_error = null
   where i.store_id = p_store_id and i.business_date = p_date
     and i.processed_at is null and i.seq = any(p_seqs) and i.claim_token = p_token;
  get diagnostics v_acked = row_count;
  if v_acked <> v_expected then raise exception 'KPI_ACK_MISMATCH'; end if;

  select count(distinct (i.store_id, i.business_date))::int into v_pending
    from public.dashboard_kpi_invalidation i
   where i.store_id = p_store_id and i.processed_at is null;

  -- Publication : compteur MONOTONE incrémenté à chaque publication utile (C04)
  insert into public.dashboard_kpi_store_state as st
    (store_id, publish_counter, last_event_seq, last_rebuild_at, pending_partitions, last_error)
  values (p_store_id, 1, (select max(s) from unnest(p_seqs) s), clock_timestamp(), v_pending, null)
  on conflict (store_id) do update
    set publish_counter = st.publish_counter + 1,
        last_event_seq  = greatest(st.last_event_seq, excluded.last_event_seq),
        last_rebuild_at = clock_timestamp(),
        pending_partitions = v_pending,
        last_error = null,
        updated_at = clock_timestamp();
end;
$function$

-- @@END

-- @@FUNCTION 05bca036ec529dd9aa7e9e0252a46630 dashboard_kpi_resume(p_max_partitions integer, p_worker text)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_resume(p_max_partitions integer DEFAULT 25, p_worker text DEFAULT 'resume'::text)
 RETURNS TABLE(rebuilt integer, failed integer, backoff integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  return query
    select r.rebuilt, r.failed, r.backoff
      from public.dashboard_kpi_resume(p_max_partitions, p_worker, false) r;
end;
$function$

-- @@END

-- @@FUNCTION 4d34370a91eb2a8e98e74fdeb9821f3e dashboard_kpi_resume(p_max_partitions integer, p_worker text, p_force boolean)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_resume(p_max_partitions integer, p_worker text, p_force boolean)
 RETURNS TABLE(rebuilt integer, failed integer, backoff integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit int := greatest(1, least(p_max_partitions, 200));
  v_row record;
  v_ok int := 0;
  v_ko int := 0;
  v_enabled boolean;
begin
  -- ARRÊT EFFECTIF : le même interrupteur que le worker gouverne aussi la
  -- reprise manuelle. Sans p_force, aucun travail n'est engagé.
  select c.enabled into v_enabled
    from public.dashboard_kpi_worker_config c where c.id = 1;

  if coalesce(p_force, false) is not true and v_enabled is not true then
    raise exception 'KPI_WORKER_DISABLED';
  end if;

  for v_row in select c.* from public.dashboard_kpi_claim(v_limit, p_worker) c
  loop
    begin
      perform public.dashboard_kpi_rebuild_day(
        v_row.r_store_id, v_row.r_business_date, v_row.r_token, v_row.r_seqs);
      v_ok := v_ok + 1;
    exception when others then
      v_ko := v_ko + 1;
      update public.dashboard_kpi_invalidation i
         set lease_expires_at = clock_timestamp()
               + make_interval(secs => least(300, 5 * greatest(i.attempts, 1))),
             last_error = left(sqlerrm, 300)
       where i.store_id = v_row.r_store_id
         and i.business_date = v_row.r_business_date
         and i.processed_at is null
         and i.claim_token = v_row.r_token;
      update public.dashboard_kpi_store_state st
         set last_error = left(sqlerrm, 300), updated_at = clock_timestamp()
       where st.store_id = v_row.r_store_id;
    end;
  end loop;

  rebuilt := v_ok;
  failed := v_ko;
  backoff := v_ko;
  return next;
end;
$function$

-- @@END

-- @@FUNCTION cbbd7d2d0749d39f09d7c5277ff20676 dashboard_kpi_store_tz(p_store_id uuid)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_store_tz(p_store_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((select s.tz from public.dashboard_kpi_store_state s where s.store_id = p_store_id),
                  'Africa/Casablanca')
$function$

-- @@END

-- @@FUNCTION 312a695945c03e26f38bd8534ff8e03d dashboard_kpi_store_tz_cached(p_store_id uuid)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_store_tz_cached(p_store_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_key text; v_tz text;
BEGIN
  IF p_store_id IS NULL THEN RETURN NULL; END IF;
  v_key := 'app.kpi_tz_' || replace(p_store_id::text, '-', '_');
  v_tz := current_setting(v_key, true);
  IF v_tz IS NULL OR v_tz = '' THEN
    SELECT coalesce(st.tz, 'Africa/Casablanca') INTO v_tz
      FROM public.dashboard_kpi_store_state st WHERE st.store_id = p_store_id;
    IF v_tz IS NULL THEN v_tz := 'Africa/Casablanca'; END IF;
    PERFORM set_config(v_key, v_tz, true);
  END IF;
  RETURN v_tz;
END $function$

-- @@END

-- @@FUNCTION 76ab1f2492efe081dac1d39c620866ab dashboard_kpi_wakeup_trg()
CREATE OR REPLACE FUNCTION public.dashboard_kpi_wakeup_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_enabled   boolean;
  v_url       text;
  v_host      text;
  v_secret    text;
  v_secret_name text;
  v_backlog   bigint;
  v_threshold bigint;
  v_request   bigint;
  v_parts     text[];
begin
  -- 1) Un seul envoi par transaction (drapeau local, réinitialisé au commit).
  if coalesce(current_setting('app.kpi_wakeup_sent', true), '') = '1' then
    return null;
  end if;

  -- 2) Configuration lue dans une table PRIVILÉGIÉE (V5) : aucun réglage de
  --    session. Un rôle client ne peut donc ni choisir la cible réseau, ni
  --    le seuil anti-rafale, ni exfiltrer le secret.
  select c.enabled, c.url, c.host, c.secret_name, c.backlog_threshold
    into v_enabled, v_url, v_host, v_secret_name, v_threshold
    from public.dashboard_kpi_wakeup_config c
   where c.id = 1;

  if v_enabled is not true then
    update public.dashboard_kpi_store_state st
       set last_wakeup_status = 'disabled', updated_at = clock_timestamp()
     where st.store_id = new.store_id;
    return null;
  end if;

  begin
    select d.decrypted_secret into v_secret
      from vault.decrypted_secrets d
     where d.name = coalesce(v_secret_name, 'dashboard_kpi_wakeup_secret') limit 1;
  exception when others then
    v_secret := null;
  end;

  if v_url is null or v_secret is null or v_host is null then
    update public.dashboard_kpi_store_state st
       set last_wakeup_status = 'invalid_configuration', updated_at = clock_timestamp()
     where st.store_id = new.store_id;
    return null;
  end if;

  -- V4/V5 : comparaison STRICTE de l'hôte (HTTPS, sans userinfo, hôte exact).
  v_parts := regexp_match(v_url, '^https://([^/:@]+)(?::[0-9]{1,5})?(?:/|$)');
  if v_parts is null or v_parts[1] is distinct from v_host then
    update public.dashboard_kpi_store_state st
       set last_wakeup_status = 'invalid_configuration', updated_at = clock_timestamp()
     where st.store_id = new.store_id;
    return null;
  end if;

  -- 3) Anti-rafale : backlog important => la reprise planifiée prend le relais.
  select count(*) into v_backlog from public.dashboard_kpi_invalidation i where i.processed_at is null;
  if v_backlog > coalesce(v_threshold, 50) then
    update public.dashboard_kpi_store_state st
       set last_wakeup_status = 'blocked_backlog', updated_at = clock_timestamp()
     where st.store_id = new.store_id;
    return null;
  end if;

  perform set_config('app.kpi_wakeup_sent', '1', true);

  -- 4) L'échec de mise en file ne doit JAMAIS faire échouer l'écriture métier.
  begin
    v_request := net.http_post(
      url     := v_url,
      body    := jsonb_build_object('source','dashboard_kpi','at',clock_timestamp()),
      headers := jsonb_build_object('Content-Type','application/json','x-kpi-secret',v_secret)
    );
    update public.dashboard_kpi_store_state st
       set last_wakeup_sent_at = clock_timestamp(),
           last_wakeup_request_id = v_request,
           last_wakeup_status = 'queued',
           updated_at = clock_timestamp()
     where st.store_id = new.store_id;
  exception when others then
    update public.dashboard_kpi_store_state st
       set last_error = 'wakeup_failed: ' || left(sqlerrm, 200),
           last_wakeup_status = 'enqueue_failed',
           updated_at = clock_timestamp()
     where st.store_id = new.store_id;
  end;
  return null;
end;
$function$

-- @@END

-- @@FUNCTION 938ec03cbb7fa48c25f4b0678b9e0f7c dashboard_kpi_worker_purge_runs(p_before timestamp with time zone, p_limit integer)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_worker_purge_runs(p_before timestamp with time zone, p_limit integer DEFAULT 5000)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_deleted int;
begin
  if p_before is null then raise exception 'KPI_PURGE_BEFORE_REQUIRED'; end if;
  with victims as (
    select w.run_id from public.dashboard_kpi_worker_run w
     where w.ended_at < p_before
     order by w.run_id
     limit greatest(1, least(p_limit, 50000))
  )
  delete from public.dashboard_kpi_worker_run w
   using victims v where w.run_id = v.run_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$

-- @@END

-- @@FUNCTION f41abff2c59cbba39ef740740307eb07 dashboard_kpi_worker_run(p_worker text, p_max_partitions integer, p_max_events bigint, p_max_seconds numeric)
CREATE OR REPLACE FUNCTION public.dashboard_kpi_worker_run(p_worker text DEFAULT 'cron'::text, p_max_partitions integer DEFAULT NULL::integer, p_max_events bigint DEFAULT NULL::bigint, p_max_seconds numeric DEFAULT NULL::numeric)
 RETURNS TABLE(partitions_rebuilt integer, partitions_failed integer, events_processed bigint, stop_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_started timestamptz := clock_timestamp();
  v_ended timestamptz;
  v_deadline timestamptz;
  v_ok int := 0;
  v_ko int := 0;
  v_events bigint := 0;
  v_row record;
  v_stop text := 'idle';
  v_last_outcome text;          -- 'ok' | 'error' | null
  v_last_error text;
  v_enabled boolean;
  v_max_partitions int;
  v_max_events bigint;
  v_max_seconds numeric;
  v_statement_timeout_ms int;
begin
  select c.enabled, c.max_partitions_per_run, c.max_events_per_run,
         c.max_seconds_per_run, c.statement_timeout_ms
    into v_enabled, v_max_partitions, v_max_events, v_max_seconds, v_statement_timeout_ms
    from public.dashboard_kpi_worker_config c
   where c.id = 1;

  if v_enabled is null then
    partitions_rebuilt := 0; partitions_failed := 0; events_processed := 0;
    stop_reason := 'no_configuration';
    return next; return;
  end if;

  if v_enabled is not true then
    partitions_rebuilt := 0; partitions_failed := 0; events_processed := 0;
    stop_reason := 'disabled';
    return next; return;
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('dashboard_kpi_worker', 0)) then
    partitions_rebuilt := 0; partitions_failed := 0; events_processed := 0;
    stop_reason := 'concurrent_run';
    return next; return;
  end if;

  v_max_partitions := greatest(1, least(coalesce(p_max_partitions, v_max_partitions), 50));
  v_max_events := greatest(1::bigint, least(coalesce(p_max_events, v_max_events), 100000::bigint));
  v_max_seconds := greatest(0.50::numeric, least(coalesce(p_max_seconds, v_max_seconds), 30.00::numeric));
  v_deadline := v_started + make_interval(secs => v_max_seconds);

  perform set_config('statement_timeout', v_statement_timeout_ms::text || 'ms', true);
  perform set_config('lock_timeout', '2000ms', true);

  loop
    select c.enabled into v_enabled
      from public.dashboard_kpi_worker_config c where c.id = 1;
    if v_enabled is not true then
      v_stop := 'disabled_mid_run'; exit;
    end if;

    if clock_timestamp() >= v_deadline then v_stop := 'time_budget'; exit; end if;
    if v_ok >= v_max_partitions then v_stop := 'partition_budget'; exit; end if;
    if v_events >= v_max_events then v_stop := 'event_budget'; exit; end if;

    select c.* into v_row
      from public.dashboard_kpi_claim(1, p_worker) c
     limit 1;

    if v_row is null or v_row.r_store_id is null then
      v_stop := case
                  when v_last_outcome = 'error' then 'partition_error'
                  when v_ok = 0 and v_ko = 0 then 'idle'
                  else 'drained'
                end;
      exit;
    end if;

    begin
      perform public.dashboard_kpi_rebuild_day(
        v_row.r_store_id, v_row.r_business_date, v_row.r_token, v_row.r_seqs);
      v_ok := v_ok + 1;
      v_events := v_events + coalesce(array_length(v_row.r_seqs, 1), 0);
      v_last_outcome := 'ok';
    exception when others then
      v_ko := v_ko + 1;
      v_last_outcome := 'error';
      v_last_error := left(sqlerrm, 300);
      v_stop := 'partition_error';

      update public.dashboard_kpi_invalidation i
         set lease_expires_at = clock_timestamp()
               + make_interval(secs => least(300, 5 * greatest(i.attempts, 1))),
             last_error = v_last_error
       where i.store_id = v_row.r_store_id
         and i.business_date = v_row.r_business_date
         and i.processed_at is null
         and i.claim_token = v_row.r_token;

      update public.dashboard_kpi_store_state st
         set last_error = v_last_error, updated_at = clock_timestamp()
       where st.store_id = v_row.r_store_id;
    end;
  end loop;

  if v_ok > 0 or v_ko > 0 then
    v_ended := clock_timestamp();
    insert into public.dashboard_kpi_worker_run
      (worker, started_at, ended_at, duration_ms,
       partitions_rebuilt, partitions_failed, events_processed, stop_reason, last_error)
    values
      (coalesce(p_worker, 'cron'), v_started, v_ended,
       round(extract(epoch from (v_ended - v_started)) * 1000, 3),
       v_ok, v_ko, v_events, v_stop, v_last_error);
  end if;

  partitions_rebuilt := v_ok;
  partitions_failed := v_ko;
  events_processed := v_events;
  stop_reason := v_stop;
  return next;
end;
$function$

-- @@END

-- @@FUNCTION ea603cf2f66e47f7f57c79a985352e2d rpc_dashboard_kpi_reader(p_store_ids uuid[], p_from date, p_to date, p_include_direct boolean)
CREATE OR REPLACE FUNCTION public.rpc_dashboard_kpi_reader(p_store_ids uuid[] DEFAULT NULL::uuid[], p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_include_direct boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'KPI_UNAUTHENTICATED'; end if;
  if p_from is null or p_to is null then raise exception 'KPI_BAD_RANGE'; end if;
  if p_to <= p_from then raise exception 'KPI_BAD_RANGE'; end if;
  if (p_to - p_from) > 400 then raise exception 'KPI_RANGE_TOO_LARGE'; end if;

  with resolved as (
    select s.id, s.currency,
           coalesce(st.tz, 'Africa/Casablanca') as tz,
           coalesce(st.active_definition_version, 1) as ver,
           coalesce(st.publish_counter, 0) as rev,
           st.last_rebuild_at,
           public.dashboard_kpi_access_level(s.id) as lvl
      from public.stores s
      left join public.dashboard_kpi_store_state st on st.store_id = s.id
     where (p_store_ids is null or s.id = any(p_store_ids))
  ),
  authorized as (select * from resolved where lvl <> 'none'),
  days as (select d::date as bd from generate_series(p_from, p_to - 1, interval '1 day') d),
  grid as (
    select a.id, a.currency, a.tz, a.ver, a.rev, a.last_rebuild_at, a.lvl, d.bd
      from authorized a cross join days d
  ),
  flagged as (
    select g.*,
           (m.store_id is not null) as has_part,
           exists (select 1 from public.dashboard_kpi_invalidation i
                    where i.store_id = g.id and i.business_date = g.bd
                      and i.processed_at is null) as pending_note,
           exists (select 1 from public.dashboard_daily_metrics x
                    where x.store_id = g.id and x.business_date = g.bd and x.axis = 'order'
                      and (x.definition_version <> g.ver or x.tz_used <> g.tz)) as incompatible,
           m.orders_count as a_orders, m.delivered_count as a_dlv,
           m.cancelled_count as a_canc, m.returned_count as a_ret, m.refused_count as a_ref,
           m.pending_count as a_pend, m.unclassified_count as a_uncl,
           m.revenue_items_gross as a_rev, m.revenue_estimated as a_rev_est,
           m.discount_amount as a_disc, m.delivery_charge_customer as a_dcc,
           m.purchase_cost as a_pc, m.delivery_fee_cost as a_dfc, m.confirmation_cost as a_cc,
           m.ads_tracked as a_trk, m.ads_fallback_effective as a_fb, m.ads_daily_rows as a_adr,
           m.orders_without_lines as a_owl, m.delivered_without_lines as a_dwl,
           m.line_vs_total_mismatch as a_lvtm, m.zero_purchase_with_revenue as a_zpwr,
           m.data_issues_count as a_iss
      from grid g
      left join public.dashboard_daily_metrics m
        on m.store_id = g.id and m.business_date = g.bd and m.axis = 'order'
       and m.definition_version = g.ver and m.tz_used = g.tz
       and m.currency_code is not distinct from g.currency
  ),
  stated as (
    select f.*,
           case when f.has_part and f.pending_note then 'dirty'
                when f.has_part then 'aggregate'
                when f.incompatible then 'incompatible'
                else 'missing' end as state
      from flagged f
  ),
  candidates as (
    select id, bd, row_number() over (order by id, bd) as rn
      from stated where state in ('missing','dirty')
  ),
  decided as (
    select s.*,
           case when p_include_direct and c.rn is not null and c.rn <= 7 then 'direct' else s.state end as final_state,
           x.*
      from stated s
      left join candidates c on c.id = s.id and c.bd = s.bd
      left join lateral (
        select * from public.dashboard_kpi_direct_day(s.id, s.bd, s.tz)
         where p_include_direct and c.rn is not null and c.rn <= 7
      ) x on true
  ),
  norm as (
    select d.id as store_id, d.currency, d.tz, d.ver, d.rev, d.last_rebuild_at, d.lvl, d.bd,
           d.final_state as state,
           (d.bd = (now() at time zone d.tz)::date) as partial,
           case when d.final_state = 'aggregate' then d.a_orders      else d.orders_count end as orders_count,
           case when d.final_state = 'aggregate' then d.a_dlv         else d.delivered_count end as delivered_count,
           case when d.final_state = 'aggregate' then d.a_canc        else d.cancelled_count end as cancelled_count,
           case when d.final_state = 'aggregate' then d.a_ret         else d.returned_count end as returned_count,
           case when d.final_state = 'aggregate' then d.a_ref         else d.refused_count end as refused_count,
           case when d.final_state = 'aggregate' then d.a_pend        else d.pending_count end as pending_count,
           case when d.final_state = 'aggregate' then d.a_uncl        else d.unclassified_count end as unclassified_count,
           case when d.final_state = 'aggregate' then d.a_rev         else d.revenue_items_gross end as revenue_items_gross,
           case when d.final_state = 'aggregate' then d.a_rev_est     else d.revenue_estimated end as revenue_estimated,
           case when d.final_state = 'aggregate' then d.a_disc        else d.discount_amount end as discount_amount,
           case when d.final_state = 'aggregate' then d.a_dcc         else d.delivery_charge_customer end as delivery_charge_customer,
           case when d.final_state = 'aggregate' then d.a_pc          else d.purchase_cost end as purchase_cost,
           case when d.final_state = 'aggregate' then d.a_dfc         else d.delivery_fee_cost end as delivery_fee_cost,
           case when d.final_state = 'aggregate' then d.a_cc          else d.confirmation_cost end as confirmation_cost,
           case when d.final_state = 'aggregate' then d.a_trk         else d.ads_tracked end as ads_tracked,
           case when d.final_state = 'aggregate' then d.a_fb          else d.ads_fallback_effective end as ads_fallback,
           case when d.final_state = 'aggregate' then d.a_adr         else d.ads_daily_rows end as ads_daily_rows,
           case when d.final_state = 'aggregate' then d.a_owl         else d.orders_without_lines end as orders_without_lines,
           case when d.final_state = 'aggregate' then d.a_dwl         else d.delivered_without_lines end as delivered_without_lines,
           case when d.final_state = 'aggregate' then d.a_lvtm        else d.line_vs_total_mismatch end as line_vs_total_mismatch,
           case when d.final_state = 'aggregate' then d.a_zpwr        else d.zero_purchase_with_revenue end as zero_purchase_with_revenue,
           case when d.final_state = 'aggregate' then d.a_iss         else d.data_issues_count end as data_issues_count
      from decided d
  ),
  store_totals as (
    select store_id, currency, tz, ver, rev, last_rebuild_at, lvl,
           count(*) as days_total,
           count(*) filter (where state = 'aggregate') as days_aggregate,
           count(*) filter (where state = 'direct') as days_direct,
           count(*) filter (where state = 'dirty') as days_dirty,
           count(*) filter (where state = 'missing') as days_missing,
           count(*) filter (where state = 'incompatible') as days_incompatible,
           count(*) filter (where partial and state in ('aggregate','direct')) as days_partial,
           coalesce(sum(orders_count) filter (where state in ('aggregate','direct')), 0) as orders_count,
           coalesce(sum(delivered_count) filter (where state in ('aggregate','direct')), 0) as delivered_count,
           coalesce(sum(cancelled_count) filter (where state in ('aggregate','direct')), 0) as cancelled_count,
           coalesce(sum(returned_count) filter (where state in ('aggregate','direct')), 0) as returned_count,
           coalesce(sum(refused_count) filter (where state in ('aggregate','direct')), 0) as refused_count,
           coalesce(sum(pending_count) filter (where state in ('aggregate','direct')), 0) as pending_count,
           coalesce(sum(unclassified_count) filter (where state in ('aggregate','direct')), 0) as unclassified_count,
           coalesce(sum(revenue_items_gross) filter (where state in ('aggregate','direct')), 0) as revenue_items_gross,
           coalesce(sum(revenue_estimated) filter (where state in ('aggregate','direct')), 0) as revenue_estimated,
           coalesce(sum(discount_amount) filter (where state in ('aggregate','direct')), 0) as discount_amount,
           coalesce(sum(delivery_charge_customer) filter (where state in ('aggregate','direct')), 0) as delivery_charge_customer,
           coalesce(sum(purchase_cost) filter (where state in ('aggregate','direct')), 0) as purchase_cost,
           coalesce(sum(delivery_fee_cost) filter (where state in ('aggregate','direct')), 0) as delivery_fee_cost,
           coalesce(sum(confirmation_cost) filter (where state in ('aggregate','direct')), 0) as confirmation_cost,
           coalesce(sum(ads_tracked) filter (where state in ('aggregate','direct')), 0) as ads_tracked,
           coalesce(sum(ads_fallback) filter (where state in ('aggregate','direct')), 0) as ads_fallback,
           coalesce(sum(ads_daily_rows) filter (where state in ('aggregate','direct')), 0) as ads_daily_rows,
           coalesce(sum(orders_without_lines) filter (where state in ('aggregate','direct')), 0) as orders_without_lines,
           coalesce(sum(delivered_without_lines) filter (where state in ('aggregate','direct')), 0) as delivered_without_lines,
           coalesce(sum(line_vs_total_mismatch) filter (where state in ('aggregate','direct')), 0) as line_vs_total_mismatch,
           coalesce(sum(zero_purchase_with_revenue) filter (where state in ('aggregate','direct')), 0) as zero_purchase_with_revenue,
           coalesce(sum(data_issues_count) filter (where state in ('aggregate','direct')), 0) as data_issues_count
      from norm
     group by store_id, currency, tz, ver, rev, last_rebuild_at, lvl
  ),
  points as (
    select n.store_id, n.bd,
           jsonb_build_object(
             'date', n.bd,
             'state', n.state,
             'partial', n.partial,
             'orders_count', n.orders_count,
             'delivered_count', n.delivered_count,
             'cancelled_count', n.cancelled_count,
             'returned_count', n.returned_count,
             'pending_count', n.pending_count,
             'unclassified_count', n.unclassified_count,
             'revenue', n.revenue_items_gross::text,
             'ads', (coalesce(n.ads_tracked,0) + coalesce(n.ads_fallback,0))::text,
             'purchase_cost', n.purchase_cost::text,
             'contribution_margin',
               (coalesce(n.revenue_items_gross,0) - coalesce(n.purchase_cost,0)
                - coalesce(n.delivery_fee_cost,0) - coalesce(n.confirmation_cost,0)
                - coalesce(n.ads_tracked,0) - coalesce(n.ads_fallback,0))::text
           ) as pt
      from norm n
     where n.state in ('aggregate','direct')
  ),
  points_gated as (
    select p.store_id, p.bd,
           case when t.lvl = 'full' then p.pt else p.pt - 'purchase_cost' - 'contribution_margin' end as pt
      from points p join store_totals t on t.store_id = p.store_id
  ),
  store_json as (
    select t.store_id,
           jsonb_build_object(
             'store_id', t.store_id,
             'access', t.lvl,
             'currency', t.currency,
             'tz', t.tz,
             'definition_version', t.ver,
             'revision', t.rev::text,
             'last_rebuild_at', t.last_rebuild_at,
             'coverage', jsonb_build_object(
               'days_total', t.days_total,
               'days_aggregate', t.days_aggregate,
               'days_direct', t.days_direct,
               'days_dirty', t.days_dirty,
               'days_missing', t.days_missing,
               'days_incompatible', t.days_incompatible,
               'days_partial', t.days_partial
             ),
             'incomplete', (t.days_dirty + t.days_missing + t.days_incompatible) > 0,
             'totals', (
               case when t.lvl = 'full' then jsonb_build_object(
                 'orders_count', t.orders_count,
                 'delivered_count', t.delivered_count,
                 'cancelled_count', t.cancelled_count,
                 'returned_count', t.returned_count,
                 'refused_count', t.refused_count,
                 'pending_count', t.pending_count,
                 'unclassified_count', t.unclassified_count,
                 'revenue', t.revenue_items_gross::text,
                 'revenue_estimated', t.revenue_estimated::text,
                 'discount_amount', t.discount_amount::text,
                 'delivery_charge_customer', t.delivery_charge_customer::text,
                 'purchase_cost', t.purchase_cost::text,
                 'delivery_fee_cost', t.delivery_fee_cost::text,
                 'confirmation_cost', t.confirmation_cost::text,
                 'ads_tracked', t.ads_tracked::text,
                 'ads_fallback', t.ads_fallback::text,
                 'ad_spend_contract', (t.ads_tracked + t.ads_fallback)::text,
                 'ads_daily_days', t.ads_daily_rows,
                 'contribution_margin', (t.revenue_items_gross - t.purchase_cost - t.delivery_fee_cost
                                         - t.confirmation_cost - t.ads_tracked - t.ads_fallback)::text,
                 'aov', (case when t.delivered_count > 0 then t.revenue_items_gross / t.delivered_count else 0 end)::text,
                 'delivery_rate', (case when t.orders_count > 0 then 100.0 * t.delivered_count / t.orders_count else 0 end)::text,
                 'margin_rate', (case when t.revenue_items_gross <> 0
                                      then 100.0 * (t.revenue_items_gross - t.purchase_cost - t.delivery_fee_cost
                                                    - t.confirmation_cost - t.ads_tracked - t.ads_fallback)
                                           / t.revenue_items_gross else 0 end)::text,
                 'cpl', (case when t.orders_count > 0 then (t.ads_tracked + t.ads_fallback) / t.orders_count else 0 end)::text,
                 'cpa', (case when t.delivered_count > 0 then (t.ads_tracked + t.ads_fallback) / t.delivered_count else 0 end)::text,
                 'roas', (case when (t.ads_tracked + t.ads_fallback) > 0
                               then t.revenue_items_gross / (t.ads_tracked + t.ads_fallback) else 0 end)::text,
                 'quality', jsonb_build_object(
                   'orders_without_lines', t.orders_without_lines,
                   'delivered_without_lines', t.delivered_without_lines,
                   'line_vs_total_mismatch', t.line_vs_total_mismatch,
                   'zero_purchase_with_revenue', t.zero_purchase_with_revenue,
                   'data_issues_count', t.data_issues_count
                 )
               ) else jsonb_build_object(
                 'orders_count', t.orders_count,
                 'delivered_count', t.delivered_count,
                 'cancelled_count', t.cancelled_count,
                 'returned_count', t.returned_count,
                 'refused_count', t.refused_count,
                 'pending_count', t.pending_count,
                 'unclassified_count', t.unclassified_count,
                 'revenue', t.revenue_items_gross::text,
                 'revenue_estimated', t.revenue_estimated::text,
                 'discount_amount', t.discount_amount::text,
                 'delivery_charge_customer', t.delivery_charge_customer::text,
                 'ads_tracked', t.ads_tracked::text,
                 'ads_fallback', t.ads_fallback::text,
                 'ad_spend_contract', (t.ads_tracked + t.ads_fallback)::text,
                 'ads_daily_days', t.ads_daily_rows,
                 'aov', (case when t.delivered_count > 0 then t.revenue_items_gross / t.delivered_count else 0 end)::text,
                 'delivery_rate', (case when t.orders_count > 0 then 100.0 * t.delivered_count / t.orders_count else 0 end)::text,
                 'cpl', (case when t.orders_count > 0 then (t.ads_tracked + t.ads_fallback) / t.orders_count else 0 end)::text,
                 'cpa', (case when t.delivered_count > 0 then (t.ads_tracked + t.ads_fallback) / t.delivered_count else 0 end)::text,
                 'roas', (case when (t.ads_tracked + t.ads_fallback) > 0
                               then t.revenue_items_gross / (t.ads_tracked + t.ads_fallback) else 0 end)::text,
                 'quality', jsonb_build_object(
                   'orders_without_lines', t.orders_without_lines,
                   'delivered_without_lines', t.delivered_without_lines,
                   'line_vs_total_mismatch', t.line_vs_total_mismatch
                 )
               ) end
             ),
             'points', coalesce((select jsonb_agg(pg.pt order by pg.bd) from points_gated pg where pg.store_id = t.store_id), '[]'::jsonb)
           ) as js
      from store_totals t
  ),
  currency_totals as (
    select n.currency,
           sum(n.orders_count) filter (where n.state in ('aggregate','direct')) as orders_count,
           sum(n.delivered_count) filter (where n.state in ('aggregate','direct')) as delivered_count,
           sum(n.revenue_items_gross) filter (where n.state in ('aggregate','direct')) as revenue,
           sum(n.purchase_cost) filter (where n.state in ('aggregate','direct')) as purchase_cost,
           sum(n.ads_tracked) filter (where n.state in ('aggregate','direct')) as ads_tracked,
           sum(n.ads_fallback) filter (where n.state in ('aggregate','direct')) as ads_fallback
      from norm n group by n.currency
  )
  select jsonb_build_object(
    'definition_version', (select max(ver) from store_totals),
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'generated_at', now(),
    'direct_budget', jsonb_build_object('limit', 7,
      'used', (select count(*) from norm where state = 'direct')),
    'incomplete', (select coalesce(bool_or((days_dirty + days_missing + days_incompatible) > 0), false)
                     from store_totals),
    'stores', coalesce((select jsonb_agg(sj.js order by sj.store_id) from store_json sj), '[]'::jsonb),
    'currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', c.currency,
        'totals', jsonb_build_object(
          'orders_count', c.orders_count,
          'delivered_count', c.delivered_count,
          'revenue', c.revenue::text,
          'ads', (coalesce(c.ads_tracked,0) + coalesce(c.ads_fallback,0))::text
        )
      ) order by c.currency)
      from currency_totals c), '[]'::jsonb)
  ) into v_result
  from grid;

  if (select count(*) from jsonb_array_elements(v_result->'stores')) = 0 then
    raise exception 'KPI_NO_ACCESS';
  end if;

  return v_result;
end;
$function$

-- @@END