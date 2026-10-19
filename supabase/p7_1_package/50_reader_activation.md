# P7.1 / 50 — Activation du lecteur V5 (procédure, aucun code modifié)

## État actuel

Le RPC `rpc_dashboard_kpi_reader(uuid[], date, date, boolean)` est inclus dans
`10_install_objects.sql` et accordé à `authenticated` + `service_role`.
Cela ne l'active pas dans l'interface.

Le frontend reste bloqué par deux verrous dans
`lib/dashboard/kpi-reader-flag.ts` :

1. `KPI_READER_V5` doit valoir exactement `'1'` ;
2. `isProductionSupabase()` renvoie `true` pour `attvfeoqgbxsnnsllatt`, ce qui
   force `kpiReaderV5Source()` à `legacy`.

Aucune modification de ce fichier n'a été faite en P7.1.

## Ce qu'il faudra faire en P7.2 (non exécuté)

1. Remplacer l'interdiction Production absolue par une **autorisation explicite
   et révocable**, par exemple :
   - `KPI_READER_V5=1` ;
   - `KPI_READER_V5_PRODUCTION_ACK=attvfeoqgbxsnnsllatt` ;
   - défaut sûr si l'une des deux variables manque.
2. Ajouter une **cohorte stable** (liste de `store_id`) et un mode
   `legacy | shadow | v5`.
3. Ne jamais mélanger deux contrats dans un total « toutes les boutiques » :
   tant que la sélection n'est pas entièrement éligible, garder le legacy.
4. Conserver la clé de cache par frontière utilisateur/session et le polling de
   révision ; ne pas exposer de clé `service_role` au navigateur.
5. Prévoir un **kill switch** opérationnel : variable d'environnement ou
   configuration lue côté serveur, avec retour legacy sans redéploiement.
   Un simple flag d'environnement exige un redéploiement : le mécanisme doit
   être choisi et testé avant le canary.

## Mode shadow (à implémenter)

Le shadow n'existe pas encore dans le frontend. Pour P7.2 :

- afficher le legacy ;
- appeler V5 en arrière-plan sur un échantillon borné et dédupliqué
  (boutique, période, contrat, révision) ;
- comparer V5 à l'oracle direct du **même contrat** ;
- classer les comparaisons non stabilisées comme « non concluantes » ;
- ne pas doubler toutes les requêtes utilisateur ;
- mesurer le coût réseau et SQL du shadow.

## Critères GO avant affichage V5

- tzdata Production corrigé et vérifié ;
- backfill des périodes exposées terminé, `missing = 0` ;
- rapprochement agrégat ↔ oracle direct = 0 écart ;
- permissions `full` / `commercial` vérifiées par rôle ;
- fraîcheur et budgets mesurés ;
- rollback legacy testé ;
- autorisation humaine explicite.
