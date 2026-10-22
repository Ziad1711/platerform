# Correctif Casablanca autonome — qualification B13

Patch autonome : `TZ-COMPAT-PATCH.sql`, manifeste dédié
`TZ-COMPAT-MANIFEST.json`. Aucun changement des quatre sources historiques,
de leurs empreintes ni du paquet initial déjà installé.

## Inventaire et correction

27 expressions revues et remplacées littéralement en mémoire dans quatre sources.
Le patch contient les versions finales de sept fonctions, donc 23 expressions
effectives : les quatre autres correspondent aux variantes initiales de direct_day
et rebuild_day, remplacées dans le paquet initial par P7.7/P7.8.
Extraction par nom exact et deux occurrences du délimiteur AS, une seule fonction
par bloc. Aucun dashboard_kpi_claim ni autre voisin inclus.

Fonctions : business_date, direct_day, invalidate_insert_stmt, invalidate_trg,
rebuild_day, rpc_dashboard_kpi_reader, invalidate_orders_quality_trg.
Helpers : local_ts(timestamptz,text), local_instant(timestamp,text).

Instant de transition : 2026-09-20 01:00Z. Le plan initial indiquait un seuil
02:00 pour le sens heure murale vers instant : correct pour les minuits testés,
mais incomplet pour l'heure répétée 01:00–02:00. Le helper utilise 01:00 murale
pour reproduire la préférence PostgreSQL pour l'occurrence standard UTC+0.
Ce cas est vérifié à 01:00, 01:30, 01:59:59 et 02:00.

## Preuves réelles

Une transaction contrôlée B13, terminée par ROLLBACK :
- 13 instants UTC → local et business_date conformes au moteur B13 IANA 2026c ;
- 12 heures murales → UTC conformes, dont les bornes 19/20/21 septembre ;
- Europe/Paris inchangée dans les deux sens ; journée du 20 septembre = 25 h ;
- direct_day avant/après identique sur tous ses champs financiers ;
- commandes frontières classées dans les journées 19, 20 et 21 ; invalidations
  présentes aux bonnes dates, y compris update de qualité ;
- reconstruction effective via worker transactionnel et backlog drainé ;
- agrégat attendu : commandes 3, CA 200, achats 80, livraison 25,
  confirmation 5, publicité 10 ; aucun écart financier ;
- lecteur exécuté sous rôle authenticated avec identité synthétique de fixture.

Comparaison structurée avant/après : aucun attribut des fonctions préexistantes
ne change hors prosrc ; signatures, propriétaire, ACL, SECURITY DEFINER,
search_path et autres attributs conservés. Politiques et triggers identiques.
Helpers SECURITY INVOKER, STABLE, search_path explicite, EXECUTE seulement
postgres/service_role (pas de nouvelle RPC publique).

Après ROLLBACK : tous contenus publics, fonctions, ACL, politiques, configurations
et triggers identiques à la capture initiale ; seules les séquences peuvent avancer.
Production/TEST/P7 non accédés en écriture. Aucune activation persistante B13.

Preuves : `C:/Users/HP-EXE/AppData/Local/Temp/tz-qualification/`
(before.out, qualification.sql/out/err, final.out, RESULT.json).

## Procédure Production future — NON EXÉCUTÉE

1. Autorisation distincte, capture actuelle des sept définitions exactes et de
   leurs ACL/propriétaires (corps JSON sans conversion CRLF), absence des helpers,
   socle inactif confirmé, aucune migration concurrente.
2. Comparer chaque définition actuelle aux versions finales de la Release inactive,
   et arrêter si une divergence non attendue existe. Les empreintes C0 B13 ne sont
   pas les empreintes attendues de la Production.
3. Utiliser le fichier UTF-8/LF dont SHA-256 figure au manifeste dédié :
   `psql -X -w service=production -v ON_ERROR_STOP=1 --single-transaction
   -c "set local kpi.tz_compat_authorized='yes'" -f <chemin absolu du patch>`.
4. Vérifier les neuf empreintes cibles du manifeste, métadonnées préservées,
   conversions, zéro producteur/job/cohorte et worker/réveil arrêtés.
   Ne pas relancer les anciennes empreintes P7.1 comme si le patch n'existait pas.
5. Échec avant COMMIT : annulation de la transaction. Après COMMIT : retour
   uniquement aux définitions de la capture de cette cible et retrait des deux
   helpers après restauration de leurs dépendants, sur autorisation dédiée.

Aucun changement de readiness ici. Le patch est préparé et qualifié B13,
pas appliqué en Production. La preuve B13 est obtenue avec un moteur déjà conforme :
le passage UTC+0 après la transition est explicite dans le helper, tandis que
l'historique reste délégué aux règles natives de la cible (pas une base IANA
historique complète embarquée). Compatibilité des règles prétransition de la
cible à conserver comme précondition.

Risques p95/import 600 et exceptions restent indépendants et non approuvés.