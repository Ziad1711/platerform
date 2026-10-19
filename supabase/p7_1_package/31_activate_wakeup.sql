-- ============================================================================
-- JISRA — P7.1 / 31 — ACTIVATION DU RÉVEIL HTTP (LOT SÉPARÉ, OPTIONNEL)
-- ============================================================================
-- Ne pas appliquer pendant P7.1. Le worker cron suffit à la convergence.
-- Le réveil est le seul chemin compatible avec un p95 < 5 s, mais il ajoute
-- un appel réseau par transaction et dépend de pg_net + Vault.
--
-- Prérequis :
--   * 20_extensions_prerequisites.sql appliqué (pg_net) ;
--   * dashboard_kpi_wakeup_config : enabled = true, url et host renseignés ;
--   * secret Vault nommé par secret_name (aucun secret dans ce fichier).
--
-- Autorisation : SET LOCAL p7.activate_wakeup = 'yes';
-- ============================================================================

do $guard$
declare
  v_enabled boolean;
  v_url text;
  v_host text;
begin
  if current_setting('p7.activate_wakeup', true) is distinct from 'yes' then
    raise exception 'P71_WAKEUP_NOT_AUTHORIZED';
  end if;

  select c.enabled, c.url, c.host
    into v_enabled, v_url, v_host
    from public.dashboard_kpi_wakeup_config c
   where c.id = 1;

  if coalesce(v_enabled, false) is not true
     or v_url is null or v_host is null then
    raise exception 'P71_WAKEUP_CONFIG_INCOMPLETE';
  end if;

  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,int)') is null then
    raise exception 'P71_PG_NET_REQUIRED';
  end if;

  if exists (
    select 1 from pg_trigger
     where not tgisinternal and tgname = 'trg_kpi_wakeup'
  ) then
    raise exception 'P71_WAKEUP_TRIGGER_ALREADY_PRESENT';
  end if;
end
$guard$;

create constraint trigger trg_kpi_wakeup
  after insert on public.dashboard_kpi_invalidation
  deferrable initially deferred
  for each row execute function public.dashboard_kpi_wakeup_trg();

-- Contrôle : select tgname, tgenabled from pg_trigger where tgname = 'trg_kpi_wakeup';
-- Surveillance : select last_wakeup_status, count(*) from public.dashboard_kpi_store_state group by 1;
--                select status_code, timed_out, error_msg from net._http_response order by id desc limit 20;
--
-- ROLLBACK : drop trigger if exists trg_kpi_wakeup on public.dashboard_kpi_invalidation;
--            update public.dashboard_kpi_wakeup_config set enabled = false where id = 1;
