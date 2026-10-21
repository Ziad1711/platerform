# P8.1 — Rapport de préparation : invitations inter-boutiques

**Date :** 21/10/2026 — **Mode :** ACT, préparation seule.
**Aucune écriture Supabase, aucune migration appliquée, aucun déploiement, push ou commit.**

## 1. Identité vérifiée

| Élément | Valeur constatée |
|---|---|
| Projet MCP autorisé | `supabase-test` → `jisra-test`, `goqedvcdmgtejtyrawsp`, PostgreSQL 17.11, `ACTIVE_HEALTHY` |
| Dépôt | `C:\Users\HP-EXE\Documents\erp ecom\jisra-kpi-v5-consolidated` |
| Branche / HEAD | `p79/kpi-v5-consolidated` / `3bcf716` — arbre propre |

## 2. Blocage : étape 1 non couverte

Le MCP autorisé `supabase-test` n'expose **aucun outil d'exécution SQL** (uniquement gestion de projet : `list_projects`, `get_project`, coûts, pause/restore). Il est donc **impossible de relever sur TEST** les définitions installées (`pg_get_functiondef`, `pg_policies`, ACL, triggers) ni l'inventaire des invitations `pending`.

Conséquence : **les étapes 1, 2 et 4 du brief sont NOT COVERED**. Aucune preuve d'état installé n'existe à ce stade. L'étape 9 est couverte **statiquement** : la migration ne modifie ni les huit rôles ni les permissions métier. Le paquet est prêt à être exécuté dès qu'un accès SQL **en lecture seule** sur `goqedvcdmgtejtyrawsp` est fourni.

**Divulgation :** avant la restriction d'environnements, deux relevés en lecture seule ont été effectués sur des projets non autorisés (`attvfeoqgbxsnnsllatt` et un projet P7). Aucune écriture. Ces relevés **ne sont pas utilisés comme preuve TEST** ; ils ne servent qu'à signaler le risque de dérive ci-dessous, à reconfirmer sur TEST.

## 3. Cause potentielle (deux niveaux)

1. **Politique d'affectation** — une politique `INSERT` sur `team_invitation_assignments` dont le `WITH CHECK` ne teste que `invited_by` permet, en théorie, de rattacher une affectation à n'importe quelle boutique, avec n'importe quel rôle.
2. **RPC d'acceptation** — `accept_team_invitation` est `SECURITY DEFINER` et ne revérifie jamais le droit **actuel** de l'invitant : toute affectation persistée produit une appartenance, y compris si l'invitant a été rétrogradé ou révoqué.

**Exploitabilité non prouvée.** Le `EXISTS` de la politique s'exécute sous RLS : si `team_invitations` n'expose aucune politique `SELECT` pour l'appelant, il renvoie faux et la voie est *fail-closed*. C'est exactement ce que T1/T2 doivent trancher.

**Dérive constatée (hors TEST, à reconfirmer) :** des politiques nommées `sender creates invitation`, `sender updates invitation`, `create assignments as admin`, `delete assignments as admin`, `read assignments for admin stores` sont présentes en base mais **absentes de toutes les migrations du dépôt**. L'état installé n'est donc pas reproductible depuis le versionnement. La migration a été écrite en conséquence : elle cible les **expressions**, pas les noms.

## 4. Correctif préparé (non appliqué)

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20261021120000_p81_invitation_inviter_authorization.sql` | migration idempotente : helper, fermeture des politiques « inviter seul », politique gardée, garde RPC |
| `supabase/p8_1_package/10_preflight_capture.sql` | capture lecture seule + reconstruction exécutable du rollback |
| `supabase/p8_1_package/20_rollback.sql` | rollback (définitions seulement, aucune donnée) |
| `supabase/p8_1_package/30_test_protocol.md` | T1/T2 + N1–N15, non exécuté |

**Logique du correctif**
- `can_invite_to_store(store_id, user_id)` : owner/admin **actif**, sémantique identique à `is_store_admin_or_owner`, mais explicite sur l'utilisateur (indispensable pour vérifier l'invitant et non l'appelant).
- Boucle `pg_policy` : supprime toute politique **permissive** `INSERT`/`UPDATE` d'affectation citant `invited_by` sans contrôle owner/admin, **quel que soit son nom** — une politique permissive restante suffirait à rouvrir la voie. Les politiques restrictives (cumul en AND) ne sont jamais retirées.
- Garde-fou d'application : si une politique permissive d'écriture subsiste sans `store_id` (legs `with check (true)`), la migration **échoue** (`P8.1_BLOCKED_UNGUARDED_POLICY`) au lieu d'appliquer un correctif partiel.
- Nouvelle politique `invitation_assignments_inviter_insert` : owner/admin actif de la boutique ciblée **et** invitation appartenant à l'appelant.
- RPC : validation de **toutes** les affectations **avant** la première écriture → refus atomique (`INVITER_NOT_AUTHORIZED` + `store_id`), invitation non consommée, aucune appartenance créée ni réactivée. `FOR UPDATE`, contrôles e-mail/statut/expiration, multi-boutiques et `on conflict` conservés.

## 5. Objets SQL impactés

- fonctions : `public.accept_team_invitation(text)` (remplacée), `public.can_invite_to_store(uuid,uuid)` (créée) ;
- politiques : `team_invitation_assignments` — INSERT/UPDATE « inviter seul » supprimées, `invitation_assignments_inviter_insert` recréée ;
- ACL : `authenticated`, `service_role` seulement ; `anon` et `public` révoqués ;
- **inchangés** : huit rôles, permissions métier, `store_members` (politiques, triggers), `team_invitations` (politiques), données.

## 6. Risques de régression

| Risque | Mitigation |
|---|---|
| Propriétaire sans ligne `store_members` owner → invitation légitime refusée | capture (6) doit renvoyer **0** ; sinon NO-GO |
| Suppression d'une politique d'administration driftée | la boucle ne supprime que les expressions sans contrôle owner/admin ; `create assignments as admin` survit |
| Politique fail-closed si `team_invitations` n'a pas de `SELECT` policy | comportement inchangé (déjà fail-closed) ; documenté |
| Invitations `pending` dont l'invitant a perdu ses droits | inventaire (7)/(8) avant application ; décision métier explicite, aucun traitement automatique |
| Numéro de version déjà dépassé sur TEST | contrôle en préflight ; renommer le fichier si `max(version) >= 20261021120000` |
| Appelants `anon` sur les politiques `public` | nouvelle politique restreinte à `authenticated` |

## 7. GO / NO-GO

**GO pour appliquer** seulement si : capture exécutée et archivée ; `max(version) < 20261021120000` ; invariant (6) = 0 ; fixtures synthétiques disponibles ; rollback complété depuis la capture ; décision prise sur les invitations `pending` orphelines.

**NO-GO** si : capture impossible (pas d'accès SQL en lecture seule) ; politique inconnue non capturée ; test avec JWT réels indisponible ; invariant (6) ≠ 0.

**Hors lot :** création d'invitation par tout authentifié (anti-spam), révocation/renaissance d'invitation par l'invitant, politiques `DELETE` d'affectation, P8.2–P8.4, coûts/profits Viewer, KPI V5, Production.

**J'attends l'accord pour (a) l'accès SQL lecture seule sur `goqedvcdmgtejtyrawsp` afin de terminer l'étape 1, puis (b) l'exécution des tests dynamiques.**
