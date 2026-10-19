-- ============================================================================
-- JISRA — P7.1 / 20 — PRÉREQUIS EXTENSIONS (LOT SÉPARÉ, NON APPLIQUÉ PAR 10)
-- ============================================================================
-- pg_cron démarre son ordonnanceur dès l'installation de l'extension, même
-- sans job. Cette étape n'appartient donc PAS à l'installation inerte.
-- Aucun job n'est créé ici.
--
-- Exécution : psql --single-transaction -v ON_ERROR_STOP=1
-- Autorisation : SET LOCAL p7.extensions_authorized = 'yes';
-- Test de référence : pg_net 0.20.4 (schéma public), pg_cron 1.6.4 (pg_catalog).
-- ============================================================================

do $guard$
begin
  if current_setting('p7.extensions_authorized', true) is distinct from 'yes' then
    raise exception 'P71_EXTENSIONS_NOT_AUTHORIZED';
  end if;

  if to_regclass('public.dashboard_daily_metrics') is null then
    raise exception 'P71_INSTALL_OBJECTS_REQUIRED_FIRST';
  end if;
end
$guard$;

create extension if not exists pg_net with schema public;
create extension if not exists pg_cron with schema pg_catalog;

-- Contrôles (lecture) :
--   select extname, extversion from pg_extension where extname in ('pg_net','pg_cron');
--   select count(*) from cron.job where jobname like 'jisra_kpi%';  -- attendu 0
--   select to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,int)') is not null;
--
-- Rollback : ne pas supprimer pg_cron si d'autres jobs l'utilisent. Vérifier
--   select jobname from cron.job; avant toute suppression d'extension.
