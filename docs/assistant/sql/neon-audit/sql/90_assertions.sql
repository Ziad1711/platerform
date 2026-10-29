-- ============================================================================
-- 90 — Invariants finaux, réconciliation et verdict
-- LECTURE SEULE sur les tables métier (hors suppressions de fixtures).
-- À exécuter APRÈS les scénarios, AVANT 99_cleanup.sql.
-- ============================================================================
\set ON_ERROR_STOP on

select owner_id, store_a from audit.fx \gset

\echo ''
\echo '== Invariants de registre =='

select audit.assert_eq('I01.charged_le_consumed',
  (select count(*)::text from public.assistant_requests where credits_charged > credits_consumed),
  '0', 'aucun débit supérieur à la consommation');

select audit.assert_eq('I02.one_row_per_key',
  (select count(*)::text from (
     select user_id, request_id from public.assistant_requests
      group by user_id, request_id having count(*) > 1) d),
  '0', 'clé d''idempotence unique');

select audit.assert_eq('I03.no_negative',
  (select count(*)::text from public.assistant_requests
    where credits_reserved < 0 or credits_consumed < 0 or credits_charged < 0),
  '0', 'compteurs positifs');

select audit.assert_eq('I04.completed_has_status',
  (select count(*)::text from public.assistant_requests
    where state = 'completed' and credit_status = 'not_charged'),
  '0', 'aucune clôture sans statut de débit');

select audit.assert_eq('I05.lease_bounded',
  (select count(*)::text from public.assistant_requests
    where state = 'in_progress' and lease_until > clock_timestamp() + interval '3 minutes'),
  '0', 'bail borné');

\echo ''
\echo '== Réconciliation (à archiver, non bloquante) =='
select r.state, r.credit_status, count(*) as requests,
       sum(r.credits_reserved) as reserved,
       sum(r.credits_consumed) as consumed,
       sum(r.credits_charged)  as charged
  from public.assistant_requests r
 group by r.state, r.credit_status
 order by 1, 2;

select w.monthly_credits, w.credits_used,
       (select coalesce(sum(credits_charged), 0) from public.assistant_requests
         where user_id = w.user_id and state = 'completed') as charged_total,
       (w.credits_used <= w.monthly_credits) as within_quota
  from public.ai_credit_wallets w
 where w.user_id = :'owner_id'::uuid;

select audit.assert_true('I06.within_quota',
  (select w.credits_used <= w.monthly_credits from public.ai_credit_wallets w
    where w.user_id = :'owner_id'::uuid), 'aucun dépassement de plafond');

-- Cas R12 : la conversation a été supprimée après un débit. Le débit doit être
-- conservé dans le registre, même si le message a disparu avec la conversation.
select audit.assert_eq('I07.r12_debit_preserved',
  (select coalesce(credits_charged, -1)::text from public.assistant_requests
    where request_id = '20000000-0000-4000-8000-000000000012'),
  '1', 'débit conservé après suppression de la conversation');

select audit.assert_eq('I08.r12_status_preserved',
  (select coalesce(credit_status, 'null') from public.assistant_requests
    where request_id = '20000000-0000-4000-8000-000000000012'),
  'charged', 'statut de débit conservé');

\echo ''
\echo '== Verdict =='
select status, count(*) as cases
  from audit.results
 group by status
 order by status;

select
  case when exists (select 1 from audit.results where status = 'FAIL')
       then 'NO-GO'
       else 'GO'
  end as verdict,
  (select count(*) from audit.results where status = 'PASS') as passed,
  (select count(*) from audit.results where status = 'FAIL') as failed,
  (select count(*) from audit.results) as total;

\echo 'Rappel : GO ne vaut que pour CE périmètre (SQL, rôles simulés).'
\echo 'L''authentification HTTP et le cache PostgREST restent non validés.'

