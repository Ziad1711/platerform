-- ============================================================================
-- JISRA — P7.1 / 41 — BACKFILL PROGRESSIF (LOT SÉPARÉ, JAMAIS AUTOMATIQUE)
-- ============================================================================
-- ATTENTION : dashboard_kpi_backfill_enqueue(p_from, p_to) inclut p_to.
-- Ce fichier est un gabarit : il ne fait rien sans les trois paramètres
-- ci-dessous. Ne pas boucler sur un historique complet en une fois.
--
-- Exemple :
--   psql "$URL" --single-transaction -v ON_ERROR_STOP=1 \
--     -v store_id='<UUID>' -v from='2026-09-01' -v to='2026-09-07' \
--     -f 41_backfill.sql
-- avec p7.backfill = 'yes' et p7.backfill_authorized = 'yes' positionnés
-- par l'opérateur (ALTER ROLE ... SET ou script wrapper).
-- ============================================================================

do $guard$
declare
  v_store uuid;
  v_from date;
  v_to date;
  v_pending bigint;
  v_enabled boolean;
  v_n integer;
begin
  if current_setting('p7.backfill', true) is distinct from 'yes' then
    raise exception 'P71_BACKFILL_NOT_AUTHORIZED';
  end if;

  v_store := nullif(current_setting('p7.backfill_store_id', true), '')::uuid;
  v_from  := nullif(current_setting('p7.backfill_from', true), '')::date;
  v_to    := nullif(current_setting('p7.backfill_to', true), '')::date;

  if v_store is null or v_from is null or v_to is null then
    raise exception 'P71_BACKFILL_PARAMETERS_MISSING';
  end if;
  if v_from > v_to then
    raise exception 'P71_BACKFILL_BAD_RANGE';
  end if;
  if v_to - v_from > 31 then
    raise exception 'P71_BACKFILL_WINDOW_TOO_LARGE (max 31 days per run)';
  end if;
  if not exists (select 1 from public.stores s where s.id = v_store) then
    raise exception 'P71_BACKFILL_UNKNOWN_STORE';
  end if;

  select c.enabled into v_enabled
    from public.dashboard_kpi_worker_config c where c.id = 1;
  if coalesce(v_enabled, false) is not true then
    raise exception 'P71_BACKFILL_REQUIRES_WORKER';
  end if;

  select count(*) into v_pending
    from public.dashboard_kpi_invalidation i
   where i.processed_at is null;
  if v_pending > 5000 then
    raise exception 'P71_BACKFILL_BACKLOG_TOO_HIGH (% pending)', v_pending;
  end if;

  v_n := public.dashboard_kpi_backfill_enqueue(v_store, v_from, v_to);

  raise notice 'P71_BACKFILL_ENQUEUED store=% from=% to=% partitions=%',
    v_store, v_from, v_to, v_n;
end
$guard$;

-- Contrôle après exécution :
--   select * from public.dashboard_kpi_health;
--   select * from public.dashboard_kpi_coverage('<UUID>', '<FROM>', '<TO>');
--
-- Arrêt : update public.dashboard_kpi_store_state set backfill_state='paused'
--         where store_id = '<UUID>';
-- Reprise : update ... set backfill_state='running' where store_id = '<UUID>';
-- Ne jamais purger le journal avant rapprochement.
