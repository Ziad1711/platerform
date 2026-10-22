# P7.10 — Qualification finale (concurrence, permissions, worker, performance, pilote)

**Date :** 22/10/2026 · **Cible :** B13 isolé `biqrgdopcvkrbgfxkzxm` · **Production :** lecture seule.
**Paquet :** `10_install` · `11_worker_failure_resilience` · `20_activate` · `90_verify` · `91_rollback`

---

## 1. Concurrence — **PASS** (17 contrôles, 0 deadlock)

Sessions réellement parallèles (`b13/concurrency_run.sh`, journal `evidence/concurrency.log`).

| Scénario | Attendu | Obtenu |
|---|---|---|
| S1 événement tardif entre claim et acquittement | 1 événement resté pending | **PASS** |
| S1 drainage suivant | 0 pending, agrégat = 2 | **PASS** |
| S2 6 écritures pendant un rebuild | écritures enregistrées, 0 perdu | **PASS** |
| S2 après drainage | 0 pending, agrégat correct | **PASS** |
| S3 deux workers simultanés | `concurrent_run` observé | **PASS** |
| S3 backlog et agrégats après les deux passages | 0 pending, 1+1 | **PASS** |
| S4 deux transactions, même boutique/jour | 2 événements (1 par transaction) | **PASS** |
| S4 agrégat après drainage | 100 commandes | **PASS** |
| S5 déplacement de boutique pendant rebuild | événement ancienne **et** nouvelle boutique | **PASS** |
| S5 agrégats après drainage | 0 (ancienne) / 1 (nouvelle) | **PASS** |
| Deadlocks | delta = 0 | **PASS** |

**Contrat prouvé :** l'acquittement est nominatif (`seq = any(p_seqs) AND claim_token = p_token`).
Un événement arrivé après le claim n'est jamais acquitté par le cycle en cours ; il déclenche
un recalcul supplémentaire (idempotent) et reste donc sans perte.

---

## 2. Permissions — **PASS** (16 contrôles)

`tests/qualification_permissions.sql`.

- `EXECUTE` refusé à `authenticated` et `anon` sur `producer_arm`, `enable_store`, `disable_store` ;
  autorisé à `service_role`.
- Tables `producer_config`, `producer_stores`, journal, vue de statut : aucun droit pour `authenticated`.
- Tentatives réelles sous rôle applicatif : `42501` (insufficient_privilege) pour armement, activation,
  désactivation, lecture et écriture du journal, modification de l'éligibilité.
- `service_role` conserve le pilotage (seul chemin d'armement).

Conséquence : un commercial **et** un utilisateur d'une autre boutique ne peuvent pas armer ou
désarmer les producteurs, ni lire/forger le journal. L'isolation JWT du lecteur reste celle déjà qualifiée.

---

## 3. Worker et rattrapage — **PASS** (15 + 9 contrôles)

| Contrôle | Résultat |
|---|---|
| Worker arrêté : `stop_reason='disabled'`, backlog conservé | PASS |
| Activation : drainage complet, agrégat = calcul direct | PASS |
| Arrêt en cours de drainage (`partition_budget`/`time_budget`) | PASS |
| Reprise : 8/8 partitions, 0 échec, backlog 0 | PASS |
| `dashboard_kpi_resume` sans `p_force` et worker arrêté | `KPI_WORKER_DISABLED` (arrêt effectif) | PASS |
| Reprise forcée explicite | 1 reconstruite, 0 échec, backlog 0 | PASS |
| Échec réel de rebuild (verrou tenu) | `partition_error`, événement conservé, `attempts=1`, `last_error` posé, backoff posé | PASS |
| Reprise après backoff | drainage complet, agrégat = direct | PASS |

### Défaut produit démontré et corrigé

Avant correctif, si le verrou qui faisait échouer le rebuild était encore tenu, le **handler d'erreur**
échouait à son tour (même table) : `dashboard_kpi_worker_run` levait une exception au lieu de
retourner `partition_error`, et aucun backoff n'était posé (risque de boucle serrée).

`11_worker_failure_resilience.sql` :
- helper `dashboard_kpi_worker_note_failure(...)` ;
- `lock_timeout` borné à 250 ms ;
- **deux points de sauvegarde indépendants** (backoff journal / état boutique) ;
- appel en meilleur effort depuis le worker.

Avant / après (même scénario, verrou réel) :

| | Avant | Après |
|---|---|---|
| Retour du worker | exception SQL | `partition_error`, `partitions_failed=1` |
| Événement | pending, `attempts=0` | pending, `attempts=1`, `last_error` |
| Backoff | absent | posé |
| Reprise | drainage OK | drainage OK, agrégat = direct |

---

## 4. Performance A / C0 / P7.10 — fenêtre contrôlée

Stabilité de A vérifiée par encadrement (2 blocs alternés, 40 itérations par variante,
log `evidence/stab-summary.txt`) :

- écart médiane A bloc1/blob2 : **4,25 %** (seuil 10 %) ;
- écart p95 A bloc1/bloc2 : **9,14 %** (seuil 25 %) ;
- **fenêtre jugée stable**.

### Latence par mutation d'article (80 mesures/variante)

| Variante | Médiane client | p95 client | >140 ms | **Médiane serveur** | p95 serveur |
|---|---:|---:|---:|---:|---:|
| A (aucun producteur) | 77,15 ms | 95,25 ms | 1 | **1,365 ms** | 1,976 ms |
| C0 (producteurs précédents) | 78,94 ms | 104,16 ms | 1 | **1,777 ms** | 5,334 ms |
| P7.10 | 75,14 ms | 98,36 ms | 2 | **1,720 ms** | 2,576 ms |

Lecture :

1. Le **temps serveur** (triggers inclus, hors réseau/commit) est de l'ordre de **1,4 à 1,8 ms**.
   Le coût intrinsèque des producteurs est donc **≈ +0,35 ms** par mutation.
2. La latence client (~75-79 ms) est dominée par le pooler/commit : **100× le coût serveur**.
3. Les pics (>140 ms, jusqu'à 380 ms) existent **sans producteur** (A : 1/80) comme avec (P7.10 : 2/80).
   Ils ne sont **pas attribuables aux producteurs** ; ils sont hors serveur.
4. P7.10 est **meilleur que C0** en médiane client (−4,8 %) et en p95 client (−5,6 %),
   et meilleur en queue serveur (p95 2,58 ms vs 5,33 ms).

### Import 600 commandes (campagne précédente, producteurs inchangés)

| | A | C0 | P7.10 |
|---|---:|---:|---:|
| Médiane | 305,16 ms | 307,04 ms | 306,60 ms |
| p95 | 376,29 ms | 412,20 ms | 410,81 ms |

Δ P7.10 vs A : **+0,47 %** médiane, **+9,17 %** p95 (budgets +15 % / +25 %).
Travail supprimé (déterministe) : **1 200 → 1** tentative d'insertion ; journal identique.

**Verdict performance :** aucune régression démontrée ; coût serveur marginal ;
les pics p95 ne sont **pas** un coût des producteurs. Le seuil historique de +15 %
n'est plus atteint sur l'import dans cette fenêtre (surcoût mesuré ≈ +1,4 ms).

---

## 5. Compatibilité Production — **PRÊT** (lecture seule)

`92_verify_production_compatibility.sql` sur `attvfeoqgbxsnnsllatt` (aucune écriture,
`default_transaction_read_only=on`) :

| Contrôle | Valeur |
|---|---|
| Version | PostgreSQL 17.6 |
| Fonctions KPI | 27 |
| Triggers KPI | 0 |
| `dashboard_kpi_local_ts` | présent (Casablanca appliqué) |
| Tables P7.10 | absentes |
| Helper worker P7.10 | absent |
| Rollout / worker / cohortes | `true/legacy` · false · 0 |
| Hashes C0 | `db188175` · `10e7ba59` · `0af85329` · `51396e7b` · worker `f41abff2` |

Ces hashes sont **exactement** ceux attendus par `10_`/`11_` et par le rollback `91_` :
le paquet s'applique sans dérive. Après application, l'ancien `ACTIVATE-PRODUCERS-FINAL.sql`
(inventaire 27 fonctions) devient inapplicable — utiliser `20_activate_producers_optimized.sql`.

---

## 6. Restauration B13 — **PASS**

| Contrôle | Valeur |
|---|---|
| Triggers KPI | 0 |
| Boutiques / commandes / articles / publicités | 0 / 0 / 0 / 0 |
| Journal / agrégats / état boutique | 0 / 0 / 0 |
| Exécutions worker | 0 |
| Objets P7.10 | absents (tables, vue, 7 fonctions) |
| Helpers Casablanca | absents |
| Objets de test `p710_*` | 0 |
| Worker / rollout | `false` · `true/legacy` |
| Empreinte `invalidate_insert_stmt` | `2536fe3c…` (C0) |

Rollback exécuté par `91_rollback_producer_optimization.sql` :
`ROLLBACK_OK_C0_RESTORED_NO_PRODUCER`, hashes C0 et worker vérifiés.
Écart déclaré (identique à la phase précédente) : corps de fonctions normalisés en **LF**,
identiques au paquet P7.1/Production.

---

## 7. Pilote — **PRÊTE**

`PILOT-PROCEDURE.md` : installation inactive → activation désarmée → armement d'**une** boutique
+ backfill → worker → **rapprochement obligatoire** → lecteur seulement après rapprochement →
surveillance → retour legacy → **arrêt réel** des producteurs → rollback.

---

## 8. Limites et non testé

1. **Non testé** : charge concurrente à fort volume (milliers de mutations/s), journées à très gros volume.
2. **Non testé** : comportement sous RLS avec un rôle non propriétaire en Production (B13 utilise `postgres`).
3. **Non testé** : le cron Production (pg_cron non installé sur B13) — drainage testé par appels directs.
4. **Non démontré** : disparition des pics p95 ; la mesure montre qu'ils ne viennent pas des producteurs.
5. **Non mesuré** : coût du helper `note_failure` (uniquement en chemin d'erreur).
6. Les mesures client incluent le pooler ; seules les mesures serveur sont attribuables au code.
