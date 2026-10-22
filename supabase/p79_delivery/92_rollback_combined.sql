-- ============================================================================
-- JISRA — KPI V5 Phase 2 / 92 — ROLLBACK COMBINÉ (P7.1 + P7.9 + lecteur)
-- ============================================================================
-- Ordre imposé par le plan directeur (F.5) :
--   1. retour du lecteur en legacy (configuration opérationnelle) ;
--   2. confirmation du mode effectif ;
--   3. arrêt du worker (jobs cron + interrupteur) ;
--   4. arrêt du réveil et retrait de son trigger ;
--   5. retrait des cinq producteurs P7.1 ;
--   6. retrait du producteur qualité P7.9 (trigger puis fonction) ;
--   7. conservation intégrale des tables, du journal, des agrégats et des runs.
--
-- Ce que ce script NE FAIT PAS, volontairement :
--   * aucun rollback P8 (P8.1 → P8.4) : les corrections de sécurité restent
--     en place. Le script PROUVE leur invariance par empreinte (digests) ;
--   * aucune réintroduction d'une permission retirée
--     (`rpc_dashboard_kpi_quality_status` sans contrôle, surcharge
--     `rpc_dashboard_revenue_chart(uuid[])` ouverte aux clients) ;
--   * aucune suppression de ligne métier, d'événement, d'agrégat ou de run ;
--   * aucun retour à une version antérieure de `dashboard_kpi_finalize_store_state`.
--
-- Usage (une seule transaction) :
--   psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -c "set p79.combined_rollback_authorized='yes'" \
--     -f 92_rollback_combined.sql
-- Attendu : toutes les lignes de contrôle en PASS, aucune ligne FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

do $guard$
begin
  if current_setting('p79.combined_rollback_authorized', true) is distinct from 'yes' then
    raise exception 'P79_COMBINED_ROLLBACK_NOT_AUTHORIZED';
  end if;
end
$guard$;

create temp table if not exists _p79_snap(
  phase text not null,
  k text not null,
  v text not null,
  primary key (phase, k)
) on commit drop;

-- Snapshot générique : compteurs, interrupteurs et empreintes de définitions.
-- Utilisé avant et après les actions ; la comparaison est la preuve.
create or replace function pg_temp.p79_snapshot(p_phase text)
returns void
language plpgsql
as $snap$
declare
  r record;
  v text;
begin
  for r in
    select * from (values
      ('stores_rows',        'public.stores'),
      ('orders_rows',        'public.orders'),
      ('order_items_rows',   'public.order_items'),
      ('ad_spend_rows',      'public.ad_spend_daily'),
      ('invalidation_rows',  'public.dashboard_kpi_invalidation'),
      ('metrics_rows',       'public.dashboard_daily_metrics'),
      ('runs_rows',          'public.dashboard_kpi_worker_run')
    ) t(k, rel)
  loop
    if to_regclass(r.rel) is null then
      insert into _p79_snap values (p_phase, r.k, 'absent');
    else
      execute format('select count(*)::text from %s', r.rel) into v;
      insert into _p79_snap values (p_phase, r.k, v);
    end if;
  end loop;

  insert into _p79_snap
  select p_phase, 'kpi_triggers', count(*)::text
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname = 'public' and t.tgname like 'trg\_kpi\_%';

  if to_regclass('cron.job') is null then
    insert into _p79_snap values (p_phase, 'cron_jobs', 'absent');
  else
    execute 'select count(*)::text from cron.job where jobname like ''jisra\_kpi%''' into v;
    insert into _p79_snap values (p_phase, 'cron_jobs', v);
  end if;

  if to_regclass('public.dashboard_kpi_worker_config') is null then
    insert into _p79_snap values (p_phase, 'worker_enabled', 'absent');
  else
    execute 'select enabled::text from public.dashboard_kpi_worker_config where id = 1' into v;
    insert into _p79_snap values (p_phase, 'worker_enabled', coalesce(v, 'missing'));
  end if;

  if to_regclass('public.dashboard_kpi_wakeup_config') is null then
    insert into _p79_snap values (p_phase, 'wakeup_enabled', 'absent');
  else
    execute 'select enabled::text from public.dashboard_kpi_wakeup_config where id = 1' into v;
    insert into _p79_snap values (p_phase, 'wakeup_enabled', coalesce(v, 'missing'));
  end if;

  if to_regclass('public.dashboard_kpi_rollout_config') is null then
    insert into _p79_snap values (p_phase, 'reader_kill_switch', 'absent');
    insert into _p79_snap values (p_phase, 'reader_requested_mode', 'absent');
  else
    execute 'select kill_switch::text from public.dashboard_kpi_rollout_config where id = 1' into v;
    insert into _p79_snap values (p_phase, 'reader_kill_switch', coalesce(v, 'missing'));
    execute 'select requested_mode from public.dashboard_kpi_rollout_config where id = 1' into v;
    insert into _p79_snap values (p_phase, 'reader_requested_mode', coalesce(v, 'missing'));
  end if;

  -- Empreinte des corrections P8 (fonctions et politiques) : identique avant
  -- et après le rollback = P8 n'a pas été annulé.
  execute $d$
    select md5(coalesce(string_agg(
             p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
             md5(pg_get_functiondef(p.oid)),
             E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)), ''))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and (p.proname like 'can\_%' or p.proname like 'p84\_%'
            or p.proname in ('accept_team_invitation', 'rpc_order_confirmation_action',
                             'rpc_update_confirmation_order_details'))
  $d$ into v;
  insert into _p79_snap values (p_phase, 'p8_function_digest', v);

  execute $d$
    select md5(coalesce(string_agg(
             c.relname || '|' || pol.polname || '|' || pol.polcmd::text || '|' ||
             coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' ||
             coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
             E'\n' order by c.relname, pol.polname), ''))
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
  $d$ into v;
  insert into _p79_snap values (p_phase, 'policy_digest', v);

  -- Protections P7.9 (RPC durci, surcharge fermée, finalisation sûre) : elles
  -- ne doivent pas bouger, le rollback ne les réintroduit jamais.
  execute $d$
    select md5(coalesce(string_agg(
             p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
             md5(pg_get_functiondef(p.oid)),
             E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)), ''))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('rpc_dashboard_kpi_quality_status',
                         'dashboard_kpi_finalize_store_state',
                         'rpc_dashboard_revenue_chart')
  $d$ into v;
  insert into _p79_snap values (p_phase, 'p79_hardening_digest', v);

  -- Trigger P8.4 D4 : présent ou absent, mais jamais modifié par ce rollback.
  insert into _p79_snap
  select p_phase, 'p8_delivery_trigger',
         (select count(*)::text from pg_trigger
           where tgname = 'a_p84_delivery_order_columns');
end
$snap$;

select pg_temp.p79_snapshot('pre');

-- ============================================================================
-- 1. Lecteur : retour en legacy (le mode effectif est relu à chaque appel).
--    updated_at et config_version sont avancés par trg_rollout_config_touch.
-- ============================================================================
do $reader$
begin
  if to_regclass('public.dashboard_kpi_rollout_config') is not null then
    update public.dashboard_kpi_rollout_config
       set kill_switch = true,
           requested_mode = 'legacy'
     where id = 1;
  end if;
end
$reader$;

-- ============================================================================
-- 2. Worker : arrêt des jobs puis interrupteur. Aucun événement non acquitté
--    n'est supprimé ; la plage à reconstruire reste dans le journal.
-- ============================================================================
do $worker$
declare
  v_state text;
  v_msg   text;
begin
  if to_regclass('cron.job') is not null then
    begin
      perform cron.unschedule('jisra_kpi_worker');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_state not in ('42704', '42883', 'P0002')
         and v_msg not ilike '%not found%'
         and v_msg not ilike '%could not find valid entry for job%' then
        raise;
      end if;
    end;

    begin
      perform cron.unschedule('jisra_kpi_purge');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      if v_state not in ('42704', '42883', 'P0002')
         and v_msg not ilike '%not found%'
         and v_msg not ilike '%could not find valid entry for job%' then
        raise;
      end if;
    end;
  end if;

  if to_regclass('public.dashboard_kpi_worker_config') is not null then
    update public.dashboard_kpi_worker_config
       set enabled = false, updated_at = clock_timestamp()
     where id = 1;
  end if;
end
$worker$;

-- ============================================================================
-- 3. Réveil : interrupteur puis trigger (plus aucun appel HTTP sortant).
-- ============================================================================
do $wakeup$
begin
  if to_regclass('public.dashboard_kpi_wakeup_config') is not null then
    update public.dashboard_kpi_wakeup_config
       set enabled = false, updated_at = clock_timestamp()
     where id = 1;
  end if;

  if to_regclass('public.dashboard_kpi_invalidation') is not null then
    execute 'drop trigger if exists trg_kpi_wakeup on public.dashboard_kpi_invalidation';
  end if;
end
$wakeup$;

-- ============================================================================
-- 4. Producteurs P7.1 : cinq triggers, aucun objet métier touché.
-- ============================================================================
drop trigger if exists trg_kpi_invalidate_ad_spend on public.ad_spend_daily;
drop trigger if exists trg_kpi_invalidate_order_items on public.order_items;
drop trigger if exists trg_kpi_invalidate_orders_insert on public.orders;
drop trigger if exists trg_kpi_invalidate_orders on public.orders;
drop trigger if exists trg_kpi_mark_order_insert on public.orders;

-- ============================================================================
-- 5. Producteur P7.9 : trigger puis fonction. Les quatre migrations P7.9 et
--    leurs protections (RPC durci, surcharge fermée, finalisation sûre)
--    restent installées : elles ne sont PAS annulées.
-- ============================================================================
drop trigger if exists trg_kpi_invalidate_orders_quality on public.orders;
drop function if exists public.dashboard_kpi_invalidate_orders_quality_trg();

-- ============================================================================
-- 6. Contrôles : état final, non-perte, sécurité P8 inchangée.
-- ============================================================================
select pg_temp.p79_snapshot('post');

-- Résultat des contrôles matérialisé : le verdict ci-dessous ne dépend jamais de
-- l'affichage console.
create temp table _p79_checks on commit drop as
with pre as (select k, v from _p79_snap where phase = 'pre'),
     post as (select k, v from _p79_snap where phase = 'post'),
     checks(check_id, expected, observed) as (
       select 'kpi_triggers_remaining', '0',
              (select v from post where k = 'kpi_triggers')
       union all
       select 'cron_jobs_remaining',
              case when to_regclass('cron.job') is null then 'absent' else '0' end,
              (select v from post where k = 'cron_jobs')
       union all
       select 'worker_disabled', 'false',
              (select v from post where k = 'worker_enabled')
       union all
       select 'wakeup_disabled', 'false',
              (select v from post where k = 'wakeup_enabled')
       union all
       select 'reader_kill_switch', 'true',
              (select v from post where k = 'reader_kill_switch')
       union all
       select 'reader_requested_mode', 'legacy',
              (select v from post where k = 'reader_requested_mode')
       union all
       select 'business_rows_unchanged',
              (select string_agg(k || '=' || v, ',' order by k) from pre
                where k in ('stores_rows', 'orders_rows', 'order_items_rows', 'ad_spend_rows')),
              (select string_agg(k || '=' || v, ',' order by k) from post
                where k in ('stores_rows', 'orders_rows', 'order_items_rows', 'ad_spend_rows'))
       union all
       select 'journal_and_aggregates_unchanged',
              (select string_agg(k || '=' || v, ',' order by k) from pre
                where k in ('invalidation_rows', 'metrics_rows', 'runs_rows')),
              (select string_agg(k || '=' || v, ',' order by k) from post
                where k in ('invalidation_rows', 'metrics_rows', 'runs_rows'))
       union all
       select 'p8_function_digest_unchanged',
              (select v from pre where k = 'p8_function_digest'),
              (select v from post where k = 'p8_function_digest')
       union all
       select 'p8_policy_digest_unchanged',
              (select v from pre where k = 'policy_digest'),
              (select v from post where k = 'policy_digest')
       union all
       select 'p8_delivery_trigger_unchanged',
              (select v from pre where k = 'p8_delivery_trigger'),
              (select v from post where k = 'p8_delivery_trigger')
       union all
       select 'p79_hardening_unchanged',
              (select v from pre where k = 'p79_hardening_digest'),
              (select v from post where k = 'p79_hardening_digest')
     )
select check_id, expected, observed,
       case when expected is not distinct from observed then 'PASS' else 'FAIL' end as status
from checks;

select check_id, expected, observed, status
from _p79_checks
order by check_id;

-- Verdict bloquant : un seul FAIL annule tout le rollback (exécution en
-- --single-transaction), donc aucune suppression ni coupure partielle.
do $verdict$
declare
  v_failed text;
begin
  select string_agg(check_id || ' (attendu ' || coalesce(expected, '<null>') ||
                    ', observé ' || coalesce(observed, '<null>') || ')',
                    '; ' order by check_id)
    into v_failed
    from _p79_checks
   where status = 'FAIL';

  if v_failed is not null then
    raise exception 'P79_COMBINED_ROLLBACK_FAILED: %', v_failed;
  end if;

  raise notice 'P79_COMBINED_ROLLBACK_PASS % contrôles', (select count(*) from _p79_checks);
end
$verdict$;
