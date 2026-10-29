# RUNBOOK unique — finalisation transactionnelle de l'assistant IA

Statut : **package proposé, non exécuté**. Aucune migration, aucune écriture en
production, aucun déploiement n'a été effectué pour produire ce document.

Ce fichier remplace toutes les procédures éparses des anciennes versions de
`01`/`03`/`05`. En cas de divergence, **ce runbook et les 4 fichiers listés dans
`README.md` font foi**.

---

## 1. Ce que le package garantit, et ce qu'il ne garantit pas

### Garanti par la conception (à confirmer par les tests PostgreSQL)

- une seule finalisation par clé `(user_id, request_id)`, y compris entre instances ;
- messages + journal `ai_usage` + débit + clôture du registre dans **une** transaction ;
- toute exception annule l'ensemble (aucun débit sans réponse, aucune réponse sans trace) ;
- rejeu = lecture du message existant, sans réécriture ni nouveau débit ;
- écritures fiables (`complete`, `finalize`) réservées à `service_role` ;
- ordre de verrouillage unique : `profiles` → `stores` → `chat_threads` →
  `assistant_requests` → `ai_credit_wallets` → écritures ;
- baux évalués à `clock_timestamp()` **après** acquisition des verrous.

### Non garanti (assumé)

- exécution *exactly-once* de l'appel au fournisseur IA (le coût fournisseur peut
  être engagé puis perdu) ;
- réservation de crédits bloquante : `credits_reserved` est **informatif** ;
- rate limit distribué (mémoire de processus) ;
- atomicité de la création de conversation par rapport à la finalisation ;
- politique « crédits insuffisants » telle que décrite au §2 (décision provisoire).

### Décision provisoire — crédits insuffisants

Si le solde est insuffisant au moment du débit : la réponse et le journal d'usage
sont **conservés**, `credits_charged = 0`, `credits_consumed > 0`, registre en
`credit_status = 'insufficient'`. Ce n'est **pas** un « tout ou rien » financier ;
c'est un choix produit provisoire (ne pas détruire une réponse déjà payée au
fournisseur) qui doit être réarbitré avec la facturation. Toute restitution
ultérieure (`credits_consumed` vs `credits_charged`) doit rester visible dans les
rapports.

---

## 2. Préconditions avant toute application

### 2.1 Code

| Précondition | Contrôle |
|---|---|
| Backend `service_role` opérationnel (`SUPABASE_SERVICE_ROLE_KEY`) | `lib/assistant/backend.ts` + `ASSISTANT_BACKEND_WRITES` non `disabled` |
| Écriture `ai_usage` déplacée côté backend | `lib/assistant/finalization.ts` (aucun `input.supabase.from('ai_usage')`) |
| Contrat `begin` à 5 colonnes (`thread_id` inclus) | `lib/assistant/idempotency.ts` |
| `complete` à 7 paramètres | `lib/assistant/idempotency.ts` |
| Version déployée = version auditée (`b6e9a4b` + ce correctif) | `git rev-parse HEAD` |

### 2.2 Environnement

- Environnement **isolé explicitement autorisé** (base distante jetable) pour les
  tests de `postgres-two-connection-tests.sql` ;
- interdits : `supabase db push` depuis ce dossier, Supabase-test, Docker,
  Supabase Local, toute base de production ;
- deux sessions `psql` indépendantes disponibles pour les scénarios concurrents.

### 2.3 Inventaire (lecture seule, à archiver avant migration)

```sql
-- policies et rôles réellement présents
select tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public'
   and tablename in ('chat_threads','chat_messages','ai_usage','ai_credit_wallets')
 order by tablename, policyname;

-- privilèges effectifs
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('chat_threads','chat_messages','ai_usage','ai_credit_wallets','assistant_requests')
 order by table_name, grantee, privilege_type;

-- surcharges déjà présentes (aucune ne doit survivre)
select p.oid::regprocedure, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'rpc_assistant_%'
 order by 1::text;

-- triggers et contraintes des tables concernées
select c.oid::regclass as relation, t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('chat_threads','chat_messages','ai_usage','ai_credit_wallets')
   and not t.tgisinternal;

-- propriétaire des helpers/rpc et capacité de contournement RLS
-- (les fonctions SECURITY DEFINER s'exécutent avec l'identité du propriétaire ;
--  si ce propriétaire n'a ni BYPASSRLS ni superuser, les policies s'appliquent
--  et les fonctions échouent en THREAD_NOT_FOUND / FORBIDDEN_STORE)
select p.proname,
       pg_get_userbyid(p.proowner) as owner,
       r.rolsuper, r.rolbypassrls
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
 where n.nspname = 'public'
   and (p.proname like 'rpc_assistant_%' or p.proname like 'assistant_%');
-- Attendu : owner = rôle des migrations (postgres) avec rolsuper/rolbypassrls = true.
```

### 2.4 Données historiques

| Contrôle | Décision attendue |
|---|---|
| Conversations `store_id IS NULL` | **Reprise AVANT `02`** (le trigger d'immuabilité l'interdit ensuite) ou acceptation explicite de la quarantaine |
| Propriétaires n'ayant plus de droits `owner`/`admin` | acceptation : leur historique devient illisible via PostgREST |
| Doublons `(thread_id, metadata->>'request_id')` | informatif : le registre remplace la clé métadonnée, aucun nettoyage requis |
| Registre `assistant_requests` déjà présent (issu de `03`) | `03b` met à niveau colonnes et contraintes ; vérifier les états incohérents avant |
| Portefeuilles absents / plafonds périmés | `sync_ai_credit_wallet_for_plan` réaligne à la première finalisation |

Requêtes de contrôle :

```sql
select count(*) as threads_without_store from public.chat_threads where store_id is null;

select count(*) as quoted_pairs_without_store_access from (
  select distinct ct.user_id, ct.store_id
    from public.chat_threads ct
   where ct.store_id is null
) q;
```

### 2.5 Sauvegardes

Avant la première migration : export logique de `chat_threads`, `chat_messages`,
`ai_usage`, `ai_credit_wallets` (et `assistant_requests` s'il existe), plus un
`pg_dump --schema-only` du schéma `public`. Conserver la copie des définitions de
fonctions (`pg_get_functiondef`) et des policies d'origine : elles constituent le
seul rollback exact.


---

## 3. Ordre d'application et activation

```
0. gel des écritures assistant (drain des requêtes en cours)
1. 01_assistant_privileges            → contrôles §4.1
2. 02_assistant_thread_scope_rls      → contrôles §4.2
3. 03b_assistant_idempotency_registry → contrôles §4.3
4. 05b_assistant_finalization         → contrôles §4.4
5. vérifier l'exposition PostgREST (schéma rechargé, aucune surcharge)
6. tests PostgreSQL deux connexions (§6) — OBLIGATOIRES avant activation
7. ASSISTANT_IDEMPOTENCY_REGISTRY=enabled + ASSISTANT_FINALIZE_ATOMIC=enabled (ensemble)
8. ouverture des écritures assistant
9. (optionnel, après observation) ASSISTANT_CREDIT_RESERVATION=enabled
```

Règles d'activation :

- **jamais** `ASSISTANT_FINALIZE_ATOMIC` sans `ASSISTANT_IDEMPOTENCY_REGISTRY`
  (`assertAssistantRuntimeFlags` bloque cette combinaison) ;
- **jamais** `ASSISTANT_CREDIT_RESERVATION` sans finalisation atomique ;
- ne pas ouvrir un palier « registre seul + finalisation séquentielle » en le
  présentant comme transactionnel : ce palier n'offre **aucune** garantie
  « au plus une réponse / un débit » ;
- `01` et `02` sont sûres avec le code en place ; `03b`/`05b` exigent le code
  livré avec ce package.

### 3.1 Verrou global et allowlist du pilote privé

Le code refuse **toutes** les routes API assistant tant que la configuration
suivante n'est pas explicite (fail-closed, contrôle serveur) :

| Variable | Valeur d'ouverture | Effet si absente/incorrecte |
|---|---|---|
| `ASSISTANT_ENABLED` | `enabled` (valeur exacte) | `503 ASSISTANT_DISABLED` |
| `ASSISTANT_ALLOWED_USER_IDS` | UUID exacts, séparés par virgules | `403 ASSISTANT_NOT_ALLOWED` (aucun UUID par défaut) |
| `ASSISTANT_IDEMPOTENCY_REGISTRY` | `enabled` | `503 ASSISTANT_PILOT_CONFIG_INCOMPLETE` |
| `ASSISTANT_FINALIZE_ATOMIC` | `enabled` | `503 ASSISTANT_PILOT_CONFIG_INCOMPLETE` |

- l'identité provient uniquement de `supabase.auth.getUser()` côté serveur ;
- toutes les routes (`/api/assistant/chat`, `/threads`, `/threads/[id]`,
  `/threads/[id]/messages`, `/wallet`) appliquent ce contrôle **avant** toute
  lecture de données, réservation, débit ou appel IA ;
- le pilote interdit le chemin de finalisation séquentiel
  (`assertAtomicFinalizationRequired`), même si le drapeau atomique est retiré ;
- procédure complète : [`../PILOT-PRIVATE-RUNBOOK.md`](../PILOT-PRIVATE-RUNBOOK.md).

---

## 4. Contrôles après chaque étape

### 4.1 Après `01`

```sql
select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('chat_threads','chat_messages','ai_usage','ai_credit_wallets')
   and grantee in ('anon','authenticated','PUBLIC','service_role')
 order by table_name, grantee, privilege_type;
```

Attendu : aucun privilège `anon`/`PUBLIC` ; `authenticated` sans `TRUNCATE`,
`REFERENCES`, `TRIGGER` ; `ai_usage` et `ai_credit_wallets` en `SELECT` seul ;
`chat_messages` en `SELECT, INSERT` seulement.

```sql
select tablename, policyname, roles, cmd
  from pg_policies
 where schemaname = 'public'
   and tablename in ('chat_threads','chat_messages','ai_usage')
 order by tablename, policyname;
```

Attendu : aucune policy dont `roles` contient `public`/`anon`.

### 4.2 Après `02`

```sql
select p.oid::regprocedure, p.prosecdef,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'assistant_%'
 order by 1::text;
```

Attendu : `prosecdef = true`, `anon_exec = false`, seul
`assistant_can_read_thread(uuid)` exécutable par `authenticated`.

Contrôle fonctionnel (données synthétiques, environnement isolé) : scénarios
`R1`–`R6` de `postgres-two-connection-tests.sql`.

Non-régression Dashboard/Sales (lecture seule) :

```sql
select p.oid::regprocedure
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'rpc_dashboard_kpi_reader_v2',
     'rpc_dashboard_confirmation_counters',
     'rpc_dashboard_confirmation_performance',
     'rpc_dashboard_city_performance',
     'can_view_store_finances'
   )
 order by 1::text;
```

Aucun de ces objets ne doit être modifié par `01`/`02`/`03b`/`05b`.

### 4.3 Après `03b`

```sql
select p.oid::regprocedure, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'rpc_assistant_%'
 order by 1::text;

select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'rpc_assistant_complete_request';
-- attendu : 1
```

Attendu :

| Fonction | `authenticated` | `service_role` | `anon`/`PUBLIC` |
|---|---|---|---|
| `begin`, `bind`, `fail`, `reserve`, `release` | EXECUTE | — | non |
| `complete`, `finalize` | **non** | EXECUTE | non |

### 4.4 Après `05b`

```sql
select has_function_privilege('authenticated',
  'public.rpc_assistant_finalize_request(uuid,uuid,text,text,uuid,uuid,text,text,text,jsonb,integer,jsonb,text)',
  'EXECUTE') as authenticated_can_finalize;   -- attendu : false
select has_function_privilege('service_role',
  'public.rpc_assistant_finalize_request(uuid,uuid,text,text,uuid,uuid,text,text,text,jsonb,integer,jsonb,text)',
  'EXECUTE') as service_can_finalize;         -- attendu : true
```

Après activation, en lecture seule :

```sql
select credit_status, count(*) as requests,
       sum(credits_reserved) as reserved,
       sum(credits_consumed) as consumed,
       sum(credits_charged) as charged
  from public.assistant_requests
 where state = 'completed'
 group by credit_status;
```

Invariant : `credits_charged <= credits_consumed` par ligne ; l'écart total
correspond aux réponses conservées sans débit (`insufficient`).

---

## 5. Matrice PASS/FAIL

### 5.1 Revue statique (faite, non suffisante)

| Contrôle | Résultat |
|---|---|
| `begin` renvoie `thread_id` (rejeu d'une première question) | **PASS** (S01, T01) |
| Baux à `clock_timestamp()` après verrous, jamais `now()` | **PASS** (S02) |
| `finalize`/`complete` réservés à `service_role` | **PASS** (S03, S07) |
| Aucune surcharge héritée (drop avant création) | **PASS** (S04) |
| Policies rejouables | **PASS** (S05) |
| Rôles SQL alignés sur `ai_assistant.use` | **PASS** (S06) |
| `ai_usage` écrit par le backend seul | **PASS** (S08, T11) |
| Ordre de verrouillage unique | **PASS** (S09) |
| Pas de création de table de base | **PASS** (S11) |
| Route : pas d'atomicité affirmée sur rejeu, solde = débit réel | **PASS** (S12) |
| Consommation vs débit distingués | **PASS** (T06–T08, T11–T12) |
| Insuffisant : réponse conservée, débit nul | **PASS** (T07, T12) |
| Rejeu sans nouveau débit | **PASS** (T08) |
| Erreur RPC sans repli séquentiel | **PASS** (T09) |
| Révocation / baux / deadlocks (SQL réel) | **NON EXÉCUTÉ** |
| Atomicité réelle + rollback tardif | **NON EXÉCUTÉ** |
| PostgREST (RLS et grants effectifs) | **NON EXÉCUTÉ** |
| Non-régression Dashboard/Sales | **NON EXÉCUTÉ** (aucune modification attendue) |

### 5.2 Validation transactionnelle

**NON PRONONCÉE.** Aucun PASS transactionnel ne peut être déclaré avant
l'exécution de `postgres-two-connection-tests.sql` dans un environnement isolé
autorisé, avec preuves archivées.

---

## 6. Tests PostgreSQL à deux connexions

Paquet d'exécution : **`neon-audit/`** (voir `neon-audit/PROTOCOL.md`).

Ancien fichier `postgres-two-connection-tests.sql` : **remplacé** (orchestration
manuelle, timeouts incompatibles, fixtures incomplètes, R9/R10/R12 non
concluants). Conservé pour historique, ne pas exécuter.

| # | Scénario | Résultat attendu |
|---|---|---|
| R1 | Première acquisition commitée | une ligne, jeton non nul |
| R2 | Même clé concurrente (A verrouille, B attend) | B : `55P03` puis `IDEMPOTENCY_IN_PROGRESS`, un seul titulaire |
| R3 | Empreinte différente, même clé | `IDEMPOTENCY_CONFLICT`, aucune mutation |
| R4 | Expiration du bail puis reprise B | nouveau jeton ; ancien refusé |
| R5 | Bail expirant pendant l'attente d'un verrou | reprise réelle (horloge `clock_timestamp`) |
| R6 | Finalisation concurrente identique | un seul débit ; second appel `replayed` |
| R7 | Rejeu d'une première question sans `thread_id` | conversation retrouvée via `begin` |
| R8 | Crash (transaction interrompue) | aucun effet partiel |
| R9 | Révocation avant finalisation | `FORBIDDEN_STORE` |
| R10 | Journal d'usage invalide | `INVALID_USAGE` + rollback complet |
| R11 | Écriture `ai_usage` depuis `authenticated` | `42501` |
| R12 | Suppression de conversation concurrente | aucune fuite ; débit conservé |
| R13 | **Échec tardif après débit** | rollback complet, puis reprise = un seul débit |
| R14 | Changement d'offre | plafond resynchronisé, débit nul |
| S1 | Insuffisant : deux requêtes, même portefeuille | aucun dépassement, `credits_charged = 0` |

Chaque scénario exige `SQLSTATE`, message et compteurs avant/après
(`chat_messages`, `ai_usage`, `ai_credit_wallets`, `assistant_requests`).

---

## 7. Rollback

### 7.1 Déclencheurs

doublon de réponse ou de débit ; `credits_charged > credits_consumed` ; accès
PostgREST inattendu ; deadlock récurrent ; régression d'une RPC partagée ;
erreur de contrat PostgREST ; blocage d'écriture assistant.

### 7.2 Procédure

1. **Désactiver d'abord les drapeaux**, dans l'ordre inverse de l'activation :
   `ASSISTANT_CREDIT_RESERVATION` off → `ASSISTANT_FINALIZE_ATOMIC` off →
   `ASSISTANT_IDEMPOTENCY_REGISTRY` off.
2. Geler les écritures assistant et drainer les transactions actives.
3. **Conserver** `assistant_requests`, `chat_messages`, `ai_usage`,
   `ai_credit_wallets` : ce sont les preuves. Aucune suppression de table.
4. Corriger en avant si possible (`01`/`02` restent compatibles avec le code
   séquentiel).
5. Retrait SQL seulement si nécessaire, ordre des dépendances :
   `05b` → `03b` → `02` → `01` (les blocs « Rollback » de chaque fichier
   contiennent les `drop` exacts).
6. Restaurer définitions et policies depuis la sauvegarde §2.5.
7. Ne jamais réaccorder `ALL` à `anon`, ni rétablir l'insertion client de
   `ai_usage`/messages `assistant` sans décision explicite documentée.
8. Toute compensation de crédits est une réconciliation approuvée, jamais un
   remboursement automatique.

### 7.3 Points de non-retour

- `02` refuse ensuite toute modification de `store_id` (trigger) : la reprise des
  conversations orphelines doit précéder.
- `03b` ne supprime pas la table au rollback : un rejeu reste possible après
  réactivation.

---

## 8. Critères GO / NO-GO

### GO si — et seulement si

- [ ] préconditions §2 satisfaites et archivées ;
- [ ] préchecks §4.1–4.4 PASS sur l'environnement cible ;
- [ ] scénarios R1–R12 + S1 PASS **exécutés** (pas déduits) ;
- [ ] preuve de rollback tardif (erreur après débit) ;
- [ ] aucune surcharge `rpc_assistant_*` résiduelle ;
- [ ] non-régression Dashboard/Sales vérifiée ;
- [ ] décision « crédits insuffisants » validée par le propriétaire ;
- [ ] rollback §7 testé au moins une fois.

### NO-GO si

- un seul scénario concurrent échoue ;
- un débit sans réponse ou une réponse sans trace est observé ;
- un accès PostgREST non prévu subsiste ;
- une RPC partagée change de signature ou de sémantique ;
- la sauvegarde ou la procédure de rollback est indisponible.

### Autorisations nécessaires avant exécution

1. Base PostgreSQL distante jetable : hôte, nom, propriétaire, fenêtre horaire.
2. Création de comptes/boutiques/conversations/portefeuilles **synthétiques**.
3. Deux connexions simultanées et simulation contrôlée des rôles (JWT).
4. Transactions commitables dans cette base (scénarios concurrents).
5. Injection d'erreur contrôlée (trigger temporaire) et interruption de session.
6. Accès PostgREST isolé pour vérifier RLS et grants.
7. Destruction finale de l'environnement et archivage des preuves.
8. Validation explicite du propriétaire avant application en production.

---

## 9. Risques nécessitant encore une validation PostgreSQL réelle

1. **Atomicité effective** des quatre écritures et rollback après débit
   (injection d'erreur tardive).
2. **Baux sous attente de verrou** : `clock_timestamp()` est correct par
   conception, la frontière exacte doit être prouvée par R5.
3. **Deadlocks** : l'ordre `profiles → stores → chat_threads → registre →
   portefeuille` réduit les cycles, il ne les élimine pas (cascades de
   suppression de compte/boutique/conversation).
4. **Sérialisation des révocations** : aucun verrou commun avec
   `store_members`. Garantie testable = « droits appréciés au point de
   contrôle », pas « toute révocation antérieure bloque ».
5. **`SECURITY DEFINER` / `search_path`** : dépend du propriétaire réel des
   fonctions et des privilèges de création dans `public` (inconnus hors base).
6. **Policies permissives résiduelles** : le retrait par nom ne prouve pas
   l'absence d'une policy supplémentaire ; l'inventaire §2.3 est obligatoire.
7. **PostgREST** : cache de schéma, exposition des surcharges, comportement des
   `RETURNS TABLE` modifiés.
8. **Alignement des rôles** : `assistant_has_full_finances` duplique
   `can_view_store_finances` ; une divergence future doit être détectée par le
   contrôle §4.2.
9. **Performance** : verrous de conversation et de portefeuille sous charge ;
   coût du `FOR KEY SHARE` sur `profiles`/`stores`.
10. **Politique crédits insuffisants** : aucune preuve comptable tant que la
    facturation n'a pas arbitré la conservation des réponses non débitées.

---

## 10. Préservation Dashboard / Sales

Aucune RPC partagée n'est modifiée :

- `rpc_dashboard_kpi_reader_v2`
- `rpc_dashboard_confirmation_counters`
- `rpc_dashboard_confirmation_performance`
- `rpc_dashboard_city_performance`
- `can_view_store_finances` (seulement **répliquée** dans un helper assistant,
  jamais redéfinie)

Aucune table métier (`orders`, `order_items`, `products`, tables KPI) n'est
touchée. Contrôle obligatoire avant/après : signatures et définitions §4.2, puis
lecture comparée des mêmes périodes synthétiques pour owner/admin/viewer/membre
révoqué.
