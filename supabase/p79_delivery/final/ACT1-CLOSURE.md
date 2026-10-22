# ACT 1 — Clôture B13 : exception import 600 et attribution des pics p95

**Date :** 21/10/2026. **Verdict B13 maintenu : FAIL.**
Aucune campagne de performance n'a été relancée ; aucune optimisation, aucun
changement de seuil, aucune écriture en Production, TEST ou P7.

## 1. Exception import 600

Documentée séparément dans `EXCEPTION-IMPORT-600.md` — statut **PROPOSÉE, NON
APPROUVÉE**. Seuils inchangés, verdict FAIL inchangé.

## 2. Analyse des journaux bruts (pics `update_item_price`)

Source : 10 journaux de la campagne initiale (5 blocs) et 7 de la validation
ciblée (3 blocs complets + 1 variante interrompue), dépouillés par positions.

| Campagne | Variante | n | > 140 ms | > 250 ms | p95 | max |
|---|---|---|---|---|---|---|
| initiale | A | 500 | 6 | 2 | 93,476 | 631,279 |
| initiale | C | 500 | **26** | **10** | 140,688 | 398,289 |
| ciblée | A | 300 | 4 | 3 | 95,649 | 368,336 |
| ciblée | C | 300 | **19** | **16** | 327,119 | 434,149 |

**Correction d'une conclusion antérieure :** les pics ne se limitent pas à
« 1–2 échantillons ». Ils sont **nombreux dans certaines variantes C** (11, 8,
5, 49 sur 100 selon le bloc de la campagne ciblée) et **présents aussi en A**,
donc non spécifiques aux producteurs KPI.

### Corrélations descriptives (8 blocs appariés)

| Paire | r |
|---|---|
| Δp95 `update_item_price` ↔ Δp95 `update_unrelated` | **0,11** |
| Δp95 `update_item_price` ↔ Δp95 `update_rounding` | **0,50** |

Les sections étant exécutées séquentiellement dans la même variante, ces
corrélations **ne sont pas une attribution** : elles ne distinguent pas un effet
de charge serveur transitoire d'un coût propre au scénario.

### Erreurs de connexion

Une seule anomalie : `server closed the connection unexpectedly` sur la dernière
variante de la campagne ciblée (bloc 4, section `import_items_600`). Elle est
**postérieure** aux blocs où les pics sont documentés et ne les explique pas.

## 3. Investigation serveur ciblée (transaction annulée)

Quatre exécutions de la même sonde, chacune en **une transaction `ROLLBACK`** :
1 boutique, 1 produit, 1 commande, 2 articles (déjà validés lors du test de
restauration) ; `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` sur la même mise
à jour d'article, en alternance C/A.

| Exécution | C | A | A | C |
|---|---|---|---|---|
| 1 | 4,261 | 4,300 | 2,812 | 4,849 |
| 2 | 3,136 | 3,063 | 1,946 | 3,720 |
| 3 | 5,972 | 3,213 | 2,647 | 3,918 |
| 4 | 2,962 | 3,044 | 1,943 | 3,778 |

- Temps d'exécution serveur : **2 à 6 ms**, médiane C ≈ **3,9 ms** contre A ≈
  **2,9 ms**, soit **≈ +1 ms par instruction**.
- Aucun `lock_timeout` (3 s) déclenché ; **aucune attente de verrou observée**.
- Plans : `Buffer Usage` et `WAL` cohérents avec une mise à jour d'une ligne
  (2 enregistrements WAL, 224 octets) ; trigger KPI listé uniquement en C.

**Limites décisives :** la sonde tourne sur des fixtures minimales (journal et
agrégats vides, table de commandes vide), alors que la campagne mesurait sur
~4 100 commandes et un journal alimenté. À cette échelle, le coût propre du
trigger est de l'ordre du milliseconde et **ne peut pas expliquer** les deltas
p95 de +47 à +231 ms. Inversement, la sonde ne reproduit pas ces deltas.

**Observation des attentes serveur : NOT COVERED.** Deux tentatives
d'échantillonnage concurrent (20 ms) n'ont vu **aucune session** du fait du
masquage par le pooler (`application_name` non propagé, 0 session non idle
visible). Aucune conclusion sur les verrous.

**Verdict d'attribution : INCONCLUSIVE.** Ni les triggers KPI, ni
l'infrastructure, ni le réseau/commit ne peuvent être désignés comme cause sur
les preuves disponibles.

## 4. Restauration B13

Empreinte complète avant/après (toutes les tables publiques, fonctions,
propriétaires, ACL, triggers, politiques, RLS, extensions) : **identique**, à
l'exception de `dashboard_kpi_invalidation_seq_seq` (1 997 845 → 1 997 909 ;
avance non transactionnelle des séquences, **aucune ligne** créée).

- 0 boutique, 0 commande, 0 article, 0 événement, 0 état KPI.
- 6/6 producteurs actifs, worker `false`, rollout `true/legacy`.
- C0 `2536fe3c58c8af6b18acb844ac585049` inchangée.
- Aucun objet ni fonction créés ; aucune écriture commitée hors séquences.

## 5. Recommandation de décision

1. **Maintenir le NO-GO** d'activation KPI V5 : le verdict B13 reste FAIL.
2. **Soumettre l'exception import 600** à approbation explicite ; sans
   validation, le dépassement reste non couvert.
3. **Traiter `update_item_price` comme point ouvert non attribué.** Décision
   possible sans nouvelle campagne : accepter le risque sous surveillance
   (canari avec seuil d'alerte) ou exiger une instrumentation serveur dédiée
   hors de ce lot. Aucune des deux ne peut être déclarée PASS sur les preuves
   actuelles.
4. **Ne pas** présenter les pics comme un coût des triggers KPI : la sonde
   montre ~+1 ms par instruction et les pics existent aussi en variante A.
