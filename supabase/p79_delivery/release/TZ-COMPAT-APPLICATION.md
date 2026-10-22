# Application future — NON AUTORISÉE / NON EXÉCUTÉE

Compatibilité vérifiée en lecture seule sur le service Production explicitement
lié à `attvfeoqgbxsnnsllatt`. Sept définitions : leur corps ne diffère de celui
du patch que par les 23 conversions prévues (27 sites sources avec doublons des
versions initiales de direct_day/rebuild_day). Résultats dans
`TZ-PRODUCTION-COMPATIBILITY.json`. Aucun compte ni donnée métier exporté.

Exécuter préalablement `node supabase/p79_delivery/release/verify-tz-compat.cjs`.
Une autorisation explicite d'application Production reste indispensable.

Commande PowerShell future (chemins absolus, capture locale hors Git) :

```powershell
$env:PGSERVICEFILE = "$env:APPDATA\postgresql\pg_service.conf"
$env:PGPASSFILE = "$env:APPDATA\postgresql\pgpass.conf"
$root = 'C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated'
& 'C:\Users\HP-EXE\Tools\pg17\pgsql\bin\psql.exe' -X -w service=production `
  -v ON_ERROR_STOP=1 `
  -v "capture_file=$env:LOCALAPPDATA/Temp/TZ-PRODUCTION-BEFORE.json" `
  -f "$root/supabase/p79_delivery/release/TZ-COMPAT-APPLY.sql"
if ($LASTEXITCODE -ne 0) { throw 'STOP : correctif non validé, ne pas poursuivre' }
```

Le wrapper contient sa transaction BEGIN/COMMIT : ne pas ajouter une deuxième
transaction. Vérifier à nouveau le service (host, user Production, SSL) et les
SHA-256 avant toute exécution. Garantir une fenêtre exclusive de DDL : le contrôle
pg_stat_activity est une détection ponctuelle, pas une exclusion administrative.

Le wrapper capture dans une seule session les sept définitions complètes et leurs
attributs, ACL et configurations ; exige leurs empreintes de départ, absence des
helpers, socle inactif et aucune cohorte. Il applique le patch unique puis contrôle
les neuf empreintes, métadonnées et permissions préservées, conversions de
transition/heure ambiguë/journée de 25 h, politiques/triggers/configurations
inchangés. Une exception avant COMMIT termine psql en erreur et annule la transaction.

Arrêts : cible incertaine, capture impossible, source divergente, helper déjà
présent, socle actif, DDL concurrent, signature/dépendance absente, conversion ou
empreinte différente, permission/configuration changée. Aucun correctif improvisé.
Ne pas activer V5, worker, producteurs ou readiness dans cette opération.

Les dépendances applicatives des sept fonctions sont celles du socle installé ;
la compilation et leur exécution ont été qualifiées sur B13, pas rejouées sur
Production. Les conversions historiques antérieures à la transition continuent
d'utiliser les données système : ce patch corrige le changement 2026c, pas toute
différence historique potentielle de tzdb.

En cas de besoin de retour après COMMIT : autorisation distincte, fonctions de la
capture de cette cible restaurées (prosrc verbatim via JSON, attributs et ACL
capturés), puis suppression des deux helpers sans CASCADE. Ne jamais utiliser
les restaurations C0 propres à B13. Le wrapper ne lance pas ce retour automatiquement.

Les manifestes du paquet inactif historique restent inchangés. Le manifeste dédié
versionne ce correctif additionnel ; ne pas réinstaller les lots historiques.
La validation statique du wrapper n'est pas une preuve d'application Production.