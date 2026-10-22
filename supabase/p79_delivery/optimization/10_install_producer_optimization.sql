-- ============================================================================
-- JISRA — P7.10 : optimisation des producteurs KPI V5 (INSTALLATION INACTIVE)
-- ============================================================================
-- Portée : configuration de capture par boutique, portes d'éligibilité,
--          déduplication avant insertion, filtres de pertinence, marqueurs.
-- Aucun trigger n'est créé ici : voir 20_activate_producers_optimized.sql.
-- Aucune donnée métier, aucun worker, aucune cohorte lecteur n'est touché.
--
-- Exécution : psql -X -w -v ON_ERROR_STOP=1 --single-transaction
--              -c "set kpi.producers_opt_authorized='yes'" -f ce_fichier
--
-- Invariants préservés :
--   * signatures des producteurs existants inchangées ;
--   * SECURITY DEFINER + search_path identiques ;
--   * propriétaires (postgres) et ACL identiques ;
--   * compatibilité Casablanca IANA 2026c via dashboard_kpi_local_ts.
-- ============================================================================
\set ON_ERROR_STOP on
\pset pager off
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $guard$
begin
  if current_setting('kpi.producers_opt_authorized', true) is distinct from 'yes' then
    raise exception 'PRODUCERS_OPT_NOT_AUTHORIZED';
  end if;
  if current_database() <> 'postgres' then
    raise exception 'PRODUCERS_OPT_IDENTITY';
  end if;
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'PRODUCERS_OPT_READ_ONLY';
  end if;
  -- Le socle final (Casablanca compris) doit etre installe.
  if to_regclass('public.dashboard_kpi_invalidation') is null
     or to_regclass('public.dashboard_kpi_store_state') is null
     or to_regprocedure('public.dashboard_kpi_local_ts(timestamp with time zone,text)') is null
     or to_regprocedure('public.dashboard_kpi_invalidate_trg()') is null
     or to_regprocedure('public.dashboard_kpi_invalidate_insert_stmt()') is null
     or to_regprocedure('public.dashboard_kpi_mark_order_insert()') is null
     or to_regprocedure('public.dashboard_kpi_invalidate_orders_quality_trg()') is null then
    raise exception 'PRODUCERS_OPT_MISSING_SOCLE';
  end if;
end
$guard$;

-- ----------------------------------------------------------------------------
-- 1. Configuration dédiée aux producteurs (indépendante des cohortes lecteur)
-- ----------------------------------------------------------------------------
create table if not exists public.dashboard_kpi_producer_config (
  id smallint not null default 1,
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  constraint dashboard_kpi_producer_config_pkey primary key (id),
  constraint dashboard_kpi_producer_config_id_check check (id = 1)
);

insert into public.dashboard_kpi_producer_config as c (id, enabled)
values (1, false)
on conflict (id) do nothing;

comment on table public.dashboard_kpi_producer_config is
  'Armement global de la capture KPI. Défaut false : aucun producteur ne fait de travail tant que cette ligne reste désarmée, indépendamment des triggers installés.';

create table if not exists public.dashboard_kpi_producer_stores (
  store_id uuid not null,
  enabled boolean not null default false,
  disabled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  note text,
  constraint dashboard_kpi_producer_stores_pkey primary key (store_id)
);

comment on table public.dashboard_kpi_producer_stores is
  'Éligibilité de capture par boutique. Une boutique sans ligne est NON capturée. disabled_at borne le rattrapage obligatoire avant réactivation.';

create index if not exists idx_kpi_producer_stores_enabled
  on public.dashboard_kpi_producer_stores (store_id)
  where enabled;

alter table public.dashboard_kpi_producer_config enable row level security;
alter table public.dashboard_kpi_producer_stores enable row level security;

revoke all on table public.dashboard_kpi_producer_config from public, anon, authenticated;
revoke all on table public.dashboard_kpi_producer_stores from public, anon, authenticated;
grant all on table public.dashboard_kpi_producer_config to service_role;
grant all on table public.dashboard_kpi_producer_stores to service_role;

-- ----------------------------------------------------------------------------
-- 2. Portes d'éligibilité (cache transactionnel par boutique)
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_kpi_producers_armed()
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v text;
begin
  v := current_setting('app.kpi_prod_armed', true);
  if v is not null and v <> '' then
    return v = '1';
  end if;
  select c.enabled::text into v from public.dashboard_kpi_producer_config c where c.id = 1;
  v := case when coalesce(v::boolean, false) then '1' else '0' end;
  perform set_config('app.kpi_prod_armed', v, true);
  return v = '1';
end;
$function$;

create or replace function public.dashboard_kpi_producer_active(p_store_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_key text; v_cached text; v_on boolean;
begin
  if p_store_id is null then
    return false;
  end if;
  if not public.dashboard_kpi_producers_armed() then
    return false;
  end if;
  v_key := 'app.kpi_prod_store_' || replace(p_store_id::text, '-', '_');
  v_cached := current_setting(v_key, true);
  if v_cached is not null and v_cached <> '' then
    return v_cached = '1';
  end if;
  select s.enabled into v_on
    from public.dashboard_kpi_producer_stores s
   where s.store_id = p_store_id;
  v_on := coalesce(v_on, false);
  perform set_config(v_key, case when v_on then '1' else '0' end, true);
  return v_on;
end;
$function$;

revoke all on function public.dashboard_kpi_producers_armed() from public, anon, authenticated;
revoke all on function public.dashboard_kpi_producer_active(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_producers_armed() to service_role;
grant execute on function public.dashboard_kpi_producer_active(uuid) to service_role;

comment on function public.dashboard_kpi_producer_active(uuid) is
  'P7.10 : éligibilité de capture d''une boutique (armement global ET ligne boutique). Résultat mémorisé pour la transaction.';

-- ----------------------------------------------------------------------------
-- 3. Déduplication intra-transaction des couples (boutique, jour)
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_kpi_day_claimed(p_store_id uuid, p_day date)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_key text;
begin
  -- Une valeur nulle n'a pas de clé : le producteur filtrera la ligne.
  if p_store_id is null or p_day is null then
    return true;
  end if;
  v_key := 'app.kpi_day_' || replace(p_store_id::text, '-', '_') || '_' || to_char(p_day, 'YYYYMMDD');
  if current_setting(v_key, true) = '1' then
    return true;
  end if;
  perform set_config(v_key, '1', true);
  return false;
end;
$function$;

revoke all on function public.dashboard_kpi_day_claimed(uuid, date) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_day_claimed(uuid, date) to service_role;

comment on function public.dashboard_kpi_day_claimed(uuid, date) is
  'P7.10 : vrai si le couple (boutique, jour) a déjà été déclaré dans cette transaction. Remplace des insertions vouées à un conflit unique, sans changer le contenu du journal.';

-- ----------------------------------------------------------------------------
-- 4. Producteur d'insertion ensembliste : déduplication AVANT insertion
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_kpi_invalidate_insert_stmt()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_tx bigint := txid_current();
begin
  if not public.dashboard_kpi_producers_armed() then
    return null;
  end if;

  if tg_table_name = 'orders' then
    -- Un lot de N commandes produit au plus (boutique, jour) distincts, et non
    -- 2N candidats : la déduplication précède l'insertion.
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select c.store_id, c.day, 'orders:INSERT:stmt', v_tx
    from (
      select o.store_id, d.day
      from new_rows o
      left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
      cross join lateral (values
        (public.dashboard_kpi_local_ts(o.order_date, coalesce(st.tz, 'Africa/Casablanca'))::date),
        (public.dashboard_kpi_local_ts(coalesce(o.delivered_at, o.order_date), coalesce(st.tz, 'Africa/Casablanca'))::date)
      ) d(day)
      where o.store_id is not null
        and d.day is not null
      group by o.store_id, d.day
    ) c
    where public.dashboard_kpi_producer_active(c.store_id)
    on conflict do nothing;
  elsif tg_table_name = 'order_items' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select c.store_id, c.day, 'order_items:INSERT:stmt', v_tx
    from (
      select o.store_id, d.day
      from new_rows ni
      join public.orders o on o.id = ni.order_id
      left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
      cross join lateral (values
        (public.dashboard_kpi_local_ts(o.order_date, coalesce(st.tz, 'Africa/Casablanca'))::date),
        (public.dashboard_kpi_local_ts(coalesce(o.delivered_at, o.order_date), coalesce(st.tz, 'Africa/Casablanca'))::date)
      ) d(day)
      where o.store_id is not null
        and d.day is not null
      group by o.store_id, d.day
    ) c
    where public.dashboard_kpi_producer_active(c.store_id)
    on conflict do nothing;
  elsif tg_table_name = 'ad_spend_daily' then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
    select c.store_id, c.day, 'ad_spend_daily:INSERT:stmt', v_tx
    from (
      select a.store_id,
             public.dashboard_kpi_local_ts(a.spend_date, coalesce(st.tz, 'Africa/Casablanca'))::date as day
      from new_rows a
      left join public.dashboard_kpi_store_state st on st.store_id = a.store_id
      where a.store_id is not null
      group by a.store_id, 2
    ) c
    where c.day is not null
      and public.dashboard_kpi_producer_active(c.store_id)
    on conflict do nothing;
  end if;
  return null;
end;
$function$;


-- ----------------------------------------------------------------------------
-- 5. Producteur ligne à ligne : portes, filtres de pertinence, marqueurs
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_kpi_invalidate_trg()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_relevant boolean := false;
  v_ns uuid; v_nd1 date; v_nd2 date; v_os uuid; v_od1 date; v_od2 date;
  v_tz text; v_tx bigint; v_new_ok boolean := false; v_old_ok boolean := false;
  v_s uuid; v_od timestamptz; v_dd timestamptz;
begin
  -- Porte la moins coûteuse : producteurs désarmés => aucun autre travail.
  if not public.dashboard_kpi_producers_armed() then
    return null;
  end if;

  if tg_table_name = 'orders' then
    if tg_op in ('INSERT','DELETE') then
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
      if new.store_id = old.store_id and new.order_date = old.order_date
         and new.delivered_at is not distinct from old.delivered_at
         and current_setting('app.kpi_inv_order_' || replace(new.id::text,'-','_'), true) = '1' then
        return null;
      end if;
    end if;
    -- Éligibilité évaluée AVANT les lectures de fuseau.
    if tg_op <> 'DELETE' and public.dashboard_kpi_producer_active(new.store_id) then
      v_ns := new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1 := public.dashboard_kpi_local_ts(new.order_date, v_tz)::date;
      v_nd2 := public.dashboard_kpi_local_ts(coalesce(new.delivered_at,new.order_date), v_tz)::date;
      v_new_ok := true;
    end if;
    if tg_op <> 'INSERT' then
      if v_new_ok and old.store_id = new.store_id and old.order_date = new.order_date
         and old.delivered_at is not distinct from new.delivered_at then
        v_os := v_ns; v_od1 := v_nd1; v_od2 := v_nd2; v_old_ok := true;
      elsif public.dashboard_kpi_producer_active(old.store_id) then
        v_os := old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1 := public.dashboard_kpi_local_ts(old.order_date, v_tz)::date;
        v_od2 := public.dashboard_kpi_local_ts(coalesce(old.delivered_at,old.order_date), v_tz)::date;
        v_old_ok := true;
      end if;
    end if;

  elsif tg_table_name = 'order_items' then
    -- Filtre : seules les colonnes consommées par les agrégats justifient une invalidation.
    if tg_op = 'UPDATE'
       and new.order_id is not distinct from old.order_id
       and new.quantity is not distinct from old.quantity
       and new.unit_selling_price is not distinct from old.unit_selling_price
       and new.unit_purchase_cost_snapshot is not distinct from old.unit_purchase_cost_snapshot then
      return null;
    end if;
    if tg_op = 'INSERT'
       and current_setting('app.kpi_inv_order_' || replace(new.order_id::text, '-', '_'), true) = '1' then
      return null;
    end if;
    v_relevant := true;
    if tg_op <> 'DELETE' then
      select o.store_id, o.order_date, o.delivered_at into v_s, v_od, v_dd
        from public.orders o where o.id = new.order_id;
      if v_s is not null and public.dashboard_kpi_producer_active(v_s) then
        v_ns := v_s;
        v_tz := public.dashboard_kpi_store_tz_cached(v_s);
        v_nd1 := public.dashboard_kpi_local_ts(v_od, v_tz)::date;
        v_nd2 := public.dashboard_kpi_local_ts(coalesce(v_dd,v_od), v_tz)::date;
        v_new_ok := true;
      end if;
    end if;
    if tg_op <> 'INSERT' then
      if v_new_ok and old.order_id = new.order_id then
        v_os := v_ns; v_od1 := v_nd1; v_od2 := v_nd2; v_old_ok := true;
      else
        select o.store_id, o.order_date, o.delivered_at into v_s, v_od, v_dd
          from public.orders o where o.id = old.order_id;
        if v_s is not null and public.dashboard_kpi_producer_active(v_s) then
          v_os := v_s;
          v_tz := public.dashboard_kpi_store_tz_cached(v_s);
          v_od1 := public.dashboard_kpi_local_ts(v_od, v_tz)::date;
          v_od2 := public.dashboard_kpi_local_ts(coalesce(v_dd,v_od), v_tz)::date;
          v_old_ok := true;
        end if;
      end if;
    end if;
  elsif tg_table_name = 'ad_spend_daily' then
    -- Filtre : colonnes consommées par les agrégats publicitaires.
    if tg_op = 'UPDATE'
       and new.store_id is not distinct from old.store_id
       and new.spend_date is not distinct from old.spend_date
       and new.spend is not distinct from old.spend
       and new.spend_converted is not distinct from old.spend_converted then
      return null;
    end if;
    v_relevant := true;
    if tg_op <> 'DELETE' and public.dashboard_kpi_producer_active(new.store_id) then
      v_ns := new.store_id;
      v_tz := public.dashboard_kpi_store_tz_cached(v_ns);
      v_nd1 := public.dashboard_kpi_local_ts(new.spend_date, v_tz)::date;
      v_new_ok := true;
    end if;
    if tg_op <> 'INSERT' then
      if v_new_ok and old.store_id = new.store_id and old.spend_date = new.spend_date then
        v_os := v_ns; v_od1 := v_nd1; v_old_ok := true;
      elsif public.dashboard_kpi_producer_active(old.store_id) then
        v_os := old.store_id;
        v_tz := public.dashboard_kpi_store_tz_cached(v_os);
        v_od1 := public.dashboard_kpi_local_ts(old.spend_date, v_tz)::date;
        v_old_ok := true;
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
    and not public.dashboard_kpi_day_claimed(v.s, v.d)
  on conflict do nothing;

  if tg_table_name = 'order_items' then
    if v_new_ok then
      perform set_config('app.kpi_inv_order_'||replace(new.order_id::text,'-','_'),'1',true);
    end if;
    if v_old_ok and (tg_op <> 'UPDATE' or old.order_id is distinct from new.order_id) then
      perform set_config('app.kpi_inv_order_'||replace(old.order_id::text,'-','_'),'1',true);
    end if;
  end if;
  return null;
end;
$function$;


-- ----------------------------------------------------------------------------
-- 6. Producteur qualité : porte, marqueur de jour, Casablanca
-- ----------------------------------------------------------------------------
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
  if not public.dashboard_kpi_producers_armed() then
    return null;
  end if;

  -- Aucune invalidation si les valeurs ne changent pas réellement.
  if new.subtotal_amount is not distinct from old.subtotal_amount
     and new.rounding_adjustment is not distinct from old.rounding_adjustment then
    return null;
  end if;

  if new.store_id is null or new.order_date is null then
    return null;
  end if;

  if not public.dashboard_kpi_producer_active(new.store_id) then
    return null;
  end if;

  v_tz := public.dashboard_kpi_store_tz_cached(new.store_id);
  v_tx := txid_current();

  insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)
  select v.s, v.d, v.r, v_tx
  from (values
    (new.store_id,
     public.dashboard_kpi_local_ts(new.order_date, v_tz)::date,
     'orders:UPDATE:quality:order'),
    (new.store_id,
     public.dashboard_kpi_local_ts(coalesce(new.delivered_at, new.order_date), v_tz)::date,
     'orders:UPDATE:quality:delivery')
  ) v(s, d, r)
  where v.s is not null and v.d is not null
    and not public.dashboard_kpi_day_claimed(v.s, v.d)
  on conflict do nothing;

  return null;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 7. Marqueur d'insertion de commande : un appel par INSTRUCTION, plus par ligne
-- ----------------------------------------------------------------------------
-- Sémantique inchangée : marque les commandes créées dans la transaction pour
-- que les articles insérés ensuite n'ajoutent pas une invalidation déjà émise
-- par le producteur d'insertion ensembliste.
create or replace function public.dashboard_kpi_mark_order_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.dashboard_kpi_producers_armed() then
    return null;
  end if;
  perform set_config('app.kpi_inv_order_' || replace(o.id::text, '-', '_'), '1', true)
    from new_rows o
   where o.store_id is not null;
  return null;
end;
$function$;

comment on function public.dashboard_kpi_mark_order_insert() is
  'P7.10 : trigger d''INSTRUCTION (transition table) ; marque les commandes du lot en une seule invocation au lieu d''un set_config par ligne.';

-- ----------------------------------------------------------------------------
-- 8. Pilotage de la capture (service_role uniquement)
-- ----------------------------------------------------------------------------
create or replace function public.dashboard_kpi_producer_arm(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_stores int;
begin
  update public.dashboard_kpi_producer_config
     set enabled = coalesce(p_enabled, false),
         updated_at = clock_timestamp()
   where id = 1;
  select count(*) into v_stores
    from public.dashboard_kpi_producer_stores where enabled;
  return jsonb_build_object(
    'armed', coalesce(p_enabled, false),
    'eligible_stores', v_stores);
end;
$function$;

create or replace function public.dashboard_kpi_producer_disable_store(
  p_store_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_row public.dashboard_kpi_producer_stores;
begin
  if p_store_id is null then raise exception 'KPI_BAD_STORE'; end if;

  insert into public.dashboard_kpi_producer_stores as s (store_id, enabled, disabled_at, note)
  values (p_store_id, false, clock_timestamp(), p_note)
  on conflict (store_id) do update
    set enabled = false,
        disabled_at = coalesce(s.disabled_at, clock_timestamp()),
        note = coalesce(excluded.note, s.note),
        updated_at = clock_timestamp()
  returning * into v_row;

  return jsonb_build_object(
    'store_id', v_row.store_id,
    'enabled', v_row.enabled,
    'disabled_at', v_row.disabled_at,
    'rule', 'aggregates after disabled_at are not trustworthy until resume');
end;
$function$;

create or replace function public.dashboard_kpi_producer_enable_store(
  p_store_id uuid,
  p_resume_from date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.dashboard_kpi_producer_stores;
  v_tz text;
  v_from date;
  v_to date;
  v_n int := 0;
begin
  if p_store_id is null then raise exception 'KPI_BAD_STORE'; end if;

  select * into v_row from public.dashboard_kpi_producer_stores where store_id = p_store_id;
  v_tz := public.dashboard_kpi_store_tz(p_store_id);
  v_to := public.dashboard_kpi_local_ts(clock_timestamp(), v_tz)::date;

  -- Reprise : la journée de l'arrêt est reconstruite, car elle a pu être
  -- partiellement capturée avant la désactivation.
  v_from := coalesce(
    p_resume_from,
    case when v_row.disabled_at is not null
         then public.dashboard_kpi_local_ts(v_row.disabled_at, v_tz)::date
    end
  );

  insert into public.dashboard_kpi_producer_stores as s (store_id, enabled, disabled_at, note)
  values (p_store_id, true, null, p_note)
  on conflict (store_id) do update
    set enabled = true,
        disabled_at = null,
        note = coalesce(excluded.note, s.note),
        updated_at = clock_timestamp()
  returning * into v_row;

  if v_from is not null and v_from <= v_to then
    insert into public.dashboard_kpi_invalidation (store_id, business_date, reason)
    select p_store_id, d::date, 'capture:resume:' || v_from::text || ':' || v_to::text
      from generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') d
     where not exists (
       select 1 from public.dashboard_kpi_invalidation i
        where i.store_id = p_store_id and i.business_date = d::date
          and i.processed_at is null);
    get diagnostics v_n = row_count;

    insert into public.dashboard_kpi_store_state as st (store_id, backfill_state, coverage_from, coverage_to)
    values (p_store_id, 'running', v_from, v_to)
    on conflict (store_id) do update
      set backfill_state = 'running',
          coverage_from = least(coalesce(st.coverage_from, excluded.coverage_from), excluded.coverage_from),
          coverage_to = greatest(coalesce(st.coverage_to, excluded.coverage_to), excluded.coverage_to),
          updated_at = clock_timestamp();
  end if;

  return jsonb_build_object(
    'store_id', p_store_id,
    'enabled', true,
    'gap_from', v_from,
    'gap_to', v_to,
    'enqueued_days', v_n);
end;
$function$;

revoke all on function public.dashboard_kpi_producer_arm(boolean) from public, anon, authenticated;
revoke all on function public.dashboard_kpi_producer_disable_store(uuid, text) from public, anon, authenticated;
revoke all on function public.dashboard_kpi_producer_enable_store(uuid, date, text) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_producer_arm(boolean) to service_role;
grant execute on function public.dashboard_kpi_producer_disable_store(uuid, text) to service_role;
grant execute on function public.dashboard_kpi_producer_enable_store(uuid, date, text) to service_role;

-- ----------------------------------------------------------------------------
-- 9. État de capture par boutique (lecture opérateur)
-- ----------------------------------------------------------------------------
create or replace view public.dashboard_kpi_producer_status as
select
  s.store_id,
  s.enabled as capture_enabled,
  s.disabled_at,
  (select c.enabled from public.dashboard_kpi_producer_config c where c.id = 1) as armed,
  st.backfill_state,
  st.coverage_from,
  st.coverage_to,
  st.pending_partitions,
  st.last_rebuild_at,
  (select count(*) from public.dashboard_kpi_invalidation i
    where i.store_id = s.store_id and i.processed_at is null) as pending_events,
  case
    when not s.enabled and st.last_rebuild_at is not null
         and st.last_rebuild_at < coalesce(s.disabled_at, st.last_rebuild_at)
      then 'STALE_CAPTURE_DISABLED'
    when st.last_rebuild_at is null then 'NEVER_REBUILT'
    else 'OK'
  end as capture_health
from public.dashboard_kpi_producer_stores s
left join public.dashboard_kpi_store_state st on st.store_id = s.store_id;

comment on view public.dashboard_kpi_producer_status is
  'P7.10 : état de capture par boutique. STALE_CAPTURE_DISABLED signale des agrégats postérieurs à un arrêt de collecte : reprise et rattrapage obligatoires.';

revoke all on public.dashboard_kpi_producer_status from public, anon, authenticated;
grant select on public.dashboard_kpi_producer_status to service_role;

-- ----------------------------------------------------------------------------
-- 10. Postconditions d'installation (aucun trigger créé ici)
-- ----------------------------------------------------------------------------
do $post$
declare n int;
begin
  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
     and t.tgname like 'trg_kpi_%';
  if n <> 0 then
    raise exception 'PRODUCERS_OPT_TRIGGERS_MUST_STAY_INACTIVE %', n;
  end if;
  if (select enabled from public.dashboard_kpi_producer_config where id = 1) is not false then
    raise exception 'PRODUCERS_OPT_MUST_INSTALL_DISARMED';
  end if;
  if exists (select 1 from public.dashboard_kpi_producer_stores where enabled) then
    raise exception 'PRODUCERS_OPT_STORES_MUST_START_EMPTY';
  end if;
end
$post$;
