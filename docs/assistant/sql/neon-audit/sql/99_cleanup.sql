-- ============================================================================
-- 99 — Nettoyage de l'environnement temporaire (fixtures + harnais)
-- À exécuter APRÈS avoir archivé les résultats (90_assertions.sql).
-- Ne supprime PAS la base : la suppression du projet Neon est une étape
-- distincte, autorisée séparément (voir PROTOCOL.md §7).
-- ============================================================================
\set ON_ERROR_STOP off

-- 1. Désactiver l'injection d'erreur d'audit.
select audit.remove_late_failure();

-- 2. Effacer les données synthétiques, dans l'ordre des dépendances.
do $$
declare
  v_owner uuid; v_admin uuid; v_viewer uuid; v_accountant uuid; v_outsider uuid;
  v_store_a uuid; v_store_b uuid; v_free uuid; v_paid uuid;
begin
  select owner_id, admin_id, viewer_id, accountant_id, outsider_id,
         store_a, store_b, plan_free, plan_paid
    into v_owner, v_admin, v_viewer, v_accountant, v_outsider,
         v_store_a, v_store_b, v_free, v_paid
    from audit.fx;

  delete from public.assistant_requests
   where user_id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);

  delete from public.chat_messages
   where thread_id in (select id from public.chat_threads
                        where user_id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider));

  delete from public.chat_threads
   where user_id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);

  delete from public.ai_usage
   where user_id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);

  delete from public.ai_credit_wallets
   where user_id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);

  delete from public.store_members
   where store_id in (v_store_a, v_store_b)
      or user_id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);

  delete from public.subscriptions
   where user_id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);

  delete from public.stores where id in (v_store_a, v_store_b);
  delete from public.plans  where id in (v_free, v_paid);
  delete from public.profiles
   where id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);

  -- Identités référentielles du shim (aucune donnée métier).
  delete from auth.users
   where id in (v_owner, v_admin, v_viewer, v_accountant, v_outsider);
end;
$$;

-- 3. Supprimer le harnais.
drop schema if exists audit cascade;

-- 4. Vérification : la base doit être revenue à son état initial (aucune ligne).
select
  coalesce((select count(*) from public.chat_threads), 0) as chat_threads_rows,
  coalesce((select count(*) from public.chat_messages), 0) as chat_messages_rows,
  coalesce((select count(*) from public.ai_usage), 0) as ai_usage_rows,
  coalesce((select count(*) from public.ai_credit_wallets), 0) as wallets_rows,
  coalesce((select count(*) from public.assistant_requests), 0) as requests_rows,
  coalesce((select count(*) from public.profiles), 0) as profiles_rows;

\echo ''
\echo 'Nettoyage logique terminé. Étape suivante (autorisée séparément) :'
\echo 'suppression du projet Neon entier et révocation des credentials.'
