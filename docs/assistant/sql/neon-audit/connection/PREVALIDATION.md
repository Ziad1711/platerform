# Rapport de prévalidation — connexion PostgreSQL isolé (Neon)

Projet dédié : `weathered-sky-00057323` — organisation `org-weathered-shadow-36459160`.
Worktree : `jisra-assistant-neon-audit`, commit **`2e6d8ac`** (+ correctifs locaux de
prévalidation, non poussés).

**Aucune connexion n'a été établie, aucune ressource créée, aucun SQL exécuté,
aucun secret affiché ni stocké.** Ce rapport est une prévalidation *hors ligne*.

---

## 1. État vérifié

| Point | Résultat | Détail |
|---|---|---|
| Worktree / branche | OK | `audit/assistant-neon-tx`, HEAD `2e6d8ac`, seul `tsconfig.tsbuildinfo` modifié (généré) |
| `psql` | **ABSENT** | ni dans le `PATH`, ni dans `Program Files`, `AppData`, `C:\tools` |
| `pg_dump` | **ABSENT** | idem |
| `neon` CLI | **ABSENT** | non requis par ce protocole ; `neon init`/`neon deploy` restent interdits |
| Gestionnaires disponibles | `winget` (alias), `choco` | installation client possible **après votre accord** |
| Node / npm | `v24.12.0` / `11.6.2` | utilisés uniquement pour les tests synthétiques locaux (35/35 PASS) |
| `.env.local` / connexions Supabase | **inchangés** | aucune lecture ni écriture |
| Schéma production | **non exporté** | commande fournie mais non exécutée |

Conséquence : **la prévalidation en ligne ne peut pas encore être exécutée** — le
client `psql` manque. Tout le reste est prêt.

---

## 2. Informations de connexion nécessaires (aucun secret dans ce rapport)

À fournir / saisir **hors dépôt** dans `~/jisra-audit/env.local` (modèle
`connection/env.neon.example`) :

| Information | Comment l'obtenir | Remarque |
|---|---|---|
| `PGHOST` | Console Neon → *Connect* → **endpoint direct** | **ne doit pas contenir `-pooler`** |
| `PGPORT` | 5432 | identique pooler/direct, seul l'hôte diffère |
| `PGDATABASE` | nom réel de la base | `neondb` par défaut ; une base dédiée `jisra_assistant_audit_<date>` est préférable (création = écriture, à autoriser) |
| `PGUSER` | rôle propriétaire du projet (`<projet>_owner`) | doit être membre de `neon_superuser` (BYPASSRLS) |
| `PGPASSWORD` | console Neon (ou reset) | jamais commité, jamais affiché |
| `PGSSLROOTCERT` | chemin local du PEM **ISRG Root X1** | Neon signe via Let's Encrypt ; Windows n'expose pas de bundle lisible par libpq |
| Version majeure PostgreSQL | console Neon | doit correspondre à la source du schéma qui sera restaurée |

Aucune de ces valeurs ne doit apparaître dans un commit, un log ou ce rapport.

---

## 3. Contrôles effectués au premier contact (lecture seule)

`connection/check_connection.sh` puis `sql/00_preflight.sql`, sans écriture :

1. **Outils** : `psql` présent, version affichée.
2. **Hôte direct** : refus si `PGHOST` contient `-pooler` (les verrous
   `pg_advisory_lock` et `SET LOCAL ROLE` exigent une session réelle).
3. **TLS** : `sslmode=verify-full` **et** bundle CA lisible ; sinon échec
   explicite (une dégradation vers `require` exigerait votre accord).
4. **Identité** : `current_database()` = `AUDIT_DB` attendu, refus des noms
   contenant `prod`, `jisra-test`, `goqedvcdmgtejtyrawsp`, `supabase`.
5. **Version** : `server_version_num >= 130000` et majeure cohérente avec la source.
6. **Rôle** : `rolsuper` **ou** `rolbypassrls` — sans cela, les `SECURITY DEFINER`
   subissent la RLS et **tous les tests seraient invalides**.
7. **Session épinglée** : même `pg_backend_pid()` entre deux transactions de la
   même session (détection empirique de pooler).
8. **Base vide** : `orders`, `chat_*`, `ai_usage`, `assistant_requests` = 0 ligne.
   Toute donnée métier ⇒ NO-GO (ce projet ne doit contenir que du synthétique).

Le prévol SQL ne vérifie pas encore `anon`/`authenticated`/`service_role` ni
`auth.uid()` : ils sont créés par `05_auth_shim.sql`, et contrôlés de façon
bloquante par `20_verify_schema_ready.sql`.

---

## 4. Dépendances de schéma (rappel décisionnel)

Constats déjà établis dans `DEPENDENCIES.md` :

- les migrations du dépôt **ne créent pas** `chat_threads`, `chat_messages`,
  `ai_usage`, `ai_credit_wallets`, `profiles`, `stores`, `store_members` ;
- `supabase/p7_1_package/.work/snapshot.sql` ne contient que des fonctions ;
- l'export P79 provient de `jisra-test` → **exclu** ;
- **aucun export fiable n'est disponible localement.**

Sur Neon, il n'existe **ni** schéma `auth`, **ni** rôles `anon`/`authenticated`/
`service_role` : `05_auth_shim.sql` les recrée (émulation documentée, BYPASSRLS
sur `service_role`). Les rôles sont créés par l'audit, donc `GRANT … TO
current_user` fonctionnera pour `SET LOCAL ROLE`.

Deux voies possibles, **toutes deux soumises à votre autorisation** :

| Voie | Contenu | Conséquence |
|---|---|---|
| A. Export structurel production | `pg_dump --schema=public --schema=auth --schema-only` (lecture seule) | fidélité maximale ; GO possible |
| B. Fourniture d'un export existant | fichier `public-schema.sql` déjà produit et vérifié | GO possible si empreinte et absence de données confirmées |
| C. Reconstruire depuis les migrations | tables de conversation manquantes | **smoke test non fidèle uniquement — jamais un GO** |

---

## 5. Points bloquants restants

1. **Client `psql` absent** → aucun contact possible avec Neon.
2. **Credentials + endpoint direct** non fournis (normal : hors dépôt).
3. **Bundle CA** ISRG Root X1 non localisé.
4. **Source de schéma** non choisie (voie A, B ou C).
5. **Nom de base** : `neondb` ou base dédiée (création = écriture, à autoriser).

---

## 6. Prochaines étapes proposées (dans l'ordre)

1. Vous fournissez : endpoint **direct**, base, rôle, mot de passe (saisis hors
   dépôt), chemin du bundle CA, majeure PostgreSQL, choix de la voie de schéma.
2. J'installe le client **uniquement si vous l'autorisez** (`winget install
   PostgreSQL.psql` ou `choco install postgresql --params '/ClientOnly'`), ou
   vous fournissez un `psql` déjà installé.
3. `check_connection.sh` → doit afficher `PREVALIDATION: OK`.
4. Restauration du schéma choisi + `01 → 02 → 03b → 05b` **dans la base jetable**.
5. Exécution du protocole (`PROTOCOL.md §3`) puis `99_cleanup.sql`.

---

## 7. Autorisations nécessaires

1. Installer le client PostgreSQL local (`psql`, et `pg_dump` si export).
2. Utiliser les credentials Neon du projet `weathered-sky-00057323`.
3. Choisir la source de schéma (§4) — un export production exige un accord
   **distinct** et explicite.
4. Créer éventuellement une base dédiée (`CREATE DATABASE`) dans ce projet.
5. Restaurer le schéma puis appliquer `01→02→03b→05b` dans **cette** base.
6. Exécuter fixtures et scénarios d'écriture synthétique, y compris l'injection
   d'échec tardif et l'interruption d'une session.
7. Archiver les preuves puis **détruire** le projet et révoquer les credentials.

Tant que 1–3 ne sont pas accordés : **NO-GO**, aucune validation transactionnelle.
