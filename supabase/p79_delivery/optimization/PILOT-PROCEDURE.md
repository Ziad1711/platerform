# P7.10 — Procédure de pilote sur une seule boutique

**Cible :** Production `attvfeoqgbxsnnsllatt`. **État d'entrée :** socle KPI V5 installé,
Casablanca appliqué, 27 fonctions, **0 trigger**, rollout `true/legacy`, worker arrêté,
0 cohorte, tables P7.10 absentes (`92_verify_production_compatibility.sql`).

> Aucune étape de ce document n'est exécutée par la présente mission.
> Chaque étape exige une autorisation explicite et un opérateur identifié.

## 0. Invariants

1. Capture **désarmée** tant que `dashboard_kpi_producer_config.enabled = false`.
2. Une boutique sans ligne dans `dashboard_kpi_producer_stores` n'est **pas** capturée.
3. Le lecteur reste en `legacy` jusqu'au rapprochement signé de l'étape 5.
4. **Arrêt capture ⇒ arrêt lecteur** pour la boutique : un agrégat produit après l'arrêt n'est pas fiable.
5. `dashboard_kpi_producer_status.capture_health = 'STALE_CAPTURE_DISABLED'` interdit toute lecture V5.
6. Les budgets de performance et les formules financières ne changent pas.

## 1. Installation inactive (aucun trigger, capture désarmée)

```bash
# Installation INACTIVE : voir INSTALL-INACTIVE.md (commandes exactes + conditions d'arrêt)
# puis vérification 89_verify_inactive_install.sql avant toute activation.
```

Contrôles :

```sql
select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
 where c.relnamespace='public'::regnamespace and not t.tgisinternal and t.tgname like 'trg_kpi_%';  -- 0
select enabled from public.dashboard_kpi_producer_config where id=1;                                -- false
select count(*) from public.dashboard_kpi_producer_stores;                                         -- 0
```

## 2. Activation des six producteurs (toujours désarmés)

```sql
set kpi.producers_authorized='attvfeoqgbxsnnsllatt';
set kpi.global_write_risk_accepted='yes';
-- 20_activate_producers_optimized.sql
```

Contrôles : 6 triggers actifs, capture `false`, 0 boutique éligible, hashes conformes
(`90_verify_producer_optimization.sql`). **Aucune écriture métier n'est encore capturée.**

## 3. Armement contrôlé d'une seule boutique + backfill

```sql
-- 1) éligibilité de la boutique pilote UNIQUEMENT
select public.dashboard_kpi_producer_enable_store('<STORE_ID>'::uuid, '<DEBUT_BACKFILL>'::date, 'pilote p710');
-- -> enqueue les journées [DEBUT_BACKFILL .. aujourd'hui] en 'capture:resume'

-- 2) armement global
select public.dashboard_kpi_producer_arm(true);

-- 3) vérification d'éligibilité
select * from public.dashboard_kpi_producer_status where store_id = '<STORE_ID>';
```

Ordre imposé : **enqueue avant armement**, sinon la fenêtre entre l'armement et le backfill
n'est pas couverte.

Contrôles :

```sql
select count(*) from public.dashboard_kpi_invalidation where processed_at is null;   -- > 0
select capture_enabled, armed, pending_events from public.dashboard_kpi_producer_status;
```

## 4. Worker

1. Le worker reste **arrêté** pendant le backfill initial.
2. Pour drainer, deux voies :
   - reprise manuelle assistée : `select * from public.dashboard_kpi_resume(50, 'pilot-manual', true);`
     (`p_force=true` est requis tant que `dashboard_kpi_worker_config.enabled=false`) ;
   - worker planifié : `update public.dashboard_kpi_worker_config set enabled=true where id=1;`
     puis surveillance du cron.
3. Un échec de partition ne bloque plus le worker : `stop_reason='partition_error'`,
   `last_error` renseigné, backoff posé, événement conservé.

Contrôles à chaque passage :

```sql
select worker, started_at, duration_ms, partitions_rebuilt, partitions_failed, stop_reason, last_error
  from public.dashboard_kpi_worker_run order by run_id desc limit 5;
select store_id, count(*) pending, min(occurred_at) oldest
  from public.dashboard_kpi_invalidation where processed_at is null group by store_id;
```

Critères : `partitions_failed = 0` sur les 3 derniers passages, backlog < 5 min, aucun `last_error`.

## 5. Rapprochement obligatoire avant lecteur

Exécuter pour la période pilote :

```sql
-- a) agrégat vs calcul direct, par jour
select m.business_date, m.orders_count as agg, d.orders_count as direct,
       m.revenue_items_gross as agg_rev, d.revenue_items_gross as direct_rev
  from public.dashboard_daily_metrics m
  join lateral public.dashboard_kpi_direct_day('<STORE_ID>'::uuid, m.business_date, 'Africa/Casablanca') d on true
 where m.store_id = '<STORE_ID>' and m.axis = 'order'
   and m.business_date between '<DEBUT>' and '<FIN>'
   and (m.orders_count <> d.orders_count or m.revenue_items_gross <> d.revenue_items_gross);
-- doit retourner 0 ligne
```

```sql
-- b) couverture et fraîcheur
select * from public.dashboard_kpi_coverage('<STORE_ID>'::uuid, '<DEBUT>'::date, '<FIN>'::date);
select * from public.dashboard_kpi_store_state where store_id = '<STORE_ID>';
```

Critères de passage (tous obligatoires) :

- 0 ligne d'écart sur `orders_count`, `revenue_items_gross`, `purchase_cost` ;
- `pending_partitions = 0` et `last_rebuild_at` < 5 min ;
- journal : 0 événement en erreur ;
- Casablanca : aucune journée décalée sur les bornes de minuit.

## 6. Autorisation du lecteur (uniquement après 5)

```sql
insert into public.dashboard_kpi_rollout_cohorts (store_id, mode, cohort, enabled)
values ('<STORE_ID>', 'v5', 'pilot', true);
update public.dashboard_kpi_rollout_config
   set requested_mode='v5', kill_switch=false, readiness_backend=true, updated_at=clock_timestamp()
 where id=1 and readiness_tzdata;
```

Puis vérifier l'invariant : **toute boutique servie par V5 doit avoir la capture active**
(`90_verify_producer_optimization.sql`, contrôle `reader_implies_capture`).

## 7. Surveillance et retour legacy

Surveillance (toutes les 5 min pendant 24 h) :

```sql
select * from public.dashboard_kpi_health;
select count(*) filter (where processed_at is null) pending,
       count(*) filter (where last_error is not null and processed_at is null) errors
  from public.dashboard_kpi_invalidation;
select pid, state, wait_event_type, wait_event, now()-query_start age
  from pg_stat_activity where datname=current_database() and state <> 'idle' and now()-query_start > interval '5 s';
```

Seuils d'alerte : backlog > 60 s, `partitions_failed > 0` deux passages consécutifs, p95 de lecture V5 > legacy + 20 %.

Retour lecteur (immédiat, sans toucher aux producteurs) :

```sql
update public.dashboard_kpi_rollout_config set kill_switch=true, requested_mode='legacy', updated_at=clock_timestamp() where id=1;
delete from public.dashboard_kpi_rollout_cohorts where store_id='<STORE_ID>';
```

## 8. Arrêt réel des producteurs

Un kill switch lecteur **n'arrête pas** les écritures. Pour arrêter la capture :

```sql
-- 1) désarmer immédiatement (les triggers restent mais ne font plus rien)
select public.dashboard_kpi_producer_arm(false);

-- 2) retirer la boutique (horodate l'arrêt pour le rattrapage futur)
select public.dashboard_kpi_producer_disable_store('<STORE_ID>'::uuid, 'arret pilote');

-- 3) arrêter le lecteur pour cette boutique (règle d'invariant)
update public.dashboard_kpi_rollout_config set kill_switch=true, requested_mode='legacy' where id=1;
delete from public.dashboard_kpi_rollout_cohorts where store_id='<STORE_ID>';
```

Après arrêt : les agrégats postérieurs à `disabled_at` sont **non fiables** ; au redémarrage,
`dashboard_kpi_producer_enable_store(...)` enqueue automatiquement le rattrapage depuis la journée d'arrêt.

Arrêt définitif (retrait des six triggers) : `91_rollback_producer_optimization.sql`
(drops des triggers, restauration C0, suppression des objets P7.10, hashes vérifiés).

## 9. Rollback

```sql
set kpi.producers_opt_authorized='yes';
-- 91_rollback_producer_optimization.sql  (transaction unique)
```

Effets : 6 triggers supprimés, 4 producteurs C0 restaurés, worker d'origine restauré,
objets P7.10 supprimés, empreintes C0 vérifiées. **Aucune donnée métier ni agrégat supprimé.**
La configuration de capture est perdue (décision d'exploitation, à redéclarer).

## 10. Points d'attention spécifiques à Production

- `ACTIVATE-PRODUCERS-FINAL.sql` (inventaire 27 fonctions) devient **inapplicable** après P7.10
  (34 fonctions) : utiliser exclusivement `20_activate_producers_optimized.sql`.
- Le worker global est mono-flux : un seul `dashboard_kpi_worker_run` à la fois, les autres
  retournent `concurrent_run` (vérifié).
- Une boutique pilote n'isole que la **capture** : les triggers restent attachés aux tables.
  Le coût hors cohorte est celui des portes d'éligibilité (mesuré < 0,5 ms serveur).
