# Protocole d'exécution — validation transactionnelle sur PostgreSQL distant jetable

Statut : **préparé, non exécuté**. Aucun projet, aucune base, aucun rôle distant
n'a été créé ; aucun SQL n'a été exécuté ; aucun push.

Référence auditée : branche `audit/assistant-neon-tx` (empilement de
`fix/assistant-tx-validated`, commit `bafe7aa`).

---

## 1. Périmètre

| Validé par ce protocole | Non validé |
|---|---|
| transactions, verrous, baux, fencing token | authentification HTTP Supabase |
| atomicité messages + journal + débit + registre | cache de schéma / routage PostgREST |
| rollback après débit effectué | application Next.js, fournisseur IA |
| RLS et privilèges sous rôles **simulés** | quotas réels Supabase, facturation |

---

## 2. Contrôles d'identité de la cible (bloquants)

Exécutés par `sql/00_preflight.sql`, avant toute écriture :

| Contrôle | Exigence | Échec ⇒ |
|---|---|---|
| Nom de base | = `AUDIT_DB`, et ne contient ni `prod`, ni `jisra-test`, ni `goqedvcdmgtejtyrawsp`, ni `supabase` | NO-GO immédiat |
| `AUDIT_ENV` | `neon-audit` | NO-GO |
| Endpoint **direct** | `PGHOST` renseigné et **sans** `-pooler` | NO-GO (verrous de session non fiables) |
| Session épinglée | *informatif* : même `pg_backend_pid()` sur deux transactions | aucune décision (non discriminant chez Neon) |
| TLS | `sslmode=verify-full` + CA lisible, **et** `openssl s_client -starttls postgres` : chaîne + nom d'hôte vérifiés | NO-GO |
| Version PostgreSQL | `server_version_num >= 130000`, **même majeure que la source du schéma** | NO-GO |
| Rôles | `anon`, `authenticated`, `service_role` présents | NO-GO |
| `auth.uid()` | une fonction `auth.uid()` | NO-GO |
| Propriétaire | `rolsuper` ou `rolbypassrls` | NO-GO (SECURITY DEFINER bloqués par RLS) |
| Base vide | `orders`, `chat_*`, `ai_usage`, `assistant_requests` = 0 ligne | NO-GO (donnée métier présente) |

Les deux derniers contrôles de rôle/`auth.uid()` sont exécutés par
`20_verify_schema_ready.sql`, après `05_auth_shim.sql` qui les crée.

Aucun credential de production ne doit être présent dans l'environnement
d'exécution : seuls `AUDIT_URL` / `AUDIT_DB` / `AUDIT_ENV` / `PGHOST` sont utilisés.

---

## 3. Séquence d'exécution

```bash
# 0. (hors dépôt) variables + prévalidation de connexion, LECTURE SEULE
source ~/jisra-audit/env.local       # AUDIT_URL, AUDIT_DB, AUDIT_ENV, PGHOST…
bash docs/assistant/sql/neon-audit/connection/check_connection.sh   # doit finir OK

# 1. prévol + rôles + harnais + vérification du schéma
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/sql/00_preflight.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/sql/05_auth_shim.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/sql/10_bootstrap_audit.sql
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/sql/20_verify_schema_ready.sql

# 2. données synthétiques
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/sql/30_fixtures.sql

# 3. scénarios séquentiels
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f docs/assistant/sql/neon-audit/scenarios/sequential.sql

# 4. concurrence (A d'abord, B 3 s après)
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f .../scenarios/concurrent_a.sql &
sleep 3
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f .../scenarios/concurrent_b.sql &
wait

# 5. bail expirant pendant l'attente (≈130 s)
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f .../scenarios/lease_a.sql &
sleep 3
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f .../scenarios/lease_b.sql &
wait

# 6. invariants, réconciliation, verdict
psql "$AUDIT_URL" -v ON_ERROR_STOP=1 -f .../sql/90_assertions.sql

# 7. archivage puis nettoyage
psql "$AUDIT_URL" -f .../sql/99_cleanup.sql
```

Le script `run/run_audit.sh` enchaîne ces étapes et archive les logs.
Durée attendue : **4 à 6 minutes**, dominée par le scénario R5 (130 s).

### Orchestration A/B — pourquoi elle est déterministe

- A verrouille **trois barrières `pg_advisory_lock`** avant toute scène ;
- chaque `pg_advisory_unlock` ouvre une scène **après** que A a acquis le verrou
  de ligne concerné ;
- B attend la barrière : il ne peut pas exécuter une scène en avance ;
- la preuve de contention est `lock_timeout = 4s` ⇒ SQLSTATE **55P03**, pas une
  mesure de durée ;
- A attend 8 s avant `COMMIT` pour laisser B constater le blocage.

Un `55P03` attendu qui ne survient pas est enregistré **FAIL**, jamais « PASS
implicite » : c'est un défaut d'orchestration, pas une preuve de sécurité.

---

## 4. Matrice PASS/FAIL

| Cas | Scénario | Critère PASS |
|---|---|---|
| R1 | première acquisition | `in_progress`, jeton émis, conversation liée, `not_charged` |
| R2 | même clé concurrente | B : **55P03** puis **P0001/IDEMPOTENCY_IN_PROGRESS** ; une seule ligne |
| R3 | empreinte différente | `P0001/IDEMPOTENCY_CONFLICT` ; jeton inchangé |
| R4 | bail expiré + reprise | jeton **rotaté** ; ancien jeton refusé (`IDEMPOTENCY_TOKEN_MISMATCH`) |
| R5 | bail expirant pendant l'attente | B **reprend** (`in_progress`, nouveau jeton) ; A constate la substitution |
| R6 | finalisation concurrente | B bloqué (**55P03**) puis `replayed = true`, aucun second débit |
| R7 | rejeu sans `thread_id` | `completed` + `thread_id` restitué, statut de débit conservé |
| R8 | interruption avant COMMIT | aucune ligne de registre |
| R9 | révocation avant finalisation | `FORBIDDEN_STORE`, aucun message |
| R10 | journal invalide | `P0001/INVALID_USAGE`, messages/usage/titre/portefeuille intacts |
| R11 | `ai_usage` par `authenticated` | **42501** |
| R12 | suppression concurrente | B bloqué (**55P03**) puis suppression OK ; aucun orphelin ; débit conservé |
| R13 | **rollback après débit** | erreur **après** débit ⇒ portefeuille, messages, usage et registre intacts ; reprise ensuite = un seul débit |
| R14 | changement d'offre | plafond synchronisé (0), statut `insufficient`, débit nul |
| S1 | crédits insuffisants | `insufficient`, `consumed = 2`, `charged = 0`, réponse conservée |
| I01–I08 | invariants finaux | `charged ≤ consumed`, clé unique, compteurs ≥ 0, bail borné, quota respecté, R12 cohérent |

**Verdict global** : `GO` seulement si `audit.results` ne contient aucun `FAIL`.
Un cas non exécuté n'est pas un PASS : il doit apparaître absent du rapport, ce
qui interdit le GO (total attendu = nombre de cas déclarés).

### Ce qui invalide la campagne

- prévol non PASS ;
- préparation des scripts interrompue (un fichier non exécuté) ;
- `55P03` non observé sur R2/R6/R12 ;
- fixture créée sur une base contenant des données métier ;
- erreur inattendue capturée comme `PASS` (jamais : seul le SQLSTATE attendu vaut PASS).

---

## 5. Mesures de sécurité

1. **Isolation** : projet PostgreSQL dédié à cet audit ; aucun service Jisra ne
   pointe vers cette base ; aucun fournisseur IA, aucune clé réelle.
2. **Cible vérifiée** : garde de nom + TLS + version + base vide (§2).
3. **Écritures** : uniquement les 5 UUID synthétiques + le schéma `audit`.
   `99_cleanup.sql` remet les compteurs à zéro.
4. **Pas de secret dans le dépôt** : `run/env.example` ne contient que des
   placeholders ; `env.local` reste hors dépôt.
5. **Pas d'accès production** : toutes les commandes utilisent `$AUDIT_URL`.
   L'export structurel (§6 DEPENDENCIES) est une opération distincte, autorisée
   séparément, en lecture seule.
6. **Traçabilité** : logs par scénario + `results.csv` archivés avant nettoyage.
7. **Réversibilité** : base jetable ; au pire, suppression du projet entier.

---

## 6. Nettoyage

| Étape | Commande | Effet |
|---|---|---|
| 1. Archiver | `\copy … to results.csv` (fait par le runner) | preuves conservées |
| 2. Désactiver l'injection | inclus dans `99_cleanup.sql` | trigger d'audit supprimé |
| 3. Supprimer fixtures + harnais | `psql "$AUDIT_URL" -f sql/99_cleanup.sql` | tables métier vides, schéma `audit` supprimé |
| 4. Fermer les sessions | `\q` sur A et B | verrous libérés |
| 5. Supprimer le projet distant | console du fournisseur | **destruction définitive**, autorisation requise |
| 6. Révoquer les credentials | rotation/suppression du mot de passe | aucune clé résiduelle |
| 7. Vérifier | `psql` impossible sur l'ancienne URL | extinction confirmée |

---

## 7. Opérations nécessitant votre autorisation

1. Créer le projet PostgreSQL distant (offre gratuite) et son rôle/mot de passe.
2. Choisir la source de schéma :
   - fournir un export structurel existant, **ou**
   - autoriser la commande `pg_dump` de `DEPENDENCIES.md §6` (lecture seule prod).
3. Restaurer le schéma et appliquer `01 → 02 → 03b → 05b` **dans la base jetable**.
4. Exécuter les fixtures et les scénarios d'écriture synthétique.
5. Injecter l'erreur tardive (trigger d'audit) et interrompre une session.
6. Archiver les preuves hors dépôt (`logs/`, `results.csv`).
7. **Détruire** le projet distant et révoquer les credentials.

Tant que ces points ne sont pas accordés, la campagne reste **NO-GO** et aucune
validation transactionnelle n'est déclarée.
