# Lot 1 — Contrats de sécurité de l'assistant IA

Statut : **appliqué dans le code** (branche `feat/assistant-security`), migrations SQL **proposées et non exécutées**.
Périmètre : `app/api/assistant/**`, `app/(app)/ai-assistant/page.tsx`, `lib/assistant/{security,chat,credits,rate-limit}.ts`, garde-fous de `lib/assistant/agent/index.ts`.

> `lib/assistant/analytics.ts`, `lib/assistant/agent/tools.ts` et le lecteur KPI V5 **ne sont pas modifiés** par ce lot.

## 1. Matrice d'accès (côté serveur, source de vérité)

| Route | Authentification | `ai_assistant.use` | Niveau financier | Portée boutique |
|---|---|---|---|---|
| `POST /api/assistant/chat` | oui | requis | `full` requis | 1 boutique, explicite |
| `GET /api/assistant/threads` | oui | requis | `full` requis | 1 boutique |
| `POST /api/assistant/threads` | oui | requis | `full` requis | 1 boutique (liaison forcée) |
| `PATCH/DELETE /api/assistant/threads/:id` | oui | requis | non requis | boutique de la conversation |
| `GET /api/assistant/threads/:id/messages` | oui | requis | `full` requis | boutique de la conversation |
| `GET /api/assistant/wallet` | oui | requis | non requis | aucune donnée métier |

Niveau financier résolu par la base (`can_view_store_finances`, `SECURITY DEFINER`, `auth.uid()`) avec repli local strictement identique :

| Rôle | `ai_assistant.use` | Niveau financier | Chat | Historique | Wallet |
|---|---|---|---|---|---|
| owner / admin | oui | `full` | oui | oui | oui |
| accountant | **non** | `full` | non (`FORBIDDEN_PERMISSION`) | non | non |
| viewer | oui | `commercial` | non (`FORBIDDEN_FINANCIAL_SCOPE`) | non | oui |
| marketer | non | `commercial` | non | non | non |
| confirmation / delivery / stock_manager | non | `none` | non | non | non |

**Restriction assumée du Lot 1** : le chat et la lecture d'historique exigent `full`, car les outils renvoient coûts, marges et profits. Les profils `commercial` seront réactivés par le Lot 2 (contrat §3), sans relâchement de la sécurité.

## 2. Garanties réelles : rate limit et idempotence

### 2.1 Rate limit (`lib/assistant/rate-limit.ts`)

- Fenêtre glissante : **20 requêtes / 60 s / utilisateur** ; une seconde requête simultanée du même utilisateur est refusée (`CONCURRENT_REQUEST`, 429).
- Portée : **mémoire du processus**. Sur Vercel, chaque instance a son propre compteur : la garantie réelle est `N instances × 20 req/min`, pas 20 req/min global.
- Ce que cela garantit : blocage du double clic, du double onglet et du spam mono-instance ; protection du budget IA et du Disk I/O Supabase contre les rafales locales.
- Ce que cela ne garantit pas : quota global multi-instances, protection contre un client distribué, persistance au redémarrage.
- Éviction mémoire : plafond 2 000 utilisateurs suivis ; les entrées avec requête en cours ne sont pas évincées (sauf saturation anormale), afin de ne jamais perdre un verrou de facturation.
- Vérifié en exécution réelle (`node` + assertions) : 20 séquentielles acceptées, 21ᵉ refusée, concurrence bloquée, indépendance entre utilisateurs, expiration de fenêtre, survie du verrou sous pression d'éviction → **8/8 PASS**.

### 2.2 Idempotence (`requestId`)

- Clé générée côté client (`crypto.randomUUID()`) et transmise dans le corps.
- Stockage **sans schéma supplémentaire** : `chat_messages.metadata.request_id`, sur le message utilisateur **et** sur la réponse assistant.
- Rejeu : si une réponse assistant porte déjà ce `request_id` dans la conversation, elle est renvoyée telle quelle (`replayed: true`, `credit_status: 'not_charged'`) **sans appel IA ni débit**.
- Périmètre : par conversation. Un même `requestId` sur une autre conversation n'est pas un rejeu (choix explicite, la clé n'est pas globale).
- Limite réelle : la détection n'est fiable qu'**après** persistance de la réponse. Deux instances traitant le *même* `requestId` en parallèle (retry réseau immédiat, mise à l'échelle horizontale) peuvent toutes deux appeler le modèle et facturer. Le verrou en mémoire ne couvre qu'une instance. Correctif prévu : index unique partiel `(thread_id, metadata->>'request_id')` (§4.3), qui exige un traitement du code 23505 côté route.
- `requestId` reste optionnel pour compatibilité ; le client Jisra l'envoie systématiquement.

### 2.3 Crédits

- Pré-contrôle avant l'appel (`ensureCreditsAvailable` + estimation message + historique + réserve outils 1 500 tokens).
- Débit **atomique** en base (`rpc_debit_ai_credits`, verrou de ligne), après persistance de la réponse.
- Conséquence assumée : en cas d'échec du débit, la réponse est conservée et `credit_status` expose `insufficient`/`failed` ; le système ne **surfacture jamais** un utilisateur (le débit est refusé si le solde est insuffisant).
- `ai_usage` : journalisation best-effort ; un échec produit un avertissement visible, jamais une erreur silencieuse.

## 3. Contrat à transmettre au moteur analytique (Agent 2)

### 3.1 Disponibilité des données (obligatoire)

Chaque outil doit renvoyer un indicateur explicite de disponibilité et **ne jamais substituer `0` à une donnée absente** :

```ts
type ToolAvailability = 'complete' | 'partial' | 'unavailable' | 'forbidden'

interface ToolEnvelope<T> {
  available: boolean            // false => donnée non calculable
  availability: ToolAvailability
  reason?: string               // 'no_data' | 'not_authorized' | 'not_computed' | ...
  period: { from: string; to: string; timezone: string }
  currency?: string
  definitionVersion: string     // version du calcul métier
  coverage?: { days: number; missingDays: number }
  data: T
}
```

Règles :

1. `available: false` ⇒ tous les champs numériques dérivés restent `null` ; le prompt ne doit pas en déduire une valeur nulle.
2. `forbidden` ⇒ l'outil n'est pas exécuté ; la réponse explique l'absence d'autorisation, sans chiffre.
3. Aucun total partiel présenté comme complet : `coverage` doit accompagner toute agrégation susceptible d'être tronquée.
4. Aucune devise mélangée : `currency` obligatoire pour tout montant ; pas d'agrégation multidevise implicite.

### 3.2 Classification financière des outils (obligatoire pour le mode `commercial`)

| Niveau requis | Outils (noms actuels) |
|---|---|
| `commercial` | volumes/statuts de commandes, chiffre d'affaires, publicité (`getAdsSpend`, `getAdsPerformanceByCampaign`), stock, livraison, produits (CA uniquement) |
| `full` | `getProfitSummary`, `getTopProducts` (profit), `getExpensesByCategory`, `getSupplierSummary`, `getCityPerformance` (profit), `getProductPerformance` (marge), `getConfirmationPerformance` (CA + coûts) |

Exigences pour lever la restriction `full` :

- chaque outil déclare son niveau (`financialLevel: 'commercial' | 'full'`) ;
- en mode `commercial`, les champs `purchaseCost`, `deliveryCost`, `confirmationCost`, `adsCost`, `profit`, `marginRate`, `supplierBalance` sont **supprimés** de la charge utile (pas mis à zéro) ;
- le prompt système interdit d'inférer un coût ou une marge absents ;
- l'orchestrateur ne planifie que les outils du niveau autorisé ;
- l'historique déjà stocké reste illisible pour un profil `commercial` tant que la rédaction rétroactive n'existe pas.

Tant que ces cinq points ne sont pas livrés et testés, **aucun relâchement** du gate `full` ne doit être appliqué (le contrat prime sur la fonctionnalité).

### 3.3 Compatibilité ascendante

- Les signatures d'`analytics.ts` et `tools.ts` peuvent évoluer librement tant que les routes n'y accèdent que via `runSecureAssistantAgent`.
- `runSecureAssistantAgent` reste le seul point d'entrée du moteur ; les garde-fous du Lot 1 (allowlist d'outils, absence de faux zéro) y sont appliqués et ne doivent pas être contournés par un nouvel appel direct.

## 4. Risques résiduels et remédiations proposées

| # | Risque | Impact | Statut | Remédiation |
|---|---|---|---|---|
| R1 | `anon` et `authenticated` possèdent `TRUNCATE`/`REFERENCES`/`TRIGGER` sur `chat_threads`, `chat_messages`, `ai_usage` ; `TRUNCATE` n'est pas protégé par RLS | Élevé (perte de données hors RLS) | Ouvert | `sql/01` (non exécuté) |
| R2 | Policies accordées au rôle `public` (inclut `anon`) | Moyen (surface inutile) | Ouvert | `sql/01` |
| R3 | Un message `assistant`/`system` peut être inséré par le propriétaire du thread | Moyen (intégrité de l'historique) | Ouvert | `sql/01` bloc B (impact code) |
| R4 | RLS de lecture des conversations ne vérifie pas l'accès courant à la boutique | Élevé après révocation (PostgREST direct) | Couvert côté API, ouvert côté base | `sql/02` |
| R5 | Course inter-instances sur `requestId` (§2.2) | Moyen (double facturation) | Ouvert | `sql/03` + traitement 23505 |
| R6 | 13 conversations sur 26 ont `store_id = NULL` (orphelines après suppression de boutique) | Moyen (portée ambiguë) | Documenté | `sql/04` (revue, non exécuté) |
| R7 | Rate limit non distribué | Moyen | Documenté | Limiteur Postgres/Upstash (Lot 5) |
| R8 | `withTimeout` n'annule pas l'appel fournisseur sous-jacent | Faible (coût résiduel) | Documenté | AbortSignal dans les providers (Lot 3) |

### 4.1 Contrôles de préparation (lecture seule, production)

| Mesure | Valeur observée | Conséquence |
|---|---|---|
| Doublons `(thread_id, metadata->>'request_id')` sur les réponses assistant | **0** | `sql/03` peut être créé sans échec de contrainte |
| Réponses assistant portant déjà `request_id` | **0** | métadonnée introduite par ce lot, pas encore en production |
| Conversations `store_id IS NULL` | **13 / 26** | portée métier ambiguë (R6) |
| Conversations sans aucune boutique accessible à leur propriétaire | **0** | R6 se limite à l'ambiguïté de portée, pas à un accès résiduel |

## 5. Verdict PASS/FAIL

| Contrôle | Résultat |
|---|---|
| Permission `ai_assistant.use` appliquée côté serveur (toutes les routes) | **PASS** |
| Niveau financier `full` exigé pour chat, liste, création et lecture d'historique | **PASS** |
| Aucune route assistant n'expose coût/marge/profit à un profil `commercial` | **PASS** (refus 403) |
| Historique relisible après rétrogradation de rôle | **PASS** côté API — **FAIL** côté PostgREST direct (R4) |
| Isolation mono-boutique, conversation liée à sa boutique | **PASS** |
| Faux KPI à zéro | **PASS** (absence ⇒ `null`) |
| Validation d'entrée, taille, origine, timeout, erreurs contrôlées | **PASS** |
| Codes d'erreur levés → tous mappés vers un libellé public | **PASS** (après ajout de `THREAD_TOUCH_FAILED`) |
| Rate limit et verrou de concurrence (exécution réelle) | **PASS** (8/8) |
| Idempotence mono-instance | **PASS** — inter-instances **FAIL** (R5) |
| TypeScript `tsc --noEmit` | **PASS** |
| ESLint fichiers modifiés | **PASS** (0 nouvelle anomalie) |
| Tests runtime authentifiés / production | **NON EXÉCUTÉS** (interdits) |

