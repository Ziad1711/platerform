# Action 1 — restauration du socle legacy B13 : BLOQUÉE

## Pré-vol et capture

Cible vérifiée : `biqrgdopcvkrbgfxkzxm`, service `b13-isolated`, base et rôle
`postgres`, PostgreSQL 17.11. C0 : `2536fe3c58c8af6b18acb844ac585049`.
Aucune écriture SQL effectuée pendant cette action.

Capture locale avant/après :
`C:/Users/HP-EXE/AppData/Local/Temp/b13-action1/{baseline,final,preconditions}.json`.
Fonctions et attributs, propriétaires/ACL, politiques, RLS, triggers,
configurations, empreintes des contenus publics et séquences : identiques.
SHA-256 baseline :
`7271892730fb10846e6f12ab29dfe5fcc3faf417e3da581afb435969a4187ee9`.

## Blocage SQL démontré

Les six noms de RPC legacy du frontend sont absents ; dix signatures incluant
les surcharges/prérequis R-BL4 ont été recherchées et sont absentes sur B13.
L'implémentation interne `_rbl4_impl_dashboard_revenue_chart(uuid, ...)` existe
déjà et doit être préservée (ne pas l'écraser en rejouant un historique ancien).

Sources retrouvées pour métriques/revenus/produits :
`20260519_optimize_dashboard_performance.sql`,
`20260520_fix_dashboard_rpc_visibility_compat.sql`,
`20260920_dashboard_conversion_pending_orders.sql`.
Confirmation : section RPC de `20260926170631_confirmation_commission_reactivation.sql`
(ne pas rejouer sa fonction de commission métier).
Horaires : `20260919_rpc_dashboard_order_time_performance.sql`.
Protection : `20261018213537_dashboard_legacy_financial_permissions.sql`, puis
`20261020120300_p79_multistore_chart_restriction.sql`.

Mais R-BL4 commence par renommer, entre autres :

```sql
alter function public.rpc_dashboard_ads_cost_chart(uuid, timestamptz, timestamptz, text)
  rename to _rbl4_impl_dashboard_ads_cost_chart;
alter function public.rpc_dashboard_profit_chart(uuid, timestamptz, timestamptz)
  rename to _rbl4_impl_dashboard_profit_chart;
```

La recherche dans tous les fichiers SQL du candidat ne retrouve aucune définition
historique de ces deux signatures. `20260430_rpc_dashboard_auth_guard.sql`
définit seulement `ads_cost_chart(uuid[], timestamptz, timestamptz)` et
`profit_chart(uuid[], timestamptz, timestamptz)` ; leurs contrats de sortie sont
différents des implémentations attendues par R-BL4.
Les wrappers R-BL4 ne contiennent pas les calculs manquants.

Impossible de certifier une installation complète en conservant les calculs
approuvés. Aucun lot partiel appliqué, aucune formule reconstituée arbitrairement,
aucun R-BL4 isolé, aucun GRANT client introduit.

Prérequis : fournir dans le candidat les définitions approuvées des deux
signatures manquantes (ou un export de leurs implémentations internes avec
signature, corps, attributs et ACL). La sécurité/calculs owner/commercial de la
chaîne complète restent NON VALIDÉS, pas FAIL métier.

## Casablanca — rectification action 2

Le diagnostic de divergence de ce rapport est annulé : l'attendu UTC+1 en
septembre/octobre était périmé. IANA 2026c impose UTC+0 permanent depuis le
20/09/2026. Les quatre conversions B13 correspondent à la référence officielle.
Aucun correctif système B13 ni contournement SQL nécessaire sur cette matrice.
Source : https://data.iana.org/time-zones/tzdb/NEWS (release 2026c), fichier africa.
La version exacte du paquet serveur n'est pas connue. readiness_tzdata reste
false : preuve documentée, aucune mise à jour du drapeau effectuée.

## État et retour

Modifications B13 conservées : aucune. Retour arrière : sans objet ; égalité
avant/après démontrée. Toutes readiness inchangées. Actions 2 et 3 non lancées.