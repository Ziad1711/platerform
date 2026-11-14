# Runbook de déploiement — INHIBÉ / NO-GO

Ne lancer AUCUNE commande Production ci-dessous avant levée des blocages de FINAL-QUALIFICATION.md et autorisation explicite. Ce document prépare la procédure ; il n'autorise rien et ne constitue pas une qualification achevée.

## 0. Conditions GO et points d'arrêt
GO uniquement si : absence de régression lint (qualifiée le 14/11), import applicatif YouCan réel et quatre webhooks HTTP avec reprise autonome qualifiés, ancien build complet sur les 22 migrations qualifié, crédits/usage comparés, URL/clefs Q3 effectives attestées, inscriptions fermées, sauvegarde fraîche restaurable et protection post-sauvegarde démontrée. Chaque échec = STOP, sans promotion, sans down migration, sans rejouer 52 événements historiques.
Le SHA immuable est le tag local `jisra-final-candidate-20261113` ; vérifier `git rev-parse jisra-final-candidate-20261113^{commit}`. La preuve est attachée au commit, pas à une branche mutable.
Cible : projet Vercel platerform `prj_h26koUauo1YWLE1a4dPs9LAiUr5l`, domaine jisra.io ; Q3 Contabo, pas Q4 : hostname réseau doit être attesté par l'opérateur car URL Vercel non relisible. Ancien déploiement `dpl_3F3xjas4aq2WXS3LPgDfze17Pmc9`, SHA aace84a5e90b1f4516e27801e250af5071001f6e.

## 1. Préparer les artefacts locaux (sans production)
Dans le worktree de release :
```bash
git status --short
git rev-parse HEAD
git merge-base --is-ancestor afc921aa593722224d85c817bdc60df72a422b54 HEAD
git diff --check
node -e 'const fs=require("fs"),c=require("crypto"),m=require("./docs/release/final-migrations.json");if(m.count!==22)throw Error("count");for(const x of m.migrations)if(c.createHash("sha256").update(fs.readFileSync(x.path)).digest("hex")!==x.sha256)throw Error(x.path)'
```
Un arbre sale, SHA divergent ou checksum divergent = STOP. Ne pas inclure les modifications du worktree utilisateur, fichiers env, secrets, node_modules ou fichiers générés.
Créer un export signé/contrôlé du tag et transférer les seuls SQL du manifeste ; utiliser des fichiers UTF-8, pas un terminal Windows transcodant le SQL. Vérifier SHA256 à réception.

## 2. T0 après autorisation : état et sauvegarde
- Confirmer domaine/déploiement précédents avec `vercel inspect jisra.io`; contrôler méta gitCommitSha via API GET.
- Capturer comptages ET empreintes par PK des tables métiers, abonnements, quotas/usage IA, Auth et Storage ; enregistrer inventaire migrations réellement installées et ACL/RLS. Ne pas afficher données/secrets dans les logs.
- Contrôler espace disque, santé, files d'événements, transactions longues, index/contraintes et locks. Noeud isolé sain exigé pour la répétition finale.
- Exécuter, seulement après autorisation, `/root/q3/scripts/backup-q3.sh`. Exiger MANIFEST PASS, SHA256SUMS valides, copie chiffrée hors hôte et clé séparée ; script contacte le stockage distant, pas autorisé durant la présente mission.
- Inclure configurations Compose/Auth/Storage/chiffrement et dépendances Auth, rôles et migrations. Quarantaine documentée : conserver les archives et clés aux emplacements distincts, pas de nettoyage des sessions Q3. Restaurer une copie en appliquant uniquement la quarantaine inventoriée 23/23/23 et les FK, jamais disable triggers/constraints.
- STOP si sauvegarde incomplète ou restaurabilité non démontrée. Aucun PITR annoncé sans preuve archive_mode/archive_command/WAL restaurables.

## 3. Protection des écritures et événements
Ne PAS activer JISRA_MAINTENANCE_MODE global : il bloque trois fournisseurs. Laisser les webhooks en ligne durant les migrations additives.
Avant T0, qualifier un ingress durable pour les quatre fournisseurs : conserver body brut, identité/signature, clé idempotente, horodatage, ack seulement après stockage durable ; worker/reprise autonome et métriques oldest pending, erreurs, attempts. Tester coupure avant/après commit, timeout DDL, bascule ancien/nouveau build. 2xx sans journal durable = STOP. Le code actuel ne fournit PAS cette preuve.
Ne pas dépendre du retry fournisseur. Ne rejouer que les événements nouvellement admis dans la fenêtre, filtrés par inventaire/ID de mission ; exclure explicitement les 52 erreurs historiques.
Pour toutes les écritures directes Supabase et fichiers après backup, démontrer journalisation incrémentale et versionnage fichiers hors du périmètre de panne ; à défaut STOP pour toute exigence RPO=0. Le rollback applicatif seul, sans restauration DB, conserve ces écritures.

## 4. Migrations SQL ordonnées
Le manifeste JSON définit les 22 fichiers, leur ordre et SHA256. Le prérequis `20261109_youcan_order_claims.sql` est déjà dans la base Production aace84a ; vérifier table et signatures RPC, NE PAS le rejouer.
Comparer le registre effectif et la définition des objets au manifeste. Ne pas lancer `supabase db push` global : fichiers anciens et identifiants irréguliers existent. Préparer une liste revue des SEULES migrations manquantes. Une migration déjà présente avec checksum différent = STOP, pas `IF NOT EXISTS` pour masquer.
Session d'administration vérifiée : supabase_admin. Vérifier btree_gist ; s'il manque, installer `create extension btree_gist with schema extensions;` après autorisation, puis revérifier propriétaire/namespace.
Sur le serveur, pour CHAQUE fichier manquant validé, dans l'ordre :
```bash
set -euo pipefail
file=/chemin/valide/du/fichier.sql
sha256sum "$file" # comparer au manifeste, arrêt si différent
PGOPTIONS='-c lock_timeout=5s -c statement_timeout=120s'   docker exec -i -e PGOPTIONS='-c lock_timeout=5s -c statement_timeout=120s'   supabase-db psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$file"
```
Les SQL contiennent leurs transactions : pas de transaction englobante additionnelle. Ne passer au suivant qu'après commit confirmé, empreintes des objets/ACL et enregistrement atomique de version/checksum dans le registre autoritatif validé pour Q3. Le registre et son format d'enregistrement restent à fixer avant GO : ne pas inventer une ligne d'historique Supabase ni lancer de script aveugle. Si commit incertain, inspecter l'état avant toute réexécution. Lock timeout = arrêt, jamais attente illimitée ni maintenance globale.
Vérifier après chaque lot : tables RLS, SECURITY DEFINER supabase_admin, droits service_role seulement sur commit YouCan, anon/authenticated interdits, search_path fixé, contraintes valides. Comparer données métier au baseline en tenant compte exclusivement des écritures légitimes post-T0.

## 5. Configuration et build Vercel
Après autorisation de changement Production : vérifier URL Q3 réelle (ni localhost, ni :8443 Q4, ni Cloud) et correspondance anon/service/JWT via contrat interne sûr ; ne jamais déclarer secret invalide parce que non relisible.
`JISRA_QUALIFICATION` et `JISRA_Q4_RUNNER` absents ; `PUBLIC_AI_ENABLED=disabled`, `GA4_EXTERNAL_CALLS=disabled`, `NEXT_PUBLIC_GA_MEASUREMENT_ID` vide pour zéro appel GA4 navigateur ; banque `billing_bank_settings.enabled=false`. Inscriptions fermées côté Auth, vérifier le refus de signup isolé ; ne pas modifier sessions/MFA ou désactiver ERP/assistant ERP existants.
Conserver variables ERP et clés existantes ; ne pas utiliser env local/Q4. Rebuild nécessaire pour NEXT_PUBLIC_*. Le build local de qualification utilise une URL invalide de test et NE DOIT JAMAIS être promu.
Obtenir l'autorisation distincte pour créer/promotion du déploiement Production. Préparer build avec environnement Production vérifié via workflow Vercel autorisé, sans copier les secrets dans Git ; inspecter SHA des métadonnées avant promotion. Commandes de promotion, après approbation :
```bash
vercel promote URL_DU_DEPLOIEMENT_CANDIDAT_VERIFIE
vercel inspect jisra.io
```
`URL_DU_DEPLOIEMENT_CANDIDAT_VERIFIE` n'existe pas encore : STOP tant qu'un déploiement autorisé n'est pas construit et qualifié ; aucune URL fictive n'est exécutable.
Aucun push GitHub implicite ; si publication Git requise, demander autorisation distincte, vérifier status, n'ajouter que release puis pousser le SHA convenu, jamais les modifications locales hors release.

## 6. Vérification post-promotion et surveillance
Comptes de test autorisés : login/MFA, boutiques historiques et rôles, ERP/stock/commandes/abonnements/crédits IA, assistant ERP en stub sans fournisseur, administration/permissions. Webhooks synthétiques signés pour les quatre intégrations sans services fournisseurs ; vérifier 1 événement/1 effet, reservations/mappings/items, file drainée et zéro événement perdu. Supprimer uniquement fixtures précisément inventoriées.
Vérifier inscriptions/paiements publics/IA publique/GA4 fermés. Contrôler logs sans secrets : HTTP5xx, latences, locks, pending age, retries internes, doublons, commandes/items, erreurs Auth/Storage, quotas. Exiger une fenêtre d'observation définie et mesurée ; toute divergence data/droits ou événement non durable = retour applicatif immédiat.

## 7. Rollback non destructif
Après décision opérateur :
```bash
vercel rollback https://platerform-dto87yc7s-ziadzerouala11-8743s-projects.vercel.app
vercel inspect jisra.io
```
Syntaxe CLI 64.3.1 vérifiée avec rollback --help ; vérifier le projet avant exécution. Garder les 22 migrations et les anciennes RPC ; ne supprimer ni commandes, ni réservations, ni mapping, ni fichiers post-T0. Garder l'inbox et les workers compatibles pendant le retour, vérifier idempotence entre les deux versions et reprendre les événements uniquement après confirmation du schéma final. Pas de down migration, pas de restore ancien dump sur la base active.
Le rollback runtime sur schéma final a été exécuté le 14/11 : Auth/MFA, ERP, crédits, assistant simulé, commandes et rétention PASS. Toutefois aace84a reproduit un faux succès Digylog sous erreur SQL : retour vers cet artefact INTERDIT comme rollback sûr tant qu’un ingress durable indépendant ou une cible de secours corrigée n’est pas qualifié.
Si corruption physique : isoler la cible atteinte, restaurer sur NOUVEL environnement, reprendre journal incrémental/versions fichiers prouvés, réconcilier jusqu'au dernier événement puis décider de la bascule. Sans cette preuve, pas de garantie de conservation des données post-backup, STOP et décision métier explicite.

## Autorisations restantes
Seules les actions Production (Q3, variables/inscriptions, sauvegarde fraîche et stockage distant, création/promotion/rollback Vercel), push GitHub et éventuelle décision RPO nécessitent autorisation. Les qualifications isolées restantes n'en nécessitent pas ; elles demeurent techniquement inachevées dans ce dossier.


## Addendum de clôture du 14/11 — points d'arrêt confirmés
- Branche locale contient le correctif Digylog démontré ; sélectionner le NOUVEAU SHA de clôture (voir `git log -1` et rapport final), pas seulement le tag précédent 5f3a29a. Aucun nouveau SQL : 22 empreintes inchangées.
- Lint : zéro régression par rapport à aace84a sur 114 fichiers ; ne pas exiger la correction des 851 erreurs historiques indépendantes.
- Q3/Vercel : origine supabase.jisra.io, signature anon et inscriptions fermées confirmées en lecture seule. Désactiver NEXT_PUBLIC_GA_MEASUREMENT_ID avant build Production autorisé ; conserver les variables ERP et vérifier service_role via contrat interne sûr, sans supplier calls.
- Continuité interrompue réellement reproduite : événement YouCan durable pending mais pas repris après restart. Ajouter/qualifier une inbox/reprise autonome pour les quatre AVANT autorisation de promotion. Aucune commande de déploiement ne compense cette absence.
- Ancien aace84a n’est PAS une cible de rollback certifiée à cause du faux ACK Digylog. Préparer une cible de secours corrigée ou conserver un traitement webhook durable indépendant ; tester la bascule avant GO.
- Storage post-backup conservé après bascule/restart avec hash identique. Ce PASS ne couvre pas un sinistre disque. Q3 WAL non archivé ; script rollback-capture-replay actuel utilise session_replication_role=replica : NE PAS l’exécuter, même en dry-run, selon les règles de cette mission. Reprise sans contournement des contraintes et protection hors domaine de panne encore à qualifier.
- PRODUCTION_GO reste NO. Ne pas exécuter les commandes de promotion/rollback ci-dessus tant que ces arrêts ne sont pas levés. Aucun besoin d'autorisation pour poursuivre les corrections/tests isolés ; les actions Production restent soumises à accord explicite.


## PROCÉDURE FINALE CIBLÉE (remplace les étapes incompatibles ci-dessus)

**État : prêt pour autorisations/contrôles T0, pas de GO inconditionnel.** Le dernier commit de release et le manifeste à **23 fichiers** font foi ; les 22 premières empreintes restent identiques. Secours corrigé : `ff3943bcd8f666fdbe9b92c35b693e287fb6c450`. Ne pas utiliser le tag initial ou aace84a brut comme cible de retour.

### A. Avant toute fenêtre — autorisation Production obligatoire
1. Confirmer SHA final, Q3 supabase.jisra.io, projet platerform et domaine jisra.io. Vérifier git propre, checksums des 23 fichiers. Construire les DEUX artefacts Vercel avec environnement Production réel vérifié, sans les promouvoir. Les builds isolés ne sont pas promouvables (URL loopback incorporée).
2. Préparer flags `PUBLIC_AI_ENABLED=disabled`, `GA4_EXTERNAL_CALLS=disabled`, `billing_bank_settings.enabled=false` et Auth DISABLE_SIGNUP=true ; GA4 navigateur vide si zéro collecte requis. Ne toucher ni assistant ERP privé ni intégrations existantes. Vérifier le service_role interne et les secrets sans les imprimer.
3. Préparer timer hôte indépendant de Vercel pour le worker, certificat public de checkpoint et emplacement chiffré hors hôte. Retenir un RPO explicitement accepté (proposition : une heure en régime normal ; cinq minutes pendant fenêtre seulement si test capacité et transfert le permettent). Sans accord RPO, ne pas promettre récupération de toutes les écritures après le dernier checkpoint : STOP.
4. Installer le worker, sans encore activer son timer, après autorisation : fichier `/root/q3/secrets/webhook-recovery.curl` mode0600 contenant `header = "Authorization: Bearer SECRET_CRON_EXISTANT"` (renseigner sans shell history). Variables : `JISRA_RECOVERY_URL=https://jisra.io/api/cron/webhook-recovery`, `JISRA_RECOVERY_AUTH_FILE=/root/q3/secrets/webhook-recovery.curl`. La commande est `bash /chemin/release/scripts/webhook-recovery-worker.sh`. Un service systemd Type=oneshot + timer OnBootSec=30s/OnUnitActiveSec=30s doit utiliser ces variables ; journalctl doit montrer traitement ou pause, jamais corps/secrets. Activer seulement quand endpoint disponible. Pas de garantie de cron Vercel minute selon plan.

### B. Maintenance courte — séquence sûre, pas gel global DB
1. Fermer temporairement les actions humaines (prévenir les rares clients et confirmer absence d'activité directe Supabase). Le middleware n'est pas une barrière pour supabase-js direct : ne pas l'assimiler à un verrou DB. Garder les webhooks disponibles. Éviter les DDL sur orders pendant le bootstrap, lock_timeout5s et arrêt sur erreur.
2. **Bootstrap sans inbox dans l'ancien build :** l'ancien code traite encore les événements pendant les migrations additives. Capturer à T0 les IDs et compteurs des journaux fournisseurs puis surveiller 5xx/événements. Si incident de réception avant activation de l'inbox, la nouvelle release ne peut pas récupérer un payload jamais enregistré : STOP, conserver ancien déploiement, réconcilier la fenêtre. Une maintenance globale qui renvoie503 aux fournisseurs n'est PAS autorisée comme stratégie sans capture. Si zéro perte même en panne durant ce bootstrap est exigée, installer d'abord un ingress durable indépendant et le qualifier ; cette garantie n'est pas revendiquée ici.
3. Exécuter la sauvegarde fraîche autorisée (`/root/q3/scripts/backup-q3.sh`), télécharger ciphertext/manifeste depuis stockage distant, comparer les VRAIS SHA256 (le size-only du script seul n'est pas suffisant), restaurer sur isolation selon procédure Auth/quarantaine existante et vérifier Storage. Ne pas modifier/supprimer les sessions Q3 orphelines. STOP si pas de manifeste PASS ou restauration opérationnelle.
4. Appliquer SEULEMENT les migrations manquantes du manifeste (22 qualifiées + inbox23), supabase_admin, psql -X ON_ERROR_STOP=1, lock_timeout5s, statement_timeout120s, fichiers UTF8 exacts. Chaque transaction doit confirmer son COMMIT avant la suivante. Ne pas rejouer les anciennes migrations/prérequis claim. Contrôler btree_gist avant les prix versionnés et RLS/ACL après inbox. Pas de down migration.
5. Promouvoir le **secours corrigé** en maintenance applicative JISRA_MAINTENANCE_MODE=1 : il reçoit les quatre webhooks en202 durable, worker paused ; journaux entrants doivent être réconciliés. Puis promouvoir candidat final avec les mêmes paramètres. Si le secours n'a pas d'artefact vérifié ou les routes n'acceptent pas les quatre événements, STOP.
6. Vérifier HTTP202 et présence inbox avant toute réouverture ; tester une signature invalide =>401 sans inbox. Lancer worker manuellement en maintenance =>paused, puis passer maintenance=0 et activer le timer. Vérifier pending=0, failed=0 et effet métier exact. Une erreur reste en file et bloque seulement son intégration ; ne supprimer aucune ligne pour obtenir un compteur vert.

### C. Checkpoints et écritures ultérieures
`release-checkpoint.sh` accepte uniquement des cibles explicites : DB container/name, Storage container/path réel, dossier NEUF, certificat PUBLIC. Le script chiffre dump complet+rôles+fichiers, aucun appel externe. Exemple Q3 après autorisation :
```bash
CHECKPOINT_DB_CONTAINER=supabase-db CHECKPOINT_DB_NAME=postgres \
CHECKPOINT_STORAGE_CONTAINER=supabase-storage CHECKPOINT_STORAGE_PATH=/var/lib/storage \
CHECKPOINT_DIR=/root/q3-backups/release-$(date +%Y%m%d-%H%M%S) \
CHECKPOINT_CERT=/chemin/certificat-public-checkpoint.pem \
bash /chemin/release/scripts/release-checkpoint.sh
```
Faire le checkpoint post-migration avant réouverture, vérifier checksum et copier les fichiers CMS vers stockage chiffré hors hôte approuvé. Conserver clé de déchiffrement séparée ; inclure Compose/Auth/Storage/configurations cryptées dans la sauvegarde opérationnelle existante. Les snapshots fichiers/DB sont séquentiels : sous activité concurrente, réconcilier metadata et versions réelles, ne pas prétendre snapshot atomique. Checkpoint+restore ciblé isolé exécuté avec succès sur nouvelles commandes/inbox ; Auth/Storage opérationnels précédents réutilisés. Arrêter la réouverture si le checkpoint postmigration n'est pas restaurable.
Planifier backups horaires (timer existant) et contrôler chaque échec + dernière copie hors hôte ; durant déploiement, intervalle réduit uniquement après contrôle charge. **Ce n'est pas du PITR**. Pour récupérer les écritures récentes : choisir le dernier checkpoint COMPLET hors hôte postérieur à la sauvegarde initiale, restaurer DB/Auth/Storage/config sur NOUVELLE cible puis drainer l'inbox non traitée ; ne jamais écraser Q3 active. Entre deux checkpoints, perte possible en sinistre physique selon RPO accepté. Si aucune perte acceptable => STOP et qualification WAL/replication hors domaine de panne distincte. Ne pas exécuter l'ancien replay qui met session_replication_role=replica.

### D. Retour applicatif et surveillance
Promouvoir uniquement l'artefact construit depuis **ff3943bcd8f666fdbe9b92c35b693e287fb6c450**, jamais aace84a brut. Garder les 23 migrations, l'inbox, le même CRON_SECRET, le timer et le Storage. Si maintenance=1, réception202 continue et worker pause ; après reprise, vérifier l'ancienneté pending et les effets une fois. Aucun dump restauré pour un rollback applicatif : toutes écritures/fichiers restent.
Surveiller pendant au moins15 minutes : HTTP5xx, pending oldest age, attempts et last_error, cron toutes30s, compteurs commande/articles/mappings/claims, boutiques historiques, Auth/MFA, abonnement/crédits, flags publics fermés. Pending>5min ou failed répété => stop nouvelles promotions, diagnostic et alerte ; ne jamais purger les événements.

### E. Arrêts définitifs avant exécution
Autorisations nécessaires : migrations Q3 et backup frais/transfert hors hôte, installation timer, paramètres Vercel/banque, création des artefacts Production candidat+secours et promotions ; push GitHub séparé si requis. Décision RPO explicite. Tous les tests isolés ci-dessus sont déjà autorisés et exécutés, aucune demande intermédiaire. PRODUCTION_GO reste NO tant que les contrôles/conditions Production ne sont pas remplis.
