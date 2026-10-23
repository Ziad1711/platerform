-- ============================================================================
-- JISRA — P8.5 : initialisation automatique KPI V5 des nouvelles boutiques
-- ============================================================================
-- Portée :
--   * découverte bornée des boutiques sans cohorte lecteur ;
--   * capture activée puis rattrapage borné, en réutilisant P7.8/P7.9/P7.10 ;
--   * borne historique réelle et monotone décroissante (imports anciens) ;
--   * promotion V5 contrôlée : capture active, couverture complète, aucune
--     invalidation en attente, cohérence agrégat/source vérifiée ;
--   * reprise après erreur, verrou par boutique, rollback ciblé.
--
-- Aucune formule financière, aucune ACL existante, aucune donnée métier.
-- Aucun trigger sur `stores` : l'orchestration est asynchrone et couvre donc
-- aussi les insertions directes, pas seulement `POST /api/stores`.
-- Aucun nouveau cron : le job `dashboard-kpi-worker` existant appelle
-- `dashboard_kpi_worker_tick` à sa fréquence actuelle.
-- ============================================================================

-- Les réglages sont posés sur la session : le runner de migrations encadre
-- déjà le fichier dans une transaction.
set lock_timeout = '5s';
set statement_timeout = '60s';

do $pre$
begin
  if to_regprocedure('public.dashboard_kpi_history_from(uuid)') is null
     or to_regprocedure('public.dashboard_kpi_set_history_from(uuid,date)') is null
     or to_regprocedure('public.dashboard_kpi_backfill_enqueue(uuid,date,date)') is null
     or to_regprocedure('public.dashboard_kpi_finalize_store_state(uuid)') is null
     or to_regprocedure('public.dashboard_kpi_producer_enable_store(uuid,date,text)') is null
     or to_regprocedure('public.dashboard_kpi_producer_disable_store(uuid,text)') is null
     or to_regprocedure('public.dashboard_kpi_worker_run(text,integer,bigint,numeric)') is null
     or to_regprocedure('public.dashboard_kpi_direct_day(uuid,date,text)') is null
     or to_regclass('public.dashboard_kpi_store_state') is null
     or to_regclass('public.dashboard_kpi_producer_stores') is null
     or to_regclass('public.dashboard_kpi_rollout_cohorts') is null
  then
    raise exception 'KPI_ONBOARDING_PREREQ_MISSING';
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Suivi d'initialisation (une ligne par boutique découverte)
-- ---------------------------------------------------------------------------
create table if not exists public.dashboard_kpi_store_onboarding (
  store_id uuid primary key references public.stores(id) on delete cascade,
  state text not null default 'pending'
    check (state in ('pending', 'ready', 'promoted', 'blocked', 'paused')),
  capture_enabled boolean not null default false,
  history_from date,
  enqueued_from date,
  enqueued_to date,
  attempts integer not null default 0,
  promoted_at timestamptz,
  history_checked_at timestamptz,
  last_error text,
  last_gate text,
  next_attempt_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dashboard_kpi_store_onboarding_window_ck
    check (enqueued_from is null or enqueued_to is null or enqueued_from <= enqueued_to)
);

comment on table public.dashboard_kpi_store_onboarding is
  'P8.5 : suivi d''initialisation KPI V5 des nouvelles boutiques. Aucun accès client ; aucun calcul financier.';

create index if not exists dashboard_kpi_store_onboarding_pending_idx
  on public.dashboard_kpi_store_onboarding (state, next_attempt_at, created_at);

-- Pas de RLS ici (consigne de mission) : l'accès est fermé par REVOKE et par
-- l'absence de tout GRANT client. Seul service_role lit ce suivi.
revoke all on table public.dashboard_kpi_store_onboarding from public, anon, authenticated;
grant select on table public.dashboard_kpi_store_onboarding to service_role;

-- ---------------------------------------------------------------------------
-- 2. Une étape idempotente pour une boutique
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_kpi_onboarding_step(
  p_store_id uuid,
  p_window_days integer default 90,
  p_promote boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row public.dashboard_kpi_store_onboarding%rowtype;
  v_tz text;
  v_today date;
  v_hist date;
  v_effective jsonb;
  v_from date;
  v_to date;
  v_enqueued int := 0;
  v_capture boolean := false;
  v_state public.dashboard_kpi_store_state%rowtype;
  v_fin jsonb;
  v_version int;
  v_day date;
  v_sample int := 0;
  v_mismatch int := 0;
  v_consistent boolean := true;
  v_owner boolean := false;
  v_ready boolean := false;
  v_cohort record;
  v_new_state text;
  v_gate text;
begin
  if p_store_id is null then raise exception 'KPI_BAD_STORE'; end if;
  if p_window_days is null or p_window_days < 1 then p_window_days := 1; end if;
  if p_window_days > 400 then p_window_days := 400; end if;

  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    delete from public.dashboard_kpi_store_onboarding o where o.store_id = p_store_id;
    return jsonb_build_object('store_id', p_store_id, 'status', 'store_missing');
  end if;

  -- Sérialise deux passes concurrentes sur la même boutique. Clé distincte de
  -- celles de `dashboard_kpi_claim` et de `dashboard_kpi_finalize_store_state`.
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '|onboard', 0));

  insert into public.dashboard_kpi_store_onboarding (store_id) values (p_store_id)
  on conflict (store_id) do nothing;

  select * into v_row
    from public.dashboard_kpi_store_onboarding o
   where o.store_id = p_store_id
     for update;

  if v_row.state = 'paused' then
    return jsonb_build_object('store_id', p_store_id, 'status', 'paused');
  end if;

  v_tz := public.dashboard_kpi_store_tz(p_store_id);
  v_today := public.dashboard_kpi_local_ts(clock_timestamp(), v_tz)::date;

  -- Borne réelle : minimum des sources consommées par les agrégats. Sans borne
  -- explicite, elle ne peut que reculer : un import ancien élargit la grille.
  v_effective := public.dashboard_kpi_set_history_from(p_store_id, null);
  v_hist := nullif(v_effective->>'history_from', '')::date;

  -- Aucun horodatage exploitable (création hors interface sans `created_at`,
  -- boutique encore vide) : la première journée possible est celle de la
  -- découverte. Sans borne explicite, la grille resterait sans origine et la
  -- boutique ne serait jamais calculable. Un import plus ancien fera ensuite
  -- reculer cette borne (le calcul sans borne prend le minimum).
  if v_hist is null then
    v_effective := public.dashboard_kpi_set_history_from(p_store_id, v_today);
    v_hist := nullif(v_effective->>'history_from', '')::date;
  end if;

  -- 1) Capture AVANT tout calcul : les mutations suivantes sont journalisées.
  --    `p_resume_from = null` : pas de rattrapage implicite massif, la fenêtre
  --    est pilotée juste en dessous (bornée par p_window_days).
  if not exists (
    select 1 from public.dashboard_kpi_producer_stores s
     where s.store_id = p_store_id and s.enabled
  ) then
    perform public.dashboard_kpi_producer_enable_store(p_store_id, null, 'auto-onboard');
  end if;

  v_capture := exists (
    select 1 from public.dashboard_kpi_producer_stores s
     where s.store_id = p_store_id and s.enabled
  ) and exists (
    select 1 from public.dashboard_kpi_producer_config c where c.id = 1 and c.enabled
  );

  -- 2) Fenêtres de rattrapage bornées, du présent vers le passé puis retour.
  if v_hist is not null then
    if v_row.enqueued_from is null or v_row.enqueued_to is null then
      v_from := greatest(v_hist, v_today - (p_window_days - 1));
      v_to := v_today;
      if v_from <= v_to then
        v_enqueued := v_enqueued + public.dashboard_kpi_backfill_enqueue(p_store_id, v_from, v_to);
        v_row.enqueued_from := v_from;
        v_row.enqueued_to := v_to;
      end if;
    else
      -- Import plus ancien que la fenêtre déjà demandée : on recule par paliers.
      if v_hist < v_row.enqueued_from then
        v_from := greatest(v_hist, v_row.enqueued_from - p_window_days);
        v_to := v_row.enqueued_from - 1;
        if v_from <= v_to then
          v_enqueued := v_enqueued + public.dashboard_kpi_backfill_enqueue(p_store_id, v_from, v_to);
          v_row.enqueued_from := v_from;
        end if;
      end if;
      -- Le présent avance : la fenêtre déjà couverte ne doit pas devenir un trou.
      if v_row.enqueued_to < v_today then
        v_from := v_row.enqueued_to + 1;
        v_to := least(v_today, v_row.enqueued_to + p_window_days);
        v_enqueued := v_enqueued + public.dashboard_kpi_backfill_enqueue(p_store_id, v_from, v_to);
        v_row.enqueued_to := v_to;
      end if;
    end if;
  end if;

  -- 3) Une boutique déjà promue reste promue tant que la borne n'a pas reculé.
  if v_row.state = 'promoted' and v_hist is not null
     and v_row.history_from is not null and v_hist >= v_row.history_from then
    update public.dashboard_kpi_store_onboarding o
       set history_checked_at = clock_timestamp(),
           capture_enabled = v_capture,
           enqueued_from = v_row.enqueued_from,
           enqueued_to = v_row.enqueued_to,
           last_error = null,
           updated_at = clock_timestamp()
     where o.store_id = p_store_id;
    return jsonb_build_object(
      'store_id', p_store_id,
      'status', 'promoted',
      'history_from', v_hist,
      'enqueued_days', v_enqueued);
  end if;

  -- 4) Import ayant reculé la borne : la cohorte automatique repasse legacy
  --    avant toute lecture partielle, puis la couverture est reconstruite.
  if v_row.state = 'promoted' then
    update public.dashboard_kpi_rollout_cohorts c
       set enabled = false, updated_at = clock_timestamp()
     where c.store_id = p_store_id and c.cohort = 'auto' and c.enabled;
    v_gate := 'history_regression';
  end if;

  -- 5) Phase de préparation (avant le worker) : aucun contrôle coûteux.
  if not p_promote then
    v_gate := coalesce(v_gate, case when v_capture then 'awaiting_worker' else 'capture_inactive' end);
    update public.dashboard_kpi_store_onboarding o
       set state = 'pending',
           capture_enabled = v_capture,
           history_from = v_hist,
           enqueued_from = v_row.enqueued_from,
           enqueued_to = v_row.enqueued_to,
           last_gate = v_gate,
           next_attempt_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where o.store_id = p_store_id;
    return jsonb_build_object(
      'store_id', p_store_id,
      'status', 'prepared',
      'gate', v_gate,
      'history_from', v_hist,
      'enqueued_days', v_enqueued);
  end if;

  -- 6) Contrôles de promotion, au-delà de `finalize_store_state.complete`.
  v_fin := public.dashboard_kpi_finalize_store_state(p_store_id);

  select * into v_state
    from public.dashboard_kpi_store_state st
   where st.store_id = p_store_id;
  v_version := coalesce(v_state.active_definition_version, 1);

  v_ready := coalesce((
    select rc.readiness_rbl4 and rc.readiness_tzdata and rc.readiness_backend and not rc.kill_switch
      from public.dashboard_kpi_rollout_config rc
     where rc.id = 1), false);

  v_owner := exists (
    select 1 from public.stores s where s.id = p_store_id and s.owner_user_id is not null
  ) or exists (
    select 1 from public.store_members sm
     where sm.store_id = p_store_id and sm.status = 'active' and sm.role = 'owner'
  );

  -- Échantillon borné de journées CLOSES : une journée en cours peut bouger
  -- entre le rebuild et la lecture directe, elle n'est donc jamais jugée ici.
  if v_hist is not null then
    for v_day in
      select d
        from (values (v_hist), (v_hist + 1), (v_today - 1)) t(d)
       where d >= v_hist and d < v_today
       group by d
       order by d
       limit 3
    loop
      v_sample := v_sample + 1;
      select count(*) into v_mismatch
        from public.dashboard_daily_metrics m
        cross join lateral public.dashboard_kpi_direct_day(p_store_id, v_day, v_tz) d
       where m.store_id = p_store_id
         and m.business_date = v_day
         and m.axis = 'order'
         and m.definition_version = v_version
         and (m.orders_count is distinct from d.orders_count
              or m.delivered_count is distinct from d.delivered_count
              or m.revenue_items_gross is distinct from d.revenue_items_gross
              or m.purchase_cost is distinct from d.purchase_cost);
      if v_mismatch > 0 then
        v_consistent := false;
      end if;
    end loop;
  end if;

  v_gate := coalesce(v_gate, case
    when v_hist is null then 'history_unknown'
    when not v_capture then 'capture_inactive'
    when v_row.enqueued_from is null or v_row.enqueued_to is null then 'backfill_not_enqueued'
    when v_row.enqueued_from > v_hist then 'history_window_incomplete'
    when v_row.enqueued_to < v_today then 'current_window_incomplete'
    when coalesce(v_state.coverage_from, 'infinity'::date) > v_hist then 'coverage_from_incomplete'
    when coalesce(v_state.coverage_to, '-infinity'::date) < v_today then 'coverage_to_incomplete'
    when coalesce((v_fin->>'complete')::boolean, false) is not true
      then coalesce(v_fin->>'reason', 'not_complete')
    when coalesce((v_fin->>'dirty_days')::int, 0) <> 0 then 'dirty_days'
    when coalesce((v_fin->>'pending_partitions')::int, 0) <> 0 then 'pending_partitions'
    when not v_consistent then 'aggregate_mismatch'
    when not v_owner then 'owner_missing'
    when not v_ready then 'rollout_not_ready'
    else null
  end);

  -- 7) Promotion : cohorte de CETTE boutique uniquement, jamais la config globale.
  if v_gate is null then
    select * into v_cohort
      from public.dashboard_kpi_rollout_cohorts c
     where c.store_id = p_store_id;

    if v_cohort.store_id is null then
      insert into public.dashboard_kpi_rollout_cohorts (store_id, mode, cohort, enabled)
      values (p_store_id, 'v5', 'auto', true)
      on conflict (store_id) do nothing;
    elsif v_cohort.cohort = 'auto' then
      if v_cohort.mode is distinct from 'v5' or v_cohort.enabled is not true then
        update public.dashboard_kpi_rollout_cohorts c
           set mode = 'v5', enabled = true, updated_at = clock_timestamp()
         where c.store_id = p_store_id;
      end if;
    else
      -- Cohorte opérateur : elle n'est jamais modifiée par l'automatisation.
      v_gate := 'manual_cohort_present';
    end if;
  end if;

  v_new_state := case
    when v_gate is null then 'promoted'
    when v_gate in ('manual_cohort_present', 'rollout_not_ready', 'owner_missing') then 'ready'
    else 'pending'
  end;

  update public.dashboard_kpi_store_onboarding o
     set state = v_new_state,
         capture_enabled = v_capture,
         history_from = v_hist,
         enqueued_from = v_row.enqueued_from,
         enqueued_to = v_row.enqueued_to,
         attempts = case when v_new_state = 'promoted' then 0 else o.attempts end,
         promoted_at = case when v_new_state = 'promoted'
                            then coalesce(o.promoted_at, clock_timestamp()) else o.promoted_at end,
         history_checked_at = clock_timestamp(),
         last_gate = v_gate,
         last_error = null,
         next_attempt_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where o.store_id = p_store_id;

  return jsonb_build_object(
    'store_id', p_store_id,
    'status', v_new_state,
    'gate', v_gate,
    'history_from', v_hist,
    'enqueued_from', v_row.enqueued_from,
    'enqueued_to', v_row.enqueued_to,
    'enqueued_days', v_enqueued,
    'coverage_from', v_state.coverage_from,
    'coverage_to', v_state.coverage_to,
    'sample_days', v_sample,
    'finalize_reason', v_fin->>'reason');
end;
$fn$;

revoke all on function public.dashboard_kpi_onboarding_step(uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_onboarding_step(uuid, integer, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Passe globale bornée : découverte + étapes, erreurs isolées par boutique
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_kpi_onboarding_run(
  p_max_stores integer default 5,
  p_window_days integer default 90,
  p_promote boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_max int;
  v_discovered int := 0;
  v_cleaned int := 0;
  v_id uuid;
  v_step jsonb;
  v_items jsonb := '[]'::jsonb;
  v_errors int := 0;
  v_promoted int := 0;
  v_ready int := 0;
begin
  v_max := greatest(1, least(coalesce(p_max_stores, 5), 50));

  -- Découverte : aucune cohorte activée n'entre dans le périmètre, ce qui
  -- préserve les boutiques déjà servies en V5 (cohortes `pilot` existantes).
  insert into public.dashboard_kpi_store_onboarding (store_id)
  select s.id
    from public.stores s
   where not exists (
           select 1 from public.dashboard_kpi_store_onboarding o where o.store_id = s.id)
     and not exists (
           select 1 from public.dashboard_kpi_rollout_cohorts c
            where c.store_id = s.id and c.enabled)
   order by s.created_at, s.id
   limit v_max
  on conflict (store_id) do nothing;
  get diagnostics v_discovered = row_count;

  -- Hygiène : `dashboard_kpi_producer_stores` ne porte pas de clé étrangère.
  -- Une boutique supprimée y laisserait une ligne de capture orpheline ; le
  -- nettoyage est borné et ne concerne jamais une boutique existante.
  delete from public.dashboard_kpi_producer_stores ps
   where ps.ctid in (
     select ps2.ctid
       from public.dashboard_kpi_producer_stores ps2
      where not exists (select 1 from public.stores s where s.id = ps2.store_id)
      limit 20);
  get diagnostics v_cleaned = row_count;

  for v_id in
    select o.store_id
      from public.dashboard_kpi_store_onboarding o
     where o.state <> 'paused'
       and o.next_attempt_at <= clock_timestamp()
       and (o.state <> 'promoted'
            or o.history_checked_at is null
            or o.history_checked_at < clock_timestamp() - interval '2 minutes')
     order by case o.state
                when 'pending' then 0
                when 'blocked' then 1
                when 'ready' then 2
                else 3
              end,
              -- Rotation équitable : une boutique déjà promue n'est revérifiée
              -- qu'après celles qui attendent, et la plus ancienne vérification
              -- passe d'abord (aucune boutique n'est laissée de côté).
              case when o.state = 'promoted'
                   then coalesce(o.history_checked_at, o.created_at)
                   else coalesce(o.next_attempt_at, o.created_at)
              end,
              o.created_at
     limit v_max
  loop
    begin
      v_step := public.dashboard_kpi_onboarding_step(v_id, p_window_days, p_promote);
      if v_step->>'status' = 'promoted' then v_promoted := v_promoted + 1; end if;
      if v_step->>'status' = 'ready' then v_ready := v_ready + 1; end if;
      v_items := v_items || jsonb_build_array(v_step);
    exception when others then
      v_errors := v_errors + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'store_id', v_id, 'status', 'error', 'error', left(sqlerrm, 200)));
      update public.dashboard_kpi_store_onboarding o
         set state = case when o.state = 'promoted' then o.state else 'blocked' end,
             attempts = o.attempts + 1,
             last_error = left(sqlerrm, 300),
             next_attempt_at = clock_timestamp()
               + make_interval(secs => least(3600, 120 * (2 ^ least(o.attempts, 4)))::int),
             updated_at = clock_timestamp()
       where o.store_id = v_id;
    end;
  end loop;

  return jsonb_build_object(
    'discovered', v_discovered,
    'cleaned_capture', v_cleaned,
    'processed', jsonb_array_length(v_items),
    'promoted', v_promoted,
    'ready', v_ready,
    'errors', v_errors,
    'window_days', greatest(1, least(coalesce(p_window_days, 90), 400)),
    'promote', coalesce(p_promote, true),
    'stores', v_items);
end;
$fn$;

revoke all on function public.dashboard_kpi_onboarding_run(integer, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_onboarding_run(integer, integer, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Point d'entrée du cron existant : préparation, worker, promotion
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_kpi_worker_tick(
  p_worker text default 'cron',
  p_max_partitions integer default 10,
  p_max_events bigint default 5000,
  p_max_seconds numeric default 4.0,
  p_max_stores integer default 10,
  p_window_days integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_pre jsonb;
  v_post jsonb;
  v_worker record;
  v_worker_error text;
begin
  -- 1) Découverte + capture + enfilage borné (aucune promotion ici : le
  --    worker n'a pas encore reconstruit les journées demandées).
  v_pre := public.dashboard_kpi_onboarding_run(p_max_stores, p_window_days, false);

  -- 2) Calcul délégué au worker existant, à budgets inchangés. Un échec dur du
  --    worker ne doit jamais annuler la capture ni l'enfilage déjà réalisés :
  --    il est isolé, exposé dans le résultat, et repris au tick suivant.
  begin
    select * into v_worker
      from public.dashboard_kpi_worker_run(p_worker, p_max_partitions, p_max_events, p_max_seconds);
  exception when others then
    v_worker := null;
    v_worker_error := left(sqlerrm, 300);
  end;

  -- Le worker borne `statement_timeout`/`lock_timeout` localement : on rétablit
  -- un budget sain pour la phase de promotion (chaque requête y est courte).
  perform set_config('statement_timeout', '30000ms', true);
  perform set_config('lock_timeout', '5000ms', true);

  -- 3) Promotion contrôlée des boutiques devenues complètes.
  v_post := public.dashboard_kpi_onboarding_run(p_max_stores, p_window_days, true);

  return jsonb_build_object(
    'onboarding_prepare', v_pre,
    'worker', to_jsonb(v_worker),
    'worker_error', v_worker_error,
    'onboarding_promote', v_post);
end;
$fn$;

revoke all on function public.dashboard_kpi_worker_tick(text, integer, bigint, numeric, integer, integer)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_worker_tick(text, integer, bigint, numeric, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Surveillance et rollback ciblé
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_kpi_onboarding_status()
returns table (
  store_id uuid,
  store_name text,
  state text,
  capture_enabled boolean,
  history_from date,
  enqueued_from date,
  enqueued_to date,
  coverage_from date,
  coverage_to date,
  pending_partitions integer,
  cohort_mode text,
  cohort_enabled boolean,
  attempts integer,
  last_gate text,
  last_error text,
  promoted_at timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select o.store_id,
         s.name,
         o.state,
         o.capture_enabled,
         o.history_from,
         o.enqueued_from,
         o.enqueued_to,
         st.coverage_from,
         st.coverage_to,
         st.pending_partitions,
         c.mode,
         c.enabled,
         o.attempts,
         o.last_gate,
         o.last_error,
         o.promoted_at
    from public.dashboard_kpi_store_onboarding o
    left join public.stores s on s.id = o.store_id
    left join public.dashboard_kpi_store_state st on st.store_id = o.store_id
    left join public.dashboard_kpi_rollout_cohorts c on c.store_id = o.store_id
   order by o.created_at, o.store_id;
$fn$;

revoke all on function public.dashboard_kpi_onboarding_status() from public, anon, authenticated;
grant execute on function public.dashboard_kpi_onboarding_status() to service_role;

create or replace function public.dashboard_kpi_onboarding_rollback(
  p_store_id uuid,
  p_disable_capture boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_cohort record;
  v_removed boolean := false;
begin
  if p_store_id is null then raise exception 'KPI_BAD_STORE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '|onboard', 0));

  -- Seule la cohorte automatique est retirée : une cohorte opérateur est
  -- laissée intacte, et les agrégats/journal ne sont jamais supprimés.
  select * into v_cohort
    from public.dashboard_kpi_rollout_cohorts c
   where c.store_id = p_store_id;

  if v_cohort.store_id is not null and v_cohort.cohort = 'auto' then
    delete from public.dashboard_kpi_rollout_cohorts c where c.store_id = p_store_id;
    v_removed := true;
  end if;

  if p_disable_capture then
    perform public.dashboard_kpi_producer_disable_store(p_store_id, 'auto-onboard:rollback');
  end if;

  update public.dashboard_kpi_store_onboarding o
     set state = 'paused',
         capture_enabled = case when p_disable_capture then false else o.capture_enabled end,
         last_gate = 'rolled_back',
         last_error = null,
         next_attempt_at = clock_timestamp() + interval '24 hours',
         updated_at = clock_timestamp()
   where o.store_id = p_store_id;

  return jsonb_build_object(
    'store_id', p_store_id,
    'cohort_removed', v_removed,
    'capture_disabled', coalesce(p_disable_capture, false),
    'state', 'paused');
end;
$fn$;

revoke all on function public.dashboard_kpi_onboarding_rollback(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_onboarding_rollback(uuid, boolean)
  to service_role;

create or replace function public.dashboard_kpi_onboarding_resume(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_cohort record;
  v_state text;
begin
  if p_store_id is null then raise exception 'KPI_BAD_STORE'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '|onboard', 0));

  select * into v_cohort
    from public.dashboard_kpi_rollout_cohorts c
   where c.store_id = p_store_id;

  v_state := case
    when v_cohort.store_id is not null and v_cohort.enabled and v_cohort.mode = 'v5' then 'promoted'
    else 'pending'
  end;

  update public.dashboard_kpi_store_onboarding o
     set state = v_state,
         last_gate = 'resumed',
         last_error = null,
         next_attempt_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where o.store_id = p_store_id;

  return jsonb_build_object('store_id', p_store_id, 'state', v_state);
end;
$fn$;

revoke all on function public.dashboard_kpi_onboarding_resume(uuid) from public, anon, authenticated;
grant execute on function public.dashboard_kpi_onboarding_resume(uuid) to service_role;

comment on function public.dashboard_kpi_worker_tick(text, integer, bigint, numeric, integer, integer) is
  'P8.5 : point d''entrée du cron existant — préparation bornée, worker inchangé, promotion contrôlée.';
comment on function public.dashboard_kpi_onboarding_step(uuid, integer, boolean) is
  'P8.5 : une étape idempotente par boutique (capture, fenêtres, contrôles, promotion).';
comment on function public.dashboard_kpi_onboarding_rollback(uuid, boolean) is
  'P8.5 : retour legacy ciblé d''une nouvelle boutique, sans toucher aux agrégats ni au journal.';
