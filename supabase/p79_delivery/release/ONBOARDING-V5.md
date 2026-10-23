# P8.5 — Initialisation automatique KPI V5 des nouvelles boutiques

Runbook d'exploitation. **Aucune étape de ce document n'a été exécutée en
Production** (mission en lecture seule). À appliquer sous autorisation distincte.

## 1. Ce que fait le lot

- Découvre les boutiques sans cohorte lecteur, par lots bornés, sans trigger sur
  `stores` (couvre donc aussi les insertions directes en base).
- Active la capture, borne puis enfile le rattrapage (fenêtres de `p_window_days`).
- Recalcule la borne historique réelle (`history_from`) et la fait **reculer**
  quand un import ancien apparaît ; la cohorte repasse alors legacy.
- Promeut la cohorte `auto` uniquement si : capture active, couverture depuis la
  borne jusqu'au jour courant, aucune invalidation en attente, aucun jour sale,
  agrégats cohérents avec la lecture directe, propriétaire présent, rollout prêt
  (`readiness_*` vrai et `kill_switch` faux).
- Ne touche jamais une cohorte opérateur, ni les boutiques déjà servies en V5.

Point d'entrée : `public.dashboard_kpi_worker_tick(...)`, appelé par le **job
`dashboard-kpi-worker` existant**, même fréquence (toutes les 2 minutes).

## 2. Déploiement (une transaction par étape)

1. **Migration** — `supabase/migrations/20261023130000_dashboard_kpi_store_onboarding.sql`
   (via `supabase db push` ou `psql -X -w -1 -v ON_ERROR_STOP=1 -f`).
   Garde d'installation : échoue si une dépendance P7.8–P7.10 manque.
2. **Commande du cron** — même job, même planification :

```sql
select cron.alter_job(job_id,
         command := $$select * from public.dashboard_kpi_worker_tick('cron', 10, 5000, 4.0)$$)
  from cron.job
 where jobname = 'dashboard-kpi-worker';
```

3. **Contrôle immédiat** (aucune nouvelle boutique attendue) :

```sql
select jobname, schedule, active, command from cron.job where jobname = 'dashboard-kpi-worker';
select * from public.dashboard_kpi_onboarding_status();      -- doit rester vide
select count(*) from public.dashboard_kpi_rollout_cohorts;   -- inchangé (10)
select count(*) from public.dashboard_kpi_worker_run where started_at > now() - interval '10 minutes';
```

## 3. Surveillance

```sql
-- avancement des nouvelles boutiques
select store_id, store_name, state, capture_enabled, history_from,
       coverage_from, coverage_to, pending_partitions, cohort_enabled,
       attempts, last_gate, last_error
  from public.dashboard_kpi_onboarding_status();

-- incidents
select store_id, state, attempts, last_gate, last_error
  from public.dashboard_kpi_store_onboarding
 where state in ('blocked','ready') or last_error is not null;

-- santé du worker / délai de promotion
select worker, started_at, partitions_rebuilt, partitions_failed, stop_reason, last_error
  from public.dashboard_kpi_worker_run order by run_id desc limit 5;
select count(*) as backlog from public.dashboard_kpi_invalidation where processed_at is null;
```

Latence attendue : promotion d'une boutique vide dans le même tick ; boutique avec
import de N jours ≈ `1 + ceil(N / 10)` ticks (10 partitions par passage, plafond du
worker inchangé). Pendant ce temps la boutique et la vue « Toutes les boutiques »
restent en legacy : aucun total V5 partiel n'est affiché.

## 4. Rollback

Retour immédiat au comportement antérieur, sans perte d'agrégats ni de journal :

```sql
-- a) une boutique précise : legacy + capture optionnellement coupée
select public.dashboard_kpi_onboarding_rollback('<STORE_ID>'::uuid, false);

-- b) toutes les nouvelles boutiques : retirer uniquement les cohortes automatiques
delete from public.dashboard_kpi_rollout_cohorts where cohort = 'auto';
update public.dashboard_kpi_store_onboarding
   set state = 'paused', last_gate = 'rolled_back', updated_at = clock_timestamp()
 where state <> 'paused';

-- c) automatisation seule (lecteur V5 existant préservé)
select cron.alter_job(job_id,
         command := $$select * from public.dashboard_kpi_worker_run('cron', 10, 5000, 4.0)$$)
  from cron.job
 where jobname = 'dashboard-kpi-worker';

-- d) retrait complet du lot (facultatif, après (b) et (c))
drop function if exists public.dashboard_kpi_worker_tick(text, integer, bigint, numeric, integer, integer);
drop function if exists public.dashboard_kpi_onboarding_step(uuid, integer, boolean);
drop function if exists public.dashboard_kpi_onboarding_run(integer, integer, boolean);
drop function if exists public.dashboard_kpi_onboarding_status();
drop function if exists public.dashboard_kpi_onboarding_rollback(uuid, boolean);
drop function if exists public.dashboard_kpi_onboarding_resume(uuid);
drop table if exists public.dashboard_kpi_store_onboarding;
```

Le kill switch global (`dashboard_kpi_rollout_config.kill_switch`) reste le
dispositif d'arrêt de la **lecture** ; il n'arrête pas la capture.

## 5. Reprise après incident

- `blocked` : backoff automatique (2 min → 1 h). Corriger la cause, puis
  `select public.dashboard_kpi_onboarding_resume('<STORE_ID>'::uuid);`
- `paused` (rollback opérateur) : idem après décision.
- `ready` avec `manual_cohort_present` : une cohorte opérateur existe ; la
  automatisation ne la modifie jamais.
- Import massif en cours : la boutique reste legacy jusqu'à couverture complète ;
  ne pas promouvoir manuellement pour « gagner du temps ».
