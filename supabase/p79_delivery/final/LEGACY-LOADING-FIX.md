# Cartes legacy : correction ciblée et validation réelle PASS

## Cause démontrée

`KpiRolloutProvider` exécutait `queryClient.removeQueries` dans son effet de
changement mode/version. Les enfants pouvaient déjà observer la nouvelle requête
`dashboard-kpis` legacy à cet instant. La suppression détachait leur QueryObserver.
Une requête ultérieure remplissait une nouvelle entrée de cache, mais l'observateur
initial restait pending : `legacyLoading=true`, puis skeleton permanent dans
`KpiCards`, malgré les réponses RPC correctes.

Reproduction locale avec les classes QueryClient/QueryObserver réellement
installées : cache revenu=200, observateur isLoading=true et zéro observateur
sur la nouvelle entrée après removeQueries. Avec invalidateQueries : donnée=200,
isLoading=false et un observateur attaché. Contrôles assert exécutés en mémoire,
sans créer un autre fichier de test. Les deux branches (défaut/fix) sont PASS.

## Correction minimale

Seul code modifié dans cette tâche : `lib/dashboard/use-kpi-rollout.tsx`,
removeQueries remplacé par invalidateQueries pour les mêmes préfixes.
Les abonnements restent vivants et les requêtes actives sont relues. Clés,
frontières utilisateur/boutique, mécanisme anti-réponse tardive, calculs et
contrats RPC inchangés. La modification de préfixe déjà présente avant cette
tâche est préservée.

## Une seule validation React B13

- V5 réellement affiché sur cohorte et session synthétiques : PASS.
- DOM legacy après COMMIT du kill switch : **1 859 ms**.
- Six valeurs correctes, visibles et sans skeleton, stables 750 ms : **3 004 ms**.
- Commandes 1, livrées 1, CA 200 MAD, charges 80 MAD, publicité 0 MAD,
  profit partiel 120 MAD.
- RPC métriques/revenus/publicité HTTP 200 après bascule.
- Aucun pageerror JavaScript, aucune donnée de la boutique sentinelle.
- Qualification des cartes et kill switch UI complet : **PASS**, sous 15 secondes.

Nettoyage PASS : comptes/profils/sessions, boutiques/commandes/articles,
cohorte/journal/agrégats/runs et télémétrie synthétiques retirés. Contenus publics,
fonctions, ACL/politiques, triggers et configurations identiques à la capture
initiale, hors séquences. Comptes initiaux préservés ; serveur arrêté et fichiers
générés Next restaurés. Readiness attestées temporairement puis restaurées.

Preuves de cette exécution archivées sous
`C:/Users/HP-EXE/AppData/Local/Temp/b13-action3-fixed/` : RESULT.json, captures DOM
et images, réponses RPC, baseline/final. Le runner avait réutilisé le répertoire
temporaire b13-action3-last ; cette archive est la copie du résultat corrigé.
Le rapport historique ACTION3-LAST-UI-RESULT.md reste le constat du FAIL antérieur.

Vérifications locales : TypeScript sans incrémental PASS ; diff --check PASS.
Les erreurs annexes locales livraison 403/invitations 500 déjà connues ne
bloquent pas les cartes et ne sont pas corrigées dans cette tâche.

Ce PASS UI ne change pas le verdict de performance B13 FAIL ni ne vaut
approbation d'exception ou autorisation de mise en Production.