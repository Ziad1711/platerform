# Runbook — pilote privé du chatbot IA (préparé, NON exécuté)

Statut : **procédure préparée localement**. Aucune sauvegarde, aucune migration,
aucun déploiement, aucun appel fournisseur n'a été exécuté pour produire ce
document. Chaque étape ci-dessous exige une autorisation explicite.

Objectif : ouvrir le chatbot à **un seul compte** (UUID du propriétaire), sur un
code dont le verrou serveur est fermé par défaut, avec crédits et isolation de
boutiques intacts.

---

## 0. Règles dures

1. Le code est déployé **chatbot fermé** (`ASSISTANT_ENABLED` absent).
2. Aucune migration n'est appliquée avant la sauvegarde du §1.
3. Les 4 fichiers SQL autorisés sont ceux de `MANIFEST.sha256` ; `03` et `05`
   historiques ne sont **jamais** appliqués.
4. Aucun débit, aucune suppression d'historique, aucun élargissement de
   privilège n'est utilisé comme contournement.
5. Toute ouverture se fait par variables d'environnement serveur, jamais par
   interface, jamais par valeur codée en dur.

---

## 1. Sauvegardes (à exécuter avant toute écriture)

```bash
# 1.1 Données chatbot + portefeuilles (données seules)
pg_dump "$PROD_URL" --schema=public --data-only \
  --table=public.chat_threads --table=public.chat_messages \
  --table=public.ai_usage --table=public.ai_credit_wallets \
  --table=public.assistant_requests \
  -f backup_assistant_data_$(date +%Y%m%d).sql

# 1.2 ACL, policies, fonctions, triggers (rollback exact)
pg_dump "$PROD_URL" --schema=public --schema-only \
  -f backup_assistant_schema_$(date +%Y%m%d).sql

psql "$PROD_URL" -Atc "select tablename, policyname, roles, cmd, qual, with_check
  from pg_policies where schemaname='public'
   and tablename in ('chat_threads','chat_messages','ai_usage','ai_credit_wallets')
  order by 1,2" > backup_policies_$(date +%Y%m%d).txt

psql "$PROD_URL" -Atc "select p.oid::regprocedure, pg_get_userbyid(p.proowner)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'assistant_%' or p.proname like 'rpc_assistant_%')
  order by 1::text" > backup_functions_$(date +%Y%m%d).txt
```

Contrôler avant/après : `count(*)` de `chat_threads`, `chat_messages`, `ai_usage`,
`ai_credit_wallets` (somme `credits_used`), `assistant_requests`.

Pré-requis du correctif Lot C :

```sql
-- doit renvoyer 'n' (SET NULL) sur chat_threads.store_id
select conname, confdeltype from pg_constraint
 where conrelid = 'public.chat_threads'::regclass and contype = 'f';
```

---

## 2. Manifeste SQL

```bash
cd docs/assistant/sql && sha256sum -c MANIFEST.sha256   # 4 x OK
```

| Fichier | SHA-256 |
|---|---|
| `01_assistant_privileges.proposed.sql` | `56739607f8072b7b8b52afb8c119ca2f0d92f38be2430244c7c8c1ee3ef39ae7` |
| `02_assistant_thread_scope_rls.proposed.sql` | `8bc0b7f4c9f25c3b8c33207782c5381f4326fd43a3ea1f2270e36983d1c9102f` |
| `03b_assistant_idempotency_registry_v2.proposed.sql` | `01cea1b88fe559bd58d1c57fcda0f81f2407d84ab361b9d9885a8180c79899f9` |
| `05b_assistant_finalization_v2.proposed.sql` | `69065b218b143c68237108db787f5584c07d03d78309dc64a2e192340e70a869` |

---

## 3. Configuration serveur (Vercel, Production)

Étape 3a — **déploiement fermé** (premier déploiement du code candidat) :

```
ASSISTANT_ENABLED = (absent)
ASSISTANT_ALLOWED_USER_IDS = (absent)
ASSISTANT_BACKEND_WRITES = enabled
OPENAI_MODEL = gpt-5.4-mini
OPENAI_API_KEY = <clé existante, valeur inchangée>
ASSISTANT_REQUEST_TIMEOUT_MS = 45000
ASSISTANT_MAX_OUTPUT_TOKENS = 800
```

Étape 3b — **activation du pilote** (après §4 et §5) :

```
ASSISTANT_ENABLED = enabled
ASSISTANT_ALLOWED_USER_IDS = <UUID du propriétaire, exact>
ASSISTANT_IDEMPOTENCY_REGISTRY = enabled
ASSISTANT_FINALIZE_ATOMIC = enabled
ASSISTANT_CREDIT_RESERVATION = (absent — réservation informative OFF)
```

Règles :
- `ASSISTANT_ALLOWED_USER_IDS` n'accepte que des UUID exacts séparés par des
  virgules ; email, nom et joker sont ignorés ;
- configuration incomplète (verrou, allowlist, registre ou atomicité) ⇒ routes
  assistant en `503 ASSISTANT_PILOT_CONFIG_INCOMPLETE` ;
- l'UUID vient de Supabase Auth (`auth.users.id`), jamais d'un écran client.

---

## 4. Ordre d'application des migrations

Une par une, avec contrôle de sortie entre chaque étape :

```
1. 01_assistant_privileges            → RUNBOOK.md §4.1
2. 02_assistant_thread_scope_rls      → RUNBOOK.md §4.2
3. 03b_assistant_idempotency_registry → RUNBOOK.md §4.3
4. 05b_assistant_finalization         → RUNBOOK.md §4.4
5. rechargement PostgREST + revue des surcharges `rpc_assistant_*`
6. scénarios PostgreSQL deux connexions (paquet `neon-audit/`, base jetable)
```

Contrôle Lot C après `02` (transaction annulée) :

```sql
begin;
  -- 1. détachement interdit tant que la boutique existe
  update public.chat_threads set store_id = null
   where store_id = '<store_id>';            -- attendu : THREAD_STORE_IMMUTABLE
  -- 2. rattachement arbitraire interdit
  update public.chat_threads set store_id = '<autre_store_id>'
   where id = '<thread_id>';                 -- attendu : THREAD_STORE_IMMUTABLE
rollback;
-- 3. suppression réelle de boutique (environnement jetable uniquement)
--    attendu : suppression OK, conversations détachées (store_id NULL),
--    messages et ai_usage intacts
```

### 4.1 Preuve de suppression de boutique (registre inclus)

À exécuter en base jetable (Neon) **ou** en transaction annulée, jamais en
production ouverte. Contrôle préalable des références vers `stores` :

```sql
-- Toute FK en cascade vers stores détruit des preuves : à vérifier AVANT
-- la première suppression de boutique réelle.
select c.conname, c.conrelid::regclass as source, c.confdeltype
  from pg_constraint c
 where c.contype = 'f'
   and c.confrelid = 'public.stores'::regclass
 order by 2::text;
-- attendu : 'n' (SET NULL) ou 'r' (RESTRICT) ; 'c' (CASCADE) = preuve détruite
```

```sql
begin;
  -- A. immuabilité : ce détachement doit échouer (THREAD_STORE_IMMUTABLE)
  savepoint a;
  update public.chat_threads set store_id = null where store_id = '<store>';
  rollback to savepoint a;

  -- B. suppression de la boutique
  delete from public.stores where id = '<store>';

  -- C. invariants attendus
  select count(*) from public.chat_threads  where id = '<thread>';   -- 1
  select count(*) from public.chat_messages where thread_id = '<thread>'; -- inchangé
  select store_id is null, credits_consumed, credits_charged, state
    from public.assistant_requests where request_id = '<request_id>'; -- 1 ligne conservée
  select credits_used from public.ai_usage where thread_id = '<thread>';  -- inchangé
rollback;  -- ou commit en base jetable, puis 99_cleanup
```



---

## 5. Contrôles réels Supabase Auth / PostgREST

| # | Contrôle | Attendu |
|---|---|---|
| A1 | `GET /api/assistant/wallet` sans cookie | 401 |
| A2 | wallet avec session d'un compte non listé | 403 `ASSISTANT_NOT_ALLOWED` |
| A3 | wallet avec UUID listé, `ASSISTANT_ENABLED` absent | 503 `ASSISTANT_DISABLED` |
| A4 | wallet avec UUID listé, flags complets | 200 (aucun débit) |
| A5 | `POST /api/assistant/chat` compte non listé | 403 **avant** tout appel IA (aucune ligne `ai_usage`) |
| A6 | PostgREST `chat_threads` avec compte non listé | policy → 0 ligne |
| A7 | PostgREST `ai_usage` insert depuis `authenticated` | `42501` |
| A8 | `rpc_assistant_finalize_request` depuis `authenticated` | refus d'exécution |

---

## 6. Activation limitée et scénarios E2E minimaux

1. Déployer le code fermé, vérifier accueil / login / Dashboard / Sales.
2. Appliquer §3b (verrou + UUID + flags atomiques), redéployer/redémarrer.
3. Depuis le seul compte autorisé :
   - E1 « Analyse mon business » → réponse V2, `finalization_atomic: true` ;
   - E2 rejouer la même requête (`requestId` identique) → `replayed: true`,
     `creditsCharged: 0` ;
   - E3 conversation d'une autre boutique → refus multi-tenant ;
   - E4 double envoi simultané → `429 CONCURRENT_REQUEST` ;
   - E5 suppression d'une conversation → disparaît, `ai_usage` conservé.
4. Surveillance crédits (lecture seule) :

```sql
select credit_status, count(*), sum(credits_consumed), sum(credits_charged)
  from public.assistant_requests where state='completed' group by 1;
-- invariant : sum(credits_charged) <= sum(credits_consumed)
```

5. Depuis un second compte de test (non listé) : aucun accès à l'assistant.

---

## 7. Fermeture immédiate (incident)

```
1. ASSISTANT_ENABLED = (variable supprimée)  → redéploiement/restart
2. Vérifier : POST /api/assistant/chat = 503 ASSISTANT_DISABLED
3. Geler les écritures assistant (aucune nouvelle requête acceptée)
4. Conserver toutes les preuves : assistant_requests, chat_messages, ai_usage,
   ai_credit_wallets (aucune suppression)
```

Durée cible : < 5 minutes. Aucune migration n'est nécessaire pour fermer.

---

## 8. Rollback (sans rétablir de privilèges vulnérables)

1. Fermer (§7) : `ASSISTANT_ENABLED` retiré, puis
   `ASSISTANT_CREDIT_RESERVATION` off → `ASSISTANT_FINALIZE_ATOMIC` off →
   `ASSISTANT_IDEMPOTENCY_REGISTRY` off (ordre inverse de l'activation).
2. Ne **jamais** réaccorder `anon`/`PUBLIC`, ni l'insertion client de `ai_usage`
   ou de messages `assistant`.
3. Ne **jamais** annuler un débit déjà validé : toute compensation est une
   réconciliation approuvée et tracée.
4. Retrait SQL seulement si nécessaire, ordre `05b` → `03b` → `02` → `01`, avec
   les blocs « Rollback » de chaque fichier et les sauvegardes du §1.
5. `02` conserve l'immuabilité du périmètre : le rollback ne doit pas supprimer
   le trigger sans restaurer la policy d'origine sauvegardée.

---

## 9. Points de vigilance connus

- `assistant_requests.store_id` est **nullable** et détaché
  (`ON DELETE SET NULL`) à la suppression d'une boutique : la ligne de registre
  (clé d'idempotence, empreinte, `credits_consumed/charged`) **survit**.
  Aucune cascade : la trace n'est pas détruite. Un détachement ne peut jamais
  produire un débit : `begin` traite la ligne détachée comme un conflit,
  `reserve`/`complete` refusent une boutique inexistante
  (`IDEMPOTENCY_STORE_DETACHED`), et `05b` refuse via `FORBIDDEN_STORE`.
  Vérification avant suppression de boutique :
  `select confdeltype from pg_constraint where conname='assistant_requests_store_id_fkey';`
  → attendu `n`.
- Les conversations détachées (`store_id IS NULL`) sont en quarantaine : non
  lisibles via PostgREST, supprimables par leur propriétaire.
- Le rate limit reste en mémoire de processus (par instance Vercel).
- Les tests E2E sur Supabase production exigent une autorisation séparée.


---

## 10. Commandes exactes — prochaine intervention (à exécuter sous autorisation)

Aucune de ces commandes n'a été exécutée. `PROD_URL` est saisi dans le shell
(lecture silencieuse), jamais écrit dans le dépôt.

```bash
read -rsp 'PROD_URL: ' PROD_URL; export PROD_URL
export PGAPPNAME='jisra-assistant-pilot'
cd docs/assistant/sql && sha256sum -c MANIFEST.sha256      # 4 x OK obligatoire
```

### 10.1 Sauvegardes (§1) puis inventaire

```bash
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c "select count(*) from public.chat_threads;"
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c "select count(*) from public.assistant_requests;" 2>/dev/null || true
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c "select conname, confdeltype from pg_constraint where conrelid in ('public.chat_threads'::regclass) and contype='f';"
psql "$PROD_URL" -v ON_ERROR_STOP=1 -c "select c.conname, c.conrelid::regclass, c.confdeltype from pg_constraint c where c.contype='f' and c.confrelid='public.stores'::regclass order by 2::text;"
```

### 10.2 Migrations, une par une (jamais `-1` : les fichiers gèrent leur transaction)

```bash
psql "$PROD_URL" -v ON_ERROR_STOP=1 -f 01_assistant_privileges.proposed.sql
psql "$PROD_URL" -v ON_ERROR_STOP=1 -f 02_assistant_thread_scope_rls.proposed.sql
psql "$PROD_URL" -v ON_ERROR_STOP=1 -f 03b_assistant_idempotency_registry_v2.proposed.sql
psql "$PROD_URL" -v ON_ERROR_STOP=1 -f 05b_assistant_finalization_v2.proposed.sql
# après chaque fichier : contrôles RUNBOOK.md §4.1 → §4.4, puis
psql "$PROD_URL" -c "notify pgrst, 'reload schema';"
```

### 10.3 Contrôles PostgREST / Auth (lecture seule)

```bash
APP='https://jisra.io'; ANON="$NEXT_PUBLIC_SUPABASE_ANON_KEY"; TOKEN='<jwt session compte autorisé>'
curl -s -o /dev/null -w '%{http_code}\n' "$APP/api/assistant/wallet"                       # 401
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" "$APP/api/assistant/wallet"   # 503 ASSISTANT_DISABLED (code fermé)
curl -s -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  "$SUPABASE_URL/rest/v1/chat_threads?select=id&limit=1"                                   # 200, RLS active
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"thread_id":"00000000-0000-4000-8000-000000000000","role":"assistant","content":"x","credits_used":0}' \
  "$SUPABASE_URL/rest/v1/chat_messages"                                                    # 403/42501 attendu
```

### 10.4 Déploiement fermé puis activation du pilote (Vercel)

```bash
vercel --prod                                    # code fermé (aucune variable assistant)
vercel env add ASSISTANT_BACKEND_WRITES production      # enabled
vercel env add OPENAI_MODEL production                  # gpt-5.4-mini
# après §10.3 réussi uniquement :
vercel env add ASSISTANT_ENABLED production             # enabled
vercel env add ASSISTANT_ALLOWED_USER_IDS production    # <mon UUID>
vercel env add ASSISTANT_IDEMPOTENCY_REGISTRY production # enabled
vercel env add ASSISTANT_FINALIZE_ATOMIC production      # enabled
vercel --prod
```

### 10.5 Fermeture / rollback

```bash
vercel env rm ASSISTANT_ENABLED production --yes && vercel --prod   # fermeture < 5 min
vercel env rm ASSISTANT_CREDIT_RESERVATION production --yes 2>/dev/null || true
vercel env rm ASSISTANT_FINALIZE_ATOMIC production --yes
vercel env rm ASSISTANT_IDEMPOTENCY_REGISTRY production --yes
# SQL : uniquement si nécessaire, ordre 05b → 03b → 02 → 01 (blocs Rollback)
```
