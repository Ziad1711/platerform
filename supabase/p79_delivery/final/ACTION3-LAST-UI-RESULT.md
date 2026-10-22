# Dernière tentative UI — arrêt des tests

## Verdict : FAIL

Test unique réel B13 ; aucun composant ni calcul métier modifié.
Le script de qualification corrige sa normalisation d'espaces : `/\\s+/`
recherchait une séquence littérale, contrairement à `/\s+/` nécessaire pour
normaliser les espaces insécables des montants français. Le délai est désormais
global : 15 secondes depuis la confirmation du COMMIT du kill switch.

- V5 réellement affiché, lecteur HTTP 200, données attendues : PASS.
- DOM legacy observé à **1 822 ms**.
- **134 observations DOM** ; dernière à **14 893 ms**.
- Six cartes trouvées avec leurs vrais titres ; toutes ont encore
  `loading=true`, `value=""`, `visible=false` pour le nœud de valeur.
- Contrôle terminé à **15 005 ms** sans stabilisation.

## Élément React et requête concernés

`components/dashboard/kpi-cards.tsx` : branche `if (isLoading)`, cartes
`.bg-card.rounded-xl` et valeurs remplacées par les squelettes `.animate-pulse`.
En legacy, `isLoading = isStoresLoading || legacyLoading || !rollout.resolved`.
Le maintien de cette branche est observé ; le terme responsable n'a pas été
instrumenté et ne doit pas être affirmé sans preuve.

Requête réelle `POST /rest/v1/rpc/rpc_dashboard_kpi_metrics` : HTTP 200,
payload de la période courante :

```json
{"orders_count":1,"delivered_count":1,"revenue":200,"purchase_cost":80,
 "ad_spend":0,"ad_cost_allocated":0,"delivery_cost":0,"confirmation_cost":0}
```

Réponse de période précédente également HTTP 200 (valeurs nulles d'activité,
composantes numériques à zéro). Revenus/publicité HTTP 200.
Le défaut de ciblage/normalisation précédent n'explique donc pas à lui seul
l'échec : les cartes sont effectivement en chargement malgré des réponses valides.
Aucun pageerror JavaScript. Le mécanisme interne exact reste non attribué.

## Preuves et restauration

`C:/Users/HP-EXE/AppData/Local/Temp/b13-action3-last/` : `RESULT.json`,
`deadline-evidence.json`, `legacy-dom.html`, `legacy-at-verdict.png`, `v5.png`,
`baseline.json`, `final.json`, `server.log`.

Restauration PASS : compte, profil, sessions, boutiques, commandes, articles,
cohorte, agrégats, événements et runs synthétiques supprimés ; toutes définitions,
ACL/politiques/configurations et contenus publics identiques à la capture, hors
séquences. Comptes initiaux préservés ; serveur arrêté, fichiers Next restaurés.
Readiness attestées uniquement pour la fenêtre, revenues à leur état initial.

Aucune nouvelle investigation ou tentative UI après ce résultat. Kill switch
UI complet non qualifié ; le FAIL historique de performance reste inchangé.