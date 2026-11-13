# Runbook de déploiement — INHIBÉ / NO-GO

Ne lancer AUCUNE commande Production ci-dessous avant levée des blocages de FINAL-QUALIFICATION.md et autorisation explicite. Ce document prépare la procédure ; il n'autorise rien et ne constitue pas une qualification achevée.

## 0. Conditions GO et points d'arrêt
GO uniquement si : lint accepté/corrigé, import applicatif YouCan réel et quatre webhooks HTTP avec reprise autonome qualifiés, ancien build complet sur les 22 migrations qualifié, crédits/usage comparés, URL/clefs Q3 effectives attestées, inscriptions fermées, sauvegarde fraîche restaurable et protection post-sauvegarde démontrée. Chaque échec = STOP, sans promotion, sans down migration, sans rejouer 52 événements historiques.
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
Le rollback complet sur schéma final doit encore être testé avant GO ; la qualification existante sur 21 migrations ne suffit pas.
Si corruption physique : isoler la cible atteinte, restaurer sur NOUVEL environnement, reprendre journal incrémental/versions fichiers prouvés, réconcilier jusqu'au dernier événement puis décider de la bascule. Sans cette preuve, pas de garantie de conservation des données post-backup, STOP et décision métier explicite.

## Autorisations restantes
Seules les actions Production (Q3, variables/inscriptions, sauvegarde fraîche et stockage distant, création/promotion/rollback Vercel), push GitHub et éventuelle décision RPO nécessitent autorisation. Les qualifications isolées restantes n'en nécessitent pas ; elles demeurent techniquement inachevées dans ce dossier.
