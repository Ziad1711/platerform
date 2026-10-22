# KPI V5 — candidat Release local, aucune autorisation de déploiement

## Décision

**Préparation statique uniquement ; activation Production NO-GO.**
Import 600 : exception proposée, non signée. p95 update_item_price : risque
non accepté. Installation initiale complète depuis zéro : NOT COVERED ; le
rollback/reprise B13 PASS ne remplace pas cette preuve. Rotation de la clé B13
exposée : non confirmée. Aucun de ces points n'est implicitement accepté.

`release-manifest.json` est la liste de sélection autoritative du candidat.
Les empreintes sont normalisées LF. Le HEAD indiqué est la base, pas un commit
contenant les changements : aucun commit n'a été créé. Le worktree complet
**ne doit pas** être publié tel quel.

## Séparation des périmètres

- Application : cinq fichiers corrigés de cartes/graphiques/mappers/rollout,
  dont invalidateQueries conservant les QueryObserver après retour legacy.
- Les fichiers marqués `git-head` sont les versions normales du HEAD de base,
  **pas** les versions de qualification du worktree. Cela exclut du patch Release
  les branches B13 de client/server/middleware/flag/next.config et .gitignore.
- SQL : liste inactive ordonnée héritée du manifeste du paquet ; activations
  classées séparément, jamais appliquées par la livraison inactive.
- Hors livraison : `lib/qualification/`, `scripts/qualify-b13.cjs`, B13 b13_v3,
  fixtures, captures d'utilisateurs, exports de référence Production et
  `REINSTALL-*` C0. `final/legacy-b13/INSTALL.sql` n'est pas un lot Production.
- Preuves : archives locales sous `release/evidence/`, à conserver hors du
  bundle applicatif/SQL. Les rapports datés restent historiques ; `STATUS.md`
  établit leur statut final et les réserves, sans effacer les échecs antérieurs.

## Étape 1 — livraison inactive future, autorisation séparée obligatoire

1. Après décisions signées : produire un commit propre à partir de la sélection
   (pas `git add .`), figer ses SHA-256 et vérifier que la preview utilise seulement
   B13. Preview sans clé d'administration dans le navigateur, sans écriture
   d'environnement Production. Le runner B13 reste un outil local distinct.
2. Préflight cible Production **en lecture seule**, sous une autorisation future :
   identité exacte, état/migrations actuels, signatures legacy nécessaires à
   R-BL4, politiques P8.3 attendues, timezone selon IANA 2026c, backup/restauration
   convenus. Les relevés historiques ne sont pas un préflight actuel.
3. Si préconditions satisfaites : appliquer uniquement `inactive_sql`, dans
   l'ordre du manifeste, une transaction par lot, ON_ERROR_STOP. Aucun db push,
   aucun rejeu automatique de l'historique, aucun lot déjà installé réappliqué.
   Le manifeste ne constitue pas la preuve que ces lots sont tous nécessaires
   sur la Production actuelle : leur applicabilité reste une condition d'arrêt.
4. Vérifications de chaque étape aux stages correspondants : les empreintes
   P7.1 initiales se vérifient **avant** les corrections P7.7/P7.8/P7.9, pas après.
   La capture 93 utilise une table temporaire, donc une transaction unique est
   requise même pour cette capture. Un affichage FAIL doit bloquer le déploiement.
5. État final inactif : aucun producteur ni job KPI ajouté ; worker/réveil false,
   kill_switch true, requested_mode legacy, zéro cohorte ; KPI_READER_V5 absent/0,
   ACK Production absent. Aucune création d'extension pendant cette étape.

Promotion : promouvoir le **même artefact applicatif immuable** après validation
de preview ; vérifier séparément la configuration cible, ne pas reconstruire un
artefact différent ni transférer les variables B13. Le verrou Production doit
rester fermé tant que l'activation n'est pas autorisée.

## Étape 2 — activation ultérieure, hors de cette mission

Autorisation distincte après levée des réserves : prérequis extensions/jobs
explicitement autorisés, producteurs, qualité, backfill borné, couverture,
readiness justifiées par les preuves de la **cible**, puis cohorte et lecteur.
Le PASS IANA B13 n'atteste pas la Production ; aucune readiness copiée de B13.
Le cron SQL est le mécanisme automatique qualifié. Réveil HTTP/pg_net facultatif
non qualifié : ne pas l'activer implicitement. Le lot 20 actuel installe les deux
extensions : son emploi exige une décision de périmètre explicite.

## Retour et reprise

Retour rapide : kill switch true / mode legacy (mesure B13 3,004 s) ; puis, si
nécessaire et autorisé, rollback combiné 92. Tables, journal, agrégats et P8
conservés. Jamais de rollback P8 réouvrant des droits.

Reprise : worker arrêté, lecteur legacy ; restaurer le producteur qualité depuis
la **source de livraison** `REINSTALL-QUALITY-RELEASE.sql`, pas l'export C0 B13.
Recréer les producteurs P7.1 depuis `30_activate_invalidations.sql` seulement
si ses gardes correspondent à l'état installé ; le garde historique compte
exactement 23 fonctions alors qu'un système final peut en avoir davantage.
Ce point de compatibilité de reprise Production reste **bloquant** jusqu'à
vérification sur le socle cible ou dérogation explicite, sans contourner la garde.
Puis qualité, worker, reconstruction avant toute réactivation du lecteur.

## Conditions d'arrêt

Identité incertaine, différences non expliquées, préconditions R-BL4/P8 absentes,
capture/restauration insuffisante, permission rouverte, échec de contrôle, clé
exposée non traitée ou exception performance non acceptée : aucune activation.
Cette préparation n'autorise aucune écriture ou publication.