# B13 — Clôture de l'optimisation 1 (C1) : **ABANDONNÉE**

Décision du 20/10/2026. Aucune modification SQL métier. B13 est revenue à C0.

## 1. Décision

**Optimisation 1 (`dashboard_kpi_invalidate_insert_stmt`, branche `orders`) : ABANDONNÉE, non adoptée.**

| Référence | Empreinte | Statut |
|---|---|---|
| **C0 officielle** | **`2536fe3c58c8af6b18acb844ac585049`** | **référence active**, restaurée |
| **C1 évaluée** | **`578763df7d0c7431f626ba87429e0f2f`** | mesurée dans la campagne comparative, **ABANDONNÉE, non adoptée** |
| C1 tentative antérieure | `9b3c13d478b66860d00a5c1acd7a8cbf` | **non adoptée**, aucune campagne rattachée |
| C0 historique textuelle | `c685fdd2e81ee1f9034be3f4ceaf53fd` | traçabilité uniquement |

### 1.1 Trois empreintes distinctes

| Empreinte | Nature | Preuve |
|---|---|---|
| `2536fe3c…` | C0 officielle, seule référence opposable (`md5(pg_get_functiondef)`) | pré-vol `P79_PRECHECK_PASS c0=2536fe3c…` |
| `578763df…` | C1 réellement générée (`opt1/c1-optimized.sql`) puis mesurée | garde `-C1` de `server-measure/compare_c0_c1.ps1` et contrôle après application |
| `9b3c13d4…` | ancienne tentative de C1, non adoptée | aucune mesure ; **ne doit jamais servir de garde** |

La seule C1 ayant produit des chiffres est `578763df…`. L'empreinte `9b3c13d4…`
reste consignée pour mémoire et n'a **aucun usage opérationnel**.
Référence détaillée : `server-measure/REFERENCE-C0.md`.

## 2. Preuves chiffrées (campagne comparative, 60 invocations)

Gain C1 vs C0, variante C (producteurs actifs), observations brutes regroupées :

| Scénario | Δ médiane | Δ absolu | Δ p95 | Δ absolu p95 |
|---|---:|---:|---:|---:|
| `create_unit` (n=500) | −0,4 % | −0,014 ms | −11,1 % | −0,550 ms |
| `import_bulk` (n=50) | **−1,9 %** | **−14,498 ms** | −0,1 % | −1,148 ms |
| `import_loop` (n=50) | **−2,2 %** | **−19,140 ms** | −3,0 % | −29,799 ms |

Budgets A→C, avec et sans C1 :

| Config | Scénario | Δ médiane | Δ p95 | Médiane | p95 |
|---|---|---:|---:|---|---|
| C0 | `create_unit` | +3,0 % | +4,8 % | PASS | PASS |
| C0 | `import_bulk` | +23,9 % | −35,5 % | **FAIL** | PASS |
| C0 | `import_loop` | +23,9 % | +25,6 % | **FAIL** | **FAIL** |
| C1 | `create_unit` | +10,8 % | +9,3 % | PASS | PASS |
| C1 | `import_bulk` | +27,2 % | +33,8 % | **FAIL** | **FAIL** |
| C1 | `import_loop` | +23,1 % | +28,0 % | **FAIL** | **FAIL** |

## 3. Motifs de l'abandon

1. **Gain inférieur au seuil de démonstrabilité** : −1,9 % / −2,2 % de médiane sur les imports, avec **5 répétitions** dont la variabilité inter-séries dépasse l'écart mesuré (p95 `import_bulk` C0 : 1 363 ms puis 879 ms).
2. **Gain p95 quasi nul** sur `import_bulk` (−0,1 %).
3. **Le dépassement de budget n'est pas corrigé** : A→C reste ~+23 à +27 % de médiane sur les imports, avec ou sans C1.
4. **Coût de maintenance** d'une branche SQL réécrite pour un bénéfice non démontré.

## 4. Équivalence fonctionnelle (rappel)

Vérifiée sur la branche `orders` : 5 commandes, 7 candidats, **3 événements identiques** C0/C1 (journées identiques, `delivered_at` NULL, frontière Casablanca, deux boutiques, déduplication).

**Non couvert** : branches `order_items` et `ad_spend_daily` (inchangées mais non exercées), deuxième fuseau, partitions et agrégats financiers.

## 5. État de la qualification B13

| Dimension | Verdict |
|---|---|
| Performances imports (`import_bulk`, `import_loop`) | **FAIL** (médiane > +15 %) |
| `create_unit` | **PASS** (+3,0 % médiane, +4,8 % p95) |
| Scénarios `update_*` (campagne V2 antérieure) | **FAIL** médiane (+16,8 % / +17,3 %), p95 PASS |
| Deadlocks (campagne V2) | **PASS** — delta 0 |
| Attentes de verrou | **NOT COVERED** — échantillonnage 100 ms, valeurs inexploitables |
| Coût `COMMIT` | **NOT COVERED** — mesure intra-transaction |
| Drainage cron | **NOT COVERED** — `pg_cron` non installé |
| Reproductibilité (volumes, preuves, restauration) | **PASS** |

**B13 reste NO-GO pour une activation.**

### 5.1 Confirmations figées (clôture du 20/10/2026)

1. **Campagne C0/C1 terminée** : 60 invocations (2 × 30), artefacts `c0/` et `c1/` complets, `DONE` écrit, restauration contrôlée.
2. **C1 abandonnée** : non adoptée, non installée ; aucune source C1 active dans le dépôt ni en base.
3. **Gain médian imports** : `import_bulk` **−1,9 %**, `import_loop` **−2,2 %** — sous le seuil de démonstrabilité.
4. **Imports toujours FAIL** : `import_bulk` +23,9 % médiane (p95 PASS), `import_loop` +23,9 % médiane et +25,6 % p95, avec ou sans C1.
5. **`COMMIT`, attentes de verrou précises et drainage cron : NOT COVERED** — mesure intra-transaction, échantillonnage de verrous à 100 ms, `pg_cron` non installé.
6. **B13 revenue à C0 d'après les preuves finales** : empreinte `2536fe3c…` re-contrôlée après restauration, six triggers actifs, zéro résidu.
7. **Seuils inchangés** : `thresholds.json` ne conserve que la correction de son texte d'état, budgets identiques.

## 6. Hypothèse non prouvée

L'écart A→C persistant sur les imports **pourrait** provenir du nombre d'événements d'invalidation produits (une ligne par journée et par boutique) plutôt que du coût de calcul de la branche `orders`. **Cette hypothèse n'est ni mesurée ni validée** : elle n'est consignée ici que comme piste d'investigation future, sans valeur probante.

## 7. Artefacts conservés (non modifiés)

| Dossier | Contenu |
|---|---|
| `JISRA-QA\P79-B13-export\official` | campagne V2 : 60 CSV, `summary.csv`, journaux, observateur de verrous |
| `JISRA-QA\P79-B13-export\perf-c1` | comparaison C0/C1 : `c0/` et `c1/` (30 CSV chacun), `compare.log`, `DONE` |
| `supabase/p79_delivery/b13/server-measure/opt1` | générateur C1, C0/C1 de référence, sonde d'événements, preuves d'équivalence |
| `supabase/p79_delivery/b13/server-measure/REFERENCE-C0.md` | référence C0 et procédure de restauration |

## 8. Harnais de comparaison versionné

`server-measure/compare_c0_c1.ps1` est versionné avec cette clôture : il porte la
garde d'empreintes (`-C0 2536fe3c…`, `-C1 578763df…`), le pré-vol obligatoire, la
détection de campagne interrompue et la restauration garantie en `finally`.

Contrôle de sûreté : **aucun secret, token ou clé** dans le script. Les seules
références sensibles sont des **noms de fichiers** de credentials locaux
(`pg_service.conf`, `pgpass.conf`, via `%APPDATA%`), jamais leur contenu ; `psql`
est appelé avec `-w`, donc aucune invite de mot de passe n'est affichée ni
journalisée. Aucune définition financière, aucun seuil, aucune migration.

## 9. Interdits maintenus

Aucune nouvelle optimisation, aucun nouveau benchmark, aucune écriture Supabase, aucun push/merge/déploiement, aucun changement de seuil, **aucune réactivation de C1**.
