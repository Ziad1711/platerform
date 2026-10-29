# Dépendances DDL exactes du package 01/02/03b/05b

But : déterminer ce qu'il faut restaurer dans un PostgreSQL distant jetable pour
que les migrations et les scénarios aient un sens — sans jamais copier de données
métier. Références issues du dépôt, pas d'une base de production.

---

## 1. Tables et colonnes strictement nécessaires

| Table | Colonnes utilisées | Utilisée par |
|---|---|---|
| `profiles` | `id` | FK `assistant_requests.user_id` |
| `stores` | `id`, `owner_user_id` | helpers 02, FK 03b |
| `store_members` | `store_id`, `user_id`, `role`, `status` | helpers 02 (gate d'accès) |
| `plans` | `id`, `price`, `ai_credits_monthly` | `resolve_effective_plan`, débit 05b |
| `subscriptions` | `user_id`, `plan_id`, `status`, `started_at`, `created_at`, `expires_at` | `resolve_effective_plan` |
| `chat_threads` | `id`, `user_id`, `store_id`, `title`, `is_pinned`, `created_at`, `updated_at` | 01/02/03b/05b, RLS |
| `chat_messages` | `id`, `thread_id`, `role`, `content`, `credits_used`, `metadata`, `created_at` | 01/02/03b/05b |
| `ai_usage` | `user_id`, `store_id`, `thread_id`, `feature`, `credits_used`, `input_tokens`, `output_tokens`, `provider_name`, `model_name`, `provider_cost_usd` | 01/05b |
| `ai_credit_wallets` | `id`, `user_id`, `plan_id`, `monthly_credits`, `credits_used`, `reset_date`, `updated_at` | 05b, `sync_ai_credit_wallet_for_plan` |
| `assistant_requests` | créée par `03b` | 03b/05b |

Colonnes additionnelles NOT NULL sans défaut : les fixtures les complètent via
`audit.seed_row` et échouent explicitement (`REVIEW_COLUMN`) sur un type non
couvert. Aucune valeur métier inventée.

## 2. Fonctions dont dépendent les migrations

| Fonction | Source dans le dépôt | Dépendances propres |
|---|---|---|
| `public.resolve_effective_plan(uuid) returns public.plans` | `supabase/migrations/20260928020000_subscription_plan_limits.sql` | `subscriptions`, `plans` |
| `public.sync_ai_credit_wallet_for_plan(uuid, public.plans)` | `supabase/migrations/20260928020500_ai_wallet_plan_sync.sql` | `ai_credit_wallets`, `plans` |
| `public.can_view_store_finances(uuid)` | `supabase/migrations/20260926174248_finance_payment_registries.sql` | `stores`, `store_members` |
| `auth.uid()` | schéma `auth` Supabase | GUC `request.jwt.claim*` |

`05b` appelle `resolve_effective_plan` puis `sync_ai_credit_wallet_for_plan` :
leur absence est détectée en amont par `20_verify_schema_ready.sql`.

## 3. Rôles et attributs

| Élément | Attendu | Origine |
|---|---|---|
| `anon`, `authenticated` | NOLOGIN, sans héritage | émulation (`05_auth_shim.sql`) |
| `service_role` | NOLOGIN + `BYPASSRLS` | émulation du rôle backend Supabase |
| Rôle propriétaire des migrations | `rolsuper` **ou** `rolbypassrls` | sinon les `SECURITY DEFINER` subissent la RLS et les tests sont invalides |

`05_auth_shim.sql` accorde l'appartenance `anon/authenticated/service_role` au
rôle courant : sans superuser, `SET LOCAL ROLE` exige cette appartenance — c'est
le mécanisme utilisé par tous les scénarios.

## 4. Contraintes de clé étrangère à connaître

| Contrainte | Impact |
|---|---|
| `assistant_requests.thread_id → chat_threads(id)` | `on delete set null` (imposé par `03b`) : R12 vérifie l'absence d'orphelin |
| `chat_messages.thread_id → chat_threads(id)` | règle réelle inconnue hors base : `cascade` ⇒ messages supprimés ; `restrict` ⇒ suppression refusée. R12 enregistre le résultat réel |
| `ai_credit_wallets.user_id` | unicité attendue (le code fait `select … for update` puis `insert` si absent) |
| `profiles.id → auth.users(id)` | **mesuré en production** : la table `auth.users` doit exister avant restauration. `05_auth_shim.sql` en crée un stub minimal (`id uuid primary key`), suffisant pour la FK ; l'authentification reste hors périmètre |
| `store_members.invited_by → auth.users(id)` | même dépendance (sans cascade) |

`20_verify_schema_ready.sql` affiche ces FK avant toute écriture.

## 5. Source du schéma : état des lieux (vérifié dans le dépôt)

| Candidat | Verdict |
|---|---|
| `supabase/migrations/*.sql` | **insuffisant** : `chat_threads`, `chat_messages`, `ai_usage`, `ai_credit_wallets`, `profiles`, `stores`, `store_members` n'y sont pas créées (schéma initial hors dépôt) |
| `supabase/p7_1_package/.work/snapshot.sql` | **inutilisable** : 1 448 lignes de **fonctions** seulement, aucune table |
| `supabase/p79_delivery/b13/schema-export.manifest.json` | décrit un export **hors dépôt** généré depuis le projet `jisra-test` (`goqedvcdmgtejtyrawsp`) → **exclu** (pas de Supabase-test) |
| Export structurel de production | **aucun fichier fiable disponible localement** |

Conclusion : **aucun export de schéma fiable et autorisé n'existe dans le
dépôt**. Une source doit être produite avec votre autorisation.

## 6. Commande d'export structurel (À NE PAS EXÉCUTER SANS AUTORISATION)

```bash
# Structure seule, sans données : schémas public + auth.
# Poste autorisé, lecture seule, aucune écriture en production.
PGSSLMODE=verify-full \
pg_dump "$PROD_READONLY_URL" \
  --schema=public --schema=auth \
  --schema-only \
  --no-owner --no-privileges --no-comments \
  --file=public-schema.sql
```

Contrôles d'intégrité du fichier obtenu, **avant** restauration :

```bash
grep -c '^CREATE TABLE'                              public-schema.sql   # > 0
grep -cE '^(COPY|INSERT INTO)'                       public-schema.sql   # doit être 0
grep -c 'CREATE FUNCTION\|CREATE OR REPLACE FUNCTION' public-schema.sql
sha256sum public-schema.sql
```

Consigner : date, opérateur, commande exacte, nombre d'objets, empreinte SHA-256,
mention « aucune donnée métier exportée ».

> Variante sans accès production : reconstruire un schéma à partir des seules
> migrations du dépôt **n'est pas équivalent** (tables de conversation absentes).
> Cette voie ne peut produire qu'un smoke test étiqueté « non fidèle » — jamais
> un GO.

## 7. Restauration dans la base jetable

```bash
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f public-schema.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/01_assistant_privileges.proposed.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/02_assistant_thread_scope_rls.proposed.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/03b_assistant_idempotency_registry_v2.proposed.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/05b_assistant_finalization_v2.proposed.sql
```

Si l'export ne contient pas le schéma `auth`, appliquer d'abord
`neon-audit/sql/05_auth_shim.sql`.

## 8. Limites explicites du montage

1. `auth.uid()` est un **shim** : sémantique documentée reproduite, service Auth
   absent. La validation porte sur SQL/RLS/transactions.
2. Le cache de schéma et le routage **PostgREST** ne sont pas exercés.
3. Les FK réelles de `chat_messages` viennent de l'export : leur règle de
   suppression est relevée puis vérifiée, jamais supposée.
4. Aucune donnée, aucun secret, aucun identifiant de production n'est utilisé.
