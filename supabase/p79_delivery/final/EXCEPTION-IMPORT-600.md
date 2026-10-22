# Exception proposée — surcoût médian de `import_orders_600`

**Statut : PROPOSÉE — NON APPROUVÉE.** Ce document ne modifie aucun seuil, ne
change aucun verdict et n'autorise aucune activation.

## 1. Objet

Le seul dépassement **médian** reproductible de la qualification B13 v3 concerne
l'import groupé de 600 commandes (`p79_v3_import_orders(600, 2)`).

| Campagne | Blocs | Médiane A | Médiane C | Δ absolu | Δ relatif |
|---|---|---|---|---|---|
| B13 v3 (initiale) | 5 | 260,462 ms | 300,243 ms | **+39,78 ms** | **+15,27 %** |
| Validation ciblée | 3 | 234,476 ms | 270,686 ms | **+36,21 ms** | **+15,44 %** |

Seuils historiques : **médiane ≤ +15 %**, **p95 ≤ +25 %** (inchangés).
p95 observés : **+24,51 %** puis **+20,95 %** — sous le seuil dans les deux cas.

## 2. Exception demandée

Autoriser le **seul** dépassement médian de `import_orders_600`, à hauteur de
**+0,44 pt** au-delà du seuil, avec les limites suivantes :

1. Portée **strictement limitée** à cette section et à la variante `C`
   (six producteurs KPI actifs).
2. Coût **connu et documenté** : environ **+36 à +40 ms par instruction
   d'import de 600 commandes**, mesuré sur B13 (PostgreSQL 17.11, accès pooler).
3. **Aucune** modification des seuils `median_overcost_pct_max` (15) ni
   `p95_overcost_pct_max` (25).
4. **Aucun** reclassement de B13 en PASS : le verdict historique **FAIL** est
   maintenu, y compris pour ce dépassement.
5. **Aucune** extrapolation au temps total d'un import applicatif réel
   (le coût mesuré porte sur une instruction d'insertion ensembliste de 600
   lignes, hors lecture/validation applicative).
6. **Non applicable** aux pics p95 de `update_item_price`, qui restent un
   point ouvert distinct.
7. Conditionnée à la validation préalable de l'exactitude financière, des
   permissions et de l'exploitation (worker, kill switch, rollback).

## 3. Justification factuelle

- Répétabilité : deux campagnes indépendantes donnent **+15,27 %** et
  **+15,44 %**, avec un delta absolu stable (**+39,78 / +36,21 ms**).
- Distribution par bloc : 3 blocs sur 8 au-dessus de 15 % (maximum +22,23 %),
  les autres entre +4,76 % et +14,19 %.
- p95 conformes dans les deux campagnes.
- Aucun deadlock, aucune erreur, volumes exacts (20 100 commandes /
  32 200 articles par variante).

## 4. Ce que cette exception ne prouve pas

- Elle ne démontre pas que le coût est acceptable en production réelle.
- Elle ne couvre pas les imports de taille supérieure ou les imports répétés
  en rafale.
- Elle ne remplace pas une mesure en Production ni un test de charge applicatif.
- Elle ne préjuge pas du sort des pics `update_item_price`.

## 5. Décision requise

Validation explicite par le responsable produit/technique, avec mention de la
date, du périmètre et du maintien du verdict FAIL. Sans cette validation,
l'import 600 reste un **dépassement non couvert**.
