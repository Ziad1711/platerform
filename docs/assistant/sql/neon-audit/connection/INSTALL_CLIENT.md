# Installation du client PostgreSQL (sans serveur) — Windows

Objectif : disposer de `psql` et `pg_dump` pour l'audit transactionnel, **sans
installer ni démarrer de serveur PostgreSQL local**.

## 1. Méthode retenue

Binaires officiels PostgreSQL (EnterpriseDB), archive ZIP **client seul** :
aucun installeur, aucun service Windows, aucune base, aucun port ouvert.

```
postgresql-18.1-1-windows-x64-binaries.zip
https://get.enterprisedb.com/postgresql/postgresql-18.1-1-windows-x64-binaries.zip
```

Extrait dans `%LOCALAPPDATA%\pgclient\pgsql` (utilisateur uniquement) :
`bin/` (psql, pg_dump, pg_restore + DLL), `lib/`, `share/`.
`initdb` / `pg_ctl` sont présents dans `bin/` mais **jamais exécutés**.

## 2. Versions installées (vérifiées)

| Outil | Version |
|---|---|
| `psql` | PostgreSQL **18.1** |
| `pg_dump` | PostgreSQL **18.1** |
| `pg_restore` | PostgreSQL **18.1** |

## 3. Disponibilité

- Entrée **PATH utilisateur** ajoutée :
  `C:\Users\HP-EXE\AppData\Local\pgclient\pgsql\bin`
- Les terminaux déjà ouverts (dont celui de Cline/VS Code, démarré avant la
  modification) n'héritent pas de la nouvelle valeur : **rouvrir VS Code** ou
  utiliser l'un des deux activateurs ci-dessous.
- Repli automatique : `check_connection.sh` et `run_audit.sh` résolvent eux-mêmes
  `$HOME/AppData/Local/pgclient/pgsql/bin` si `psql` n'est pas dans le PATH.

Activation ponctuelle :

```bash
# Git Bash
source "$HOME/AppData/Local/pgclient/activate.sh"
# cmd.exe
"%LOCALAPPDATA%\pgclient\activate.cmd"
```

## 4. Vérifications PASS/FAIL

| Contrôle | Résultat |
|---|---|
| Archive téléchargée (334 929 717 octets) et extraite | **PASS** |
| `psql --version` = 18.1 | **PASS** |
| `pg_dump --version` = 18.1 | **PASS** |
| `pg_restore --version` = 18.1 | **PASS** |
| Aucun service PostgreSQL installé (`sc query`) | **PASS** — 0 service |
| Aucun répertoire `data/` créé | **PASS** |
| Aucun écouteur sur le port 5432 | **PASS** |
| `PATH` utilisateur conservé + entrée ajoutée | **PASS** (idempotent) |
| `.env.local`, Supabase, Vercel, dépôts | **non modifiés** |

## 5. Compatibilité `pg_dump` ↔ Supabase (avant export éventuel)

Règle PostgreSQL : **`pg_dump` majeur ≥ serveur majeur**. Un client 18 peut donc
dumper un serveur 15/16/17/18, mais jamais un serveur 19+.

À vérifier **au moment de l'export**, en lecture seule et avec votre accord :

```sql
select current_setting('server_version') as version,
       current_setting('server_version_num')::int as version_num;
```

- `version_num` ≤ 180000 → le client 18.1 convient ;
- `version_num` > 180000 → installer un client plus récent avant tout export.

La commande d'export structurel (`--schema-only`, `--no-owner`, `--no-privileges`)
est décrite dans `DEPENDENCIES.md §6` et **n'est pas exécutée** à ce stade :
`pg_dump --help` confirme la disponibilité des options
(`-n/--schema`, `-s/--schema-only`, `-O/--no-owner`, `-x/--no-privileges`).

Restaurer dans Neon : la base cible doit être de majeure **≥** celle du dump.
Second point : depuis PostgreSQL 17, les dumps contiennent
`SET transaction_timeout = 0;` — inoffensif si la cible est ≥ 17 ; à neutraliser
si la cible est plus ancienne (documenté dans `DEPENDENCIES.md`).

## 6. Retrait complet (réversible)

```powershell
# 1. retirer l'entrée du PATH utilisateur
powershell -NoProfile -Command "$b='C:\Users\HP-EXE\AppData\Local\pgclient\pgsql\bin';
$p=[Environment]::GetEnvironmentVariable('Path','User');
[Environment]::SetEnvironmentVariable('Path', (($p -split ';' | ? { $_ -ne $b }) -join ';'), 'User')"
# 2. supprimer les fichiers
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\pgclient"
```

Aucun service, aucune base, aucune clé de registre PostgreSQL n'a été créée :
la suppression du dossier suffit.
