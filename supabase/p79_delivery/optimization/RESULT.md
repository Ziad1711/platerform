# P7.10 — Optimisation des producteurs KPI V5 : résultat

**Date :** 22/10/2026. **Cible de mesure :** B13 isolé `biqrgdopcvkrbgfxkzxm`.
**Mode :** ACT. **Production :** aucune écriture, aucune activation.

---

## 1. Modifications implémentées

| Fichier | Rôle |
|---|---|
| `10_install_producer_optimization.sql` | Installe la capture par boutique, les portes d'éligibilité, les producteurs optimisés. **Aucun trigger créé** (installation inactive). |
| `20_activate_producers_optimized.sql` | Crée les 6 producteurs, vérifie 10 empreintes et l'état legacy. Capture **désarmée** à la sortie. |
| `90_verify_producer_optimization.sql` | Contrôle lecture seule (16 contrôles). |
| `91_rollback_producer_optimization.sql` | Retour exact au socle C0 + suppression des objets P7.10 (empreintes vérifiées). |
| `tests/producers_optimization_tests.sql` | 39 contrôles fonctionnels (39 PASS). |
| `b13/bench.sql`, `b13/variant.sql`, `b13/count_work.sql`, `b13/variant.sql` | Mesure ciblée et comptage déterministe du travail. |
| `b13/parse_perf.cjs`, `b13/analyze_tail.cjs` | Analyse statistique des journaux. |
| `MANIFEST.json`, `verify_static.cjs`, `VERIFY-STATIC.txt` | Empreintes, inventaire, contrôles statiques (47 PASS). |
| `evidence/` | Mesures, comptages, restauration, état final. |

### Objets ajoutés (Production : inactifs après installation)

- `dashboard_kpi_producer_config` (ligne unique, `enabled=false` par défaut).
- `dashboard_kpi_producer_stores` (éligibilité par boutique, aucune ligne par défaut).
- `dashboard_kpi_producers_armed()`, `dashboard_kpi_producer_active(uuid)` (cache transactionnel).
- `dashboard_kpi_day_claimed(uuid, date)` (déduplication intra-transaction).
- `dashboard_kpi_producer_arm(boolean)`, `..._disable_store(uuid,text)`, `..._enable_store(uuid,date,text)` (service_role).
- Vue `dashboard_kpi_producer_status`.

### Producteurs remplacés (mêmes signatures, SECURITY DEFINER, search_path, propriétaire)

1. `dashboard_kpi_invalidate_insert_stmt()` — déduplication **avant** insertion (`GROUP BY` boutique/jour) + filtre d'éligibilité.
2. `dashboard_kpi_invalidate_trg()` — porte globale, porte par boutique, filtre de colonnes réelles, marqueur de journée.
3. `dashboard_kpi_invalidate_orders_quality_trg()` — porte, marqueur, Casablanca conservé.
4. `dashboard_kpi_mark_order_insert()` — devient un trigger **d'instruction** (transition table) au lieu d'un appel par ligne.

Aucune formule financière, aucun agrégat, aucun worker, aucun lecteur, aucune cohorte lecteur n'a été modifié.

---

## 2. Optimisations validées et gains

### 2.1 Travail réel supprimé (PROUVÉ, déterministe)

Comptage des tentatives d'insertion dans le journal (`evidence/count-work-*.txt`),
contenu final du journal identique dans les deux versions :

| Opération | C0 (tentatives) | P7.10 (tentatives) | Lignes écrites |
|---|---:|---:|---:|
| Changement réel de prix d'article | 6 | **1** | 1 / 1 |
| Mise à jour d'article sans changement utile | 4 | **0** | 0 / 0 |
| Import de 600 commandes | **1 200** | **1** | 1 / 1 |

C'est la démonstration directe du diagnostic : 1 200 candidats pour une seule clé boutique/jour, et des invalidations émises pour des écritures sans effet sur les agrégats.

### 2.2 Latence mesurée (3 blocs appariés, ordre alterné)

`update_item_price` (n = 300 par variante) :

| Variante | Médiane | p95 | > 140 ms | max |
|---|---:|---:|---:|---:|
| A (aucun producteur) | 75,36 ms | 100,12 ms | 4 | 280,3 ms |
| C0 (producteurs précédents) | 77,12 ms | 93,96 ms | 4 | 561,1 ms |
| P7.10 | 76,76 ms | 91,32 ms | **0** | 123,7 ms |

Δ P7.10 vs A : **+1,86 %** médiane, **−8,79 %** p95. Δ P7.10 vs C0 : **−0,46 %** médiane, **−2,82 %** p95.

`import_orders_600` (n = 60 par variante) :

| Variante | Médiane | p95 | max |
|---|---:|---:|---:|
| A | 305,16 ms | 376,29 ms | 450,6 ms |
| C0 | 307,04 ms | 412,20 ms | 634,7 ms |
| P7.10 | 306,60 ms | 410,81 ms | 427,9 ms |

Δ P7.10 vs A : **+0,47 %** médiane, **+9,17 %** p95 (budgets +15 % / +25 % respectés).
Δ P7.10 vs C0 : **−0,14 %** médiane, **−0,34 %** p95.

### 2.3 Pics p95 : résultat négatif assumé

Campagne longue (2 blocs de 400 itérations) :

| Variante | Médiane | p95 | > 140 ms | > 250 ms |
|---|---:|---:|---:|---:|
| A | 76,07 ms | 165,01 ms | **48 / 800** | 11 |
| C0 | 75,83 ms | 96,95 ms | 7 / 800 | 3 |
| P7.10 | 75,28 ms | 151,49 ms | **45 / 800** | 21 |

La variante **sans aucun producteur** présente autant de pics que P7.10. Les pics ne sont donc
**pas imputables aux producteurs KPI** ; ils varient d'un bloc à l'autre (bruit de connexion/pooler).
La campagne courte suggérait une disparition des pics en P7.10 : **cette observation n'est pas confirmée**.

---

## 3. Tests

| Contrôle | Résultat |
|---|---|
| Fonctionnels B13 (39 assertions) | **39 PASS** |
| Vérification SQL des producteurs (16 contrôles) | **16 PASS** |
| Vérifications statiques (47 contrôles) | **47 PASS** |
| Rollback → C0 | **PASS** (`ROLLBACK_OK_C0_RESTORED_NO_PRODUCER`) |

Couverture fonctionnelle : commande et articles en transactions distinctes, prix et coût d'article,
colonne non consommée, mouvement de parent, suppression, statut, date, boutique, publicité, commande
supprimée, capture désarmée, boutique non éligible, reprise avec rattrapage, frontières Casablanca
(22/10 23:59, 23/10 00:01, 19/09 avant correctif), chaîne journal → worker → agrégat comparée au
calcul direct (`revenue=500.00`, `purchase=140.00`).

Les 6 FAIL observés en cours de route venaient du harnais (sous-tests partageant la même transaction,
donc le même marqueur de journée ; ordre d'état hérité ; attente de fuseau erronée). Ils ont été
corrigés dans les tests, pas dans le code produit.

---

## 4. Activation par boutique : PASS (locale), non éprouvée en Production

- Capture **désarmée par défaut** ; une boutique sans ligne n'est pas capturée.
- Éligibilité évaluée **avant** les lectures de fuseau et les insertions ; ancienne **et** nouvelle boutique
  évaluées lors d'un déplacement (test T10 : ancienne notifiée, nouvelle silencieuse).
- Aucune perte pour les boutiques éligibles : tests T1–T9, T11, T12, T14, T16.
- Reprise : `disable_store` horodate l'arrêt ; `enable_store` reconstruit la journée d'arrêt et toutes
  les journées suivantes (événements `capture:resume:...`), donc un agrégat produit pendant l'arrêt
  n'est jamais réputé à jour.
- Invariant contrôlé par `90_verify` : **aucune boutique servie par le lecteur V5 sans capture active**.

Limite : la désactivation n'éteint pas le lecteur. L'exploitant doit appliquer la règle
« capture arrêtée ⇒ lecteur arrêté pour cette boutique » ; la vue `dashboard_kpi_producer_status`
la signale (`STALE_CAPTURE_DISABLED`) et la vérification la refuse si une cohorte est active.

---

## 5. Patch Production : PRÊT, NON APPLIQUÉ

Séquence : `10_` (installation inactive) → `20_` (6 producteurs, capture désarmée) → armement explicite
+ éligibilité boutique → rattrapage → lecteur. `91_` pour le retour.

Garde d'activation : projet dans `('attvfeoqgbxsnnsllatt','biqrgdopcvkrbgfxkzxm')` uniquement,
`kpi.global_write_risk_accepted='yes'`, rollout legacy, worker/réveil arrêtés, zéro trigger KPI,
10 empreintes conformes, capture désarmée. Une dérive de fonction bloque l'activation.

---

## 6. État final

**B13** (`evidence/b13-final-state.txt`) : 0 boutique, 0 commande, 0 article, 0 publicité, 0 événement,
0 agrégat, 0 état boutique, 0 exécution worker, 0 trigger KPI, aucun objet P7.10, aucun helper Casablanca,
aucun objet de test ; `worker_enabled=false`, rollout `true/legacy` ; empreinte `insert_stmt` = `2536fe3c…` (C0).

Écart déclaré : les corps de fonction restaurés depuis la capture ont été normalisés en **LF**, alors que
B13 portait des corps en CRLF. Les définitions sont désormais identiques au paquet P7.1 (empreintes
`b5211b6e…`, `091c0890…`, `2536fe3c…`, `51396e7b…`), donc **plus proches de Production** qu'avant.
Empreintes d'origine archivées dans `b13/capture/b13_before_hashes.txt`.

**Production** : aucune connexion en écriture, aucun objet créé, aucune activation.

---

## 7. Risques résiduels et prochaine action

1. **Pics p95 non expliqués.** Ils existent sans producteurs ; aucune correction ne peut être revendiquée.
   La comparaison A/C0/P7.10 doit être refaite dans une fenêtre où la variante A est stable.
2. **Coût résiduel du marqueur** : 600 `set_config` par import de 600 lignes subsistent (comportement conservé).
   Les supprimer est possible (le journal resterait identique grâce à l'index unique) mais change la
   sémantique du marqueur : décision séparée, non prise ici.
3. **Gain d'import non démontré en latence** : seule la réduction de travail est prouvée (1 200 → 1).
   Le surcoût historique de +36–40 ms **n'a pas été reproduit** (A 305 ms → P7.10 306,6 ms) ;
   l'exception `EXCEPTION-IMPORT-600.md` devient sans objet mais ne doit pas être présentée comme un PASS.
4. **Non testé** : charge concurrente réelle, journées à très fort volume, reprise après arrêt du worker,
   cohorte partielle en Production, comportement sous RLS avec un rôle non propriétaire.
5. **Prochaine action indispensable** : rejouer A/C0/P7.10 sur B13 dans une fenêtre stable (A sans pic)
   et avec écriture concurrente, puis décider l'armement d'une seule boutique pilote.
