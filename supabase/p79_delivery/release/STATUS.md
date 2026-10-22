# Statut final et réserves — priorité sur les conclusions historiques

- Calculs : PASS dans les scénarios réellement qualifiés, pas une preuve
  exhaustive de toutes règles financières ou chemins d'erreur.
- Permissions JWT : PASS owner/commercial/isolation/révocation sur fixtures B13.
- Legacy : dix signatures PASS, socle conservé sur B13 seulement.
- Rollback/reprise : PASS réel B13, restauration exacte ; installation initiale
  complète du paquet en ordre Production : NOT COVERED.
- Worker automatique pg_cron : PASS, 3 observations 2028/763/768 ms, backlog nul.
  p95 statistiquement robuste NOT COVERED ; réveil HTTP non qualifié.
- React V5 et kill switch complet : PASS après correction removeQueries vers
  invalidateQueries ; DOM 1859 ms, cartes correctes stables 3004 ms.
  Les anciens FAIL UI sont historiques, pas la conclusion actuelle.
- Casablanca : référence corrigée IANA 2026c (UTC+0 dès 20/09/2026), B13 conforme.
  Ancien PASS Production fondé sur UTC+1 retiré ; aucun nouveau contrôle cible.
- Performance historique : FAIL. Import 600 +39,78/+36,21 ms, médiane
  +15,27/+15,44 %, exception proposée non approuvée. update_item_price p95
  +50,51/+242 %, risque non accepté et attribution inconnue. Aucun correctif
  de trigger justifié. Pas de fusion des campagnes 5 et 3 blocs complets.
- Sécurité : remplacement/révocation de la clé administrative B13 exposée non
  confirmé par cette tâche ; aucune clé copiée au candidat de livraison.
- Arbre Git : candidat non commité, preuves et livrables non suivis ; aucune
  publication autorisée. Le manifeste machine fige la sélection, pas un GO.

**NO-GO activation Production maintenu.** Les réserves de première installation,
de reprise Production (gardes historiques), de socle P8 et de calendrier cible
ne sont pas levées par des contrôles statiques. Ne pas les convertir en PASS.

## Préflight Production réel (lecture seule, 22/10/2026)

PostgreSQL **17.6**, 264 migrations, dernière `20261014212643`.
Objets KPI : 0 fonction, 0 table, rollout ABSENT → socle KPI vierge (précondition
d'installation satisfaite). Dépendances présentes : `can_view_store_finances`,
`order_purchase_cost`, schéma `vault`. R-BL4 absent (`dashboard_legacy_access`
et `_rbl4_impl_*` inexistants) alors que les six RPC legacy historiques existent.

Deux écarts bloquants constatés sur la cible, sans aucune écriture :

1. **P8 absent** : aucune migration `p8[1-4]_` appliquée. La précondition P8.3
   (41 politiques d'écriture + 21 de lecture capturées sur TEST) n'est pas
   démontrée : la cible contient 136 politiques d'écriture et 83 de lecture,
   inventaire différent. M2/M3 recréent 62 politiques par nom : sans vérification
   préalable, elles seraient **créées** au lieu d'être corrigées — état non
   reproductible. Condition d'arrêt maintenue.
2. **Timezone pré-2026c** : `2026-09-20 01:00Z` → `02:00` et
   `2026-10-21 23:30Z` → `00:30` le lendemain, soit UTC+1. La Production n'a donc
   pas les règles IANA 2026c (UTC+0 dès le 20/09/2026). `readiness_tzdata` ne peut
   pas être attesté sur cette cible en l'état ; aucune maintenance effectuée.

## Garde de reprise `30_activate_invalidations`

Le garde compte les lignes `dashboard_kpi%` plus `rpc_dashboard_kpi_reader` et
exige **exactement 23**. Mesure sur les sources livrées : 22 fonctions
`dashboard_kpi*` + 1 lecteur = 23 à l'étape P7.1 → compatible à sa place
d'origine. Après P7.9, l'installation ajoute 2 fonctions
(`dashboard_kpi_finalize_store_state`, `dashboard_kpi_invalidate_orders_quality_trg`),
soit **25** → garde en échec. Après le rollback 92, la fonction qualité est
supprimée mais la finalisation reste : **24** → garde encore en échec.

Conséquence : la reprise ne peut pas rejouer ce lot tel quel sur un socle final.
Il faut soit recréer les producteurs depuis les définitions live vérifiées, soit
faire approuver une mise à jour explicite du garde. Aucune modification du garde
ni du décompte n'a été faite ici.
