# Plan d'export structurel — Supabase production → Neon (audit)

Statut : **préparé, non exécuté**. Aucun export, aucune restauration, aucune
écriture. Seules des requêtes en lecture seule ont été exécutées sur la
production (`supabase_read_only_user`).

---

## 1. Constats vérifiés en production (lecture seule)

| Élément | Valeur observée |
|---|---|
| Version PostgreSQL | **17.6** (`server_version_num = 170006`) |
| Base / rôle de session | `postgres` / `supabase_read_only_user` (lecture seule) |
| Cible Neon | PostgreSQL **18.6** (`neondb`) |
| Client d'export | `pg_dump` **18.1** (≥ serveur : conforme) |
| Schémas présents | `auth`, `cron`, `extensions`, `graphql`, `graphql_public`, `net`, `public`, `realtime`, `storage`, `supabase_migrations`, `vault` |
| `public` — objets | **107 tables** (toutes RLS), 4 vues, 4 séquences, **209 fonctions** (157 plpgsql, 52 sql), **219 policies**, **70 triggers**, 0 partitionnée, 0 table étrangère |
| Types personnalisés | **aucun** (ni enum, ni domaine) |
| Extensions | `pg_cron` 1.6.4, **`pg_net` 0.20.0 (schéma `public`)**, `pg_stat_statements` 1.11, `pgcrypto` 1.3, `plpgsql`, `supabase_vault` 0.3.1, `uuid-ossp` 1.1 |
| Colonnes `uuid` par défaut | 80 × `gen_random_uuid()`, **0 × `uuid_generate_v4()`** |
| Fonctions utilisant `extensions.*` | **0** → pgcrypto / uuid-ossp inutiles sur Neon |
| Fonctions `LANGUAGE sql` | 52 (analysées à la création), **aucune** ne référence `auth.users` |
| Fonctions référençant `auth.*` | 62 (2 seulement `auth.users`, toutes plpgsql) |
| Fonctions référençant `net`/`cron`/`vault`/`storage`/`realtime`/`graphql` | **1** : `dashboard_kpi_wakeup_trg` (plpgsql, non analysée à la création) |
| Rôles ciblés par les policies | `public` (177), `authenticated` (38), `service_role` (4) — aucun rôle exotique |
| Fonctions `SECURITY DEFINER` | 150 |

### Dépendances de clés étrangères

| Contrainte | Cible | Conséquence pour Neon |
|---|---|---|
| `profiles.id` | `auth.users(id) ON DELETE CASCADE` | **`auth.users` doit exister** (stub ajouté à `05_auth_shim.sql`) |
| `store_members.invited_by` | `auth.users(id)` | idem |
| `chat_messages.thread_id` | `chat_threads(id) **ON DELETE CASCADE**` | confirme le scénario R12 |
| `chat_threads.store_id` | `stores(id) ON DELETE SET NULL` | quarantaine `store_id IS NULL` |
| `ai_usage.thread_id` | `chat_threads(id) ON DELETE SET NULL` | — |
| `subscriptions.coupon_id` | `coupons(id)` | table incluse (schéma complet) |
| `ai_credit_wallets.user_id` | `profiles(id) ON DELETE CASCADE` | — |

### Garde-fous métier sur les tables de fixtures

| Table | Trigger | Effet sur l'audit |
|---|---|---|
| `store_members` | `block_store_member_insert` | refuse `role='owner'` incohérent ; admin/viewer/accountant **passent** |
| `store_members` | `block_store_member_mutation` | interdit de changer store/user et de retirer le **propriétaire** ; la révocation de l'admin (R9) **passe** |
| `store_members` | `sync_confirmation_agent_for_member` | exécuté à l'insertion/mise à jour |
| `stores` | `tg_add_store_owner_member`, `enforce_store_quota`, `tg_create_default_blacklist_rule` | s'appliquent à la création de boutique (fixtures) |
| `chat_threads`, `profiles`, `stores`, `ai_credit_wallets`, `subscriptions` | `handle_updated_at` | anodin |

---

## 2. Commande exacte d'export (À NE PAS EXÉCUTER sans validation)

```bash
# 1) Session en lecture seule, TLS vérifié, identifiants hors dépôt
export PROD_READONLY_URL='postgresql://<user_ro>:<password>@<host>:5432/postgres?sslmode=verify-full&sslrootcert=C:/Users/HP-EXE/jisra-audit/isrgrootx1.pem'

# 2) Export strictement structurel
pg_dump "$PROD_READONLY_URL" \
  --schema=public \
  --schema-only \
  --no-owner \
  --no-privileges \
  --no-comments \
  --no-tablespaces \
  --no-security-labels \
  --no-publications \
  --no-subscriptions \
  --exclude-extension=pg_net \
  --exclude-extension=supabase_vault \
  --exclude-extension=pg_cron \
  --exclude-extension=pg_stat_statements \
  --format=plain \
  --file=public-schema.sql
```

Sortie attendue : fichier texte de **400–700 Ko**, sans aucune donnée.

---

## 3. Ce qui est exclu, et pourquoi

| Exclu | Moyen | Raison |
|---|---|---|
| Toutes les **données** | `--schema-only` | aucun COPY / INSERT |
| Schémas Supabase internes (`auth`, `storage`, `realtime`, `vault`, `graphql`, `graphql_public`, `cron`, `net`, `supabase_migrations`, `extensions`) | `--schema=public` (seul `public` est dumpé) | non nécessaires ; `auth`/`vault` contiennent des secrets |
| `pg_net` (installé dans `public`) | `--exclude-extension=pg_net` | indisponible sur Neon ; aucune fonction `public` ne l'appelle (hors trigger non utilisé) |
| `supabase_vault`, `pg_cron`, `pg_stat_statements` | `--exclude-extension` | spécifiques Supabase |
| `GRANT` / `ALTER DEFAULT PRIVILEGES` / propriétaires | `--no-owner --no-privileges` | n'expose pas la matrice de rôles ; les privilèges utiles sont rétablis par `01` |
| `COMMENT ON ...` | `--no-comments` | aucune note interne importée |
| Tablespaces, labels, publications, souscriptions | options dédiées | non pertinents / non supportés par Neon |

Aucun objet du schéma `public` ne contient de clé, JWT ou mot de passe ; un
**scan obligatoire** du fichier est prévu (§6).

---

## 4. Prérequis côté Neon, AVANT restauration

1. `05_auth_shim.sql` : crée `anon`, `authenticated`, `service_role`, le schéma
   `auth`, `auth.uid()/role()/jwt()` **et la table `auth.users(id)`** exigée par
   `profiles.id` et `store_members.invited_by`.
2. **Aucune extension à installer** : `gen_random_uuid()` est dans le cœur,
   aucune fonction n'utilise `extensions.*`, et `pg_net`/`vault`/`cron` sont exclus.
3. Rôle de restauration = propriétaire (membre `neon_superuser`, `BYPASSRLS`) :
   les 150 `SECURITY DEFINER` s'exécutent avec cette identité, comme `postgres`
   en production.

---

## 5. Séquence de restauration et contrôles de conformité

```bash
# 1. rôles + shim auth (idempotent)
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/sql/05_auth_shim.sql

# 2. schéma structurel
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f public-schema.sql

# 3. contrôles de conformité (lecture seule)
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/export/verify_restore.sql

# 4. harnais puis migrations du package
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f .../sql/10_bootstrap_audit.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f .../sql/20_verify_schema_ready.sql
# puis 01 → 02 → 03b → 05b, puis 30_fixtures.sql, etc. (PROTOCOL.md §3)
```

`verify_restore.sql` compare les volumes d'objets aux valeurs mesurées en
production, vérifie RLS, l'absence d'extensions exclues et l'absence de données.

---

## 6. Contrôles de non-fuite sur le fichier exporté

```bash
grep -c '^CREATE TABLE'        public-schema.sql   # attendu : 107
grep -c 'CREATE POLICY'        public-schema.sql   # attendu : 219
grep -cE '^(COPY|INSERT INTO)' public-schema.sql   # attendu : 0
grep -c 'CREATE EXTENSION'     public-schema.sql   # attendu : 0 (tout exclu)
grep -nE 'eyJ[A-Za-z0-9_-]{10,}|password|secret|token|apikey|postgresql://|SUPABASE_' public-schema.sql
sha256sum public-schema.sql
```

Toute occurrence sur l'avant-dernière ligne ⇒ **arrêt**, fichier inutilisable.

---

## 7. Compatibilité PostgreSQL 17.6 → 18.6

| Point | Verdict |
|---|---|
| `pg_dump` 18.1 depuis un serveur 17.6 | **OK** (client majeur ≥ serveur) |
| `SET transaction_timeout = 0;` (dumps 17+) | **OK** — GUC présent en 18 |
| Types personnalisés (enum/domain) | **aucun** → rien à recréer |
| `gen_random_uuid()` (80 colonnes) | **cœur depuis PG13** → OK |
| `uuid-ossp` / `pgcrypto` (`extensions.*`) | **non requis** (0 usage) |
| Tables partitionnées / étrangères | **aucune** |
| `pg_net` / `vault` / `cron` | **exclus** ; seule `dashboard_kpi_wakeup_trg` (plpgsql) les référence, jamais invoquée par l'audit |
| Policies `TO public/authenticated/service_role` | rôles créés par le shim avant restauration |
| `SECURITY DEFINER` (150) | recréés avec le propriétaire de restauration → `BYPASSRLS` comme en prod |

Risque résiduel : une fonction `LANGUAGE sql` (52) dont une dépendance
transitive changerait de sémantique en 18. La restauration s'arrête sur la
première erreur (`ON_ERROR_STOP`) et le log identifie l'objet fautif.

---

## 8. Blocages avant exécution

1. **`PROD_READONLY_URL` indisponible** dans cet environnement : l'export ne
   peut pas être lancé. Les métadonnées ci-dessus proviennent du serveur MCP
   déjà configuré en lecture seule.
2. **Validation explicite** requise pour lancer `pg_dump` sur la production
   (lecture seule, mais hors du périmètre déjà autorisé).
3. Décision à confirmer : schéma **complet** `public` (recommandé) plutôt qu'un
   sous-ensemble — un sous-ensemble casserait les 52 fonctions `LANGUAGE sql`
   qui référencent des tables non incluses.
4. Disque local : ~9 Go libres, largement suffisant.

---

## 9. Décision : reconstruction via MCP écartée (NO-GO)

L'option A (reconstruction DDL depuis les catalogues via le canal lecture seule)
a été **mesurée puis rejetée** :

- volume de DDL à transférer : **581 619 octets** (~568 Kio, ~150 k tokens),
  non transférable sans troncature par le canal MCP ;
- la fermeture du périmètre audit atteint le hub `orders` via
  `confirmation_agents → reassign_orders_on_agent_deactivation`, donc réduire le
  périmètre exigerait de désactiver des triggers (mock interdit) ;
- sans DDL complet, ni contrôle objet par objet ni empreinte SHA-256 ne sont
  possibles.

Détails, écarts de fidélité et alternative retenue :
[`RECONSTRUCTION_ASSESSMENT.md`](./RECONSTRUCTION_ASSESSMENT.md).

**Seule voie fidèle restante** : rôle d'audit minimal (`LOGIN` + `CONNECT` +
`USAGE` sur `public`, `VALID UNTIL` court) puis `pg_dump --schema-only`, rôle
supprimé immédiatement après. La commande d'export du §2 s'applique alors
telle quelle, suivie de `export/verify_restore.sql`.
