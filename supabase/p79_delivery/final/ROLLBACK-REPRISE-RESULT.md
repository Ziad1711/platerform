# KPI V5 — cycle réel rollback / reprise B13

Date : 21/10/2026. Cible unique : `biqrgdopcvkrbgfxkzxm`, service `b13-isolated`.

## Résultat

- Rollback combiné **exécuté et commité** : 12/12 contrôles PASS.
- Après rollback : zéro trigger KPI ; worker/réveil arrêtés ; lecteur legacy.
- Données métier : contenus orders/items/ads strictement identiques avant/après
  rollback, pas seulement les compteurs. Journal, métriques et runs conservés.
- Politiques RLS, ACL de tables et fonctions protégées : identiques. Les objets
  de sécurité présents ont été préservés ; ce test ne prouve pas que tout P8
  est installé sur B13 (trigger P8.4 absent avant/après).
- Réactivation commitée : P7.1 live exact + P7.9 live exact + activation qualité.
  Corps, attributs, propriétaires, ACL et six définitions de triggers identiques.
- Reconstruction réelle après deux mises à jour synthétiques (rounding 0→0,50→0) :
  nouvelles invalidations produites, worker exécuté, backlog final nul.
- Tous les composants des quatre agrégats sont identiques avant/après
  reconstruction, hors métadonnées `computed_at` et `last_event_seq`.
  CA axe commande = 200, achat = 80, livraison = 10, confirmation = 2,
  publicité = 4 ; commande livrée unique, un article de quantité 2.
- Le contrôle brut des lignes après reprise a signalé `orders.updated_at` :
  seul champ différent, expliqué par les deux UPDATE volontaires ci-dessus.
  Aucun montant, statut ou autre champ métier différent. Le premier résultat
  strict et son explication ont été conservés, sans rejouer le cycle.

## Restauration finale

Nettoyage des seuls identifiants synthétiques `…d001/d002/d101/d301` et des
deux runs `act3b`. Restauration exacte des trois lignes de configuration capturées
(worker, wakeup, rollout), en neutralisant leurs seuls triggers de touch pendant
cette restauration, puis en rétablissant leurs états initiaux.

Comparaison finale : tous contenus des tables publiques, définitions et attributs
des fonctions, propriétaires, ACL, politiques, RLS, triggers et configurations
identiques à la capture initiale. Zéro fixture/résidu.

Différences attendues et non rembobinées : séquence invalidation
1 997 959 → 1 997 968 ; séquence worker run 4 → 6.
C0 conservée : `2536fe3c58c8af6b18acb844ac585049`.
Six producteurs actifs ; worker arrêté ; lecteur `kill_switch=true`, `legacy`.

## Corrections techniques locales

- `92_rollback_combined.sql` : cast `polcmd::text` et absence de cron reconnue
  comme absence (pas comme un job restant).
- `20_activate_p79_quality_trigger.sql` : six producteurs attendus, plus le
  trigger de réveil uniquement s'il existe ; aucune modification de trigger.
- Manifeste : seules les deux empreintes correspondantes actualisées ;
  vérificateur statique **220/220 PASS**.

## Preuves

Captures et journaux locaux sans secrets :
`C:/Users/HP-EXE/AppData/Local/Temp/kpi-rollback-final/`.
`baseline.json`, `final.json`, journaux de chaque transaction, `RESULT.json`
(comparaison stricte initiale) et `RESULT-VERIFIED.json` (écart updated_at expliqué).

Verdict de ce cycle : **PASS**. Ce résultat ne valide ni le kill switch UI,
ni les JWT, ni le cron ; B13 performance reste **FAIL**, exception non approuvée.