# P8.1 — Protocole de reproduction et de non-régression (NON EXÉCUTÉ)

**Environnement unique autorisé :** `jisra-test` / `goqedvcdmgtejtyrawsp`.
**Interdits :** `attvfeoqgbxsnnsllatt` (Production), `biqrgdopcvkrbgfxkzxm` (B13), `qxtqtzmxkwiohfbmwcdt` (P7).
**Statut :** aucune requête de ce protocole n'a été exécutée. Toute écriture exige une autorisation complémentaire explicite.

## 0. Préconditions

1. Vérifier l'identité MCP (`get_project` → `name = jisra-test`) et le HEAD Git (`3bcf716`).
2. Exécuter `10_preflight_capture.sql` et archiver la sortie : elle sert de référence et de source de rollback.
3. Créer **uniquement** des fixtures synthétiques, jamais un compte réel :
   - `U_ADMIN` — owner/admin actif de `SA` ;
   - `U_VIEWER` — viewer actif de `SA` (non admin) ;
   - `U_TARGET` — destinataire d'invitation, membre d'aucune boutique ;
   - `U_OTHER` — owner/admin actif de `SB` (boutique étrangère) ;
   - `SA` boutique autorisée, `SB` boutique étrangère.
4. Conserver les jetons JWT des fixtures hors dépôt ; ne jamais les journaliser.
5. Chaque scénario se termine par un contrôle d'état en lecture (`team_invitation_assignments`, `store_members`, `team_invitations`) : le verdict ne repose pas sur le code HTTP seul.

## 1. Qualification du défaut (avant migration)

### T1 — Écriture d'affectation par un non-admin, en REST direct

1. JWT `U_VIEWER` : `POST /rest/v1/team_invitations` avec `invited_by = <U_VIEWER>`, `email = <U_TARGET>`, `token` aléatoire.
2. Relever le statut HTTP et l'`id` retourné.
3. JWT `U_VIEWER` : `POST /rest/v1/team_invitation_assignments` avec `invitation_id = <id>`, `store_id = <SB>`, `role = 'admin'`.
4. Contrôler en base l'existence de la ligne d'affectation.

**Attendu d'analyse :** distinguer trois issues.
- `403` / `new row violates row-level security policy` → refus RLS, aucune ligne : la voie est fermée.
- `201` mais **aucune ligne** persistée → incohérence à documenter (ne pas conclure).
- `201` + ligne persistée → **défaut prouvé** : la politique d'affectation n'exige pas owner/admin de `SB`.

### T2 — Exploitabilité de bout en bout

Si et seulement si T1 persiste une ligne :

1. JWT `U_TARGET` : `POST /rest/v1/rpc/accept_team_invitation` avec le jeton de T1.
2. Contrôler `store_members` pour `(SB, U_TARGET)`.

**Attendu d'analyse :** `success` + appartenance créée = élévation **prouvée**. Refus ou absence d'appartenance = chaîne **non exploitable**, à documenter comme telle (le correctif reste justifié en défense en profondeur).

> Tant que T1/T2 ne sont pas exécutés, le défaut reste **qualifié mais non prouvé**. Aucun « PASS » ne peut en découler.

## 2. Non-régression après migration

| # | Scénario | Attendu |
|---|---|---|
| N1 | Admin actif de `SA` invite `U_TARGET` sur `SA` uniquement, puis `U_TARGET` accepte | invitation `accepted`, appartenance `SA` active avec le rôle demandé |
| N2 | Même admin, deux affectations `SA` + `SA2` (deux boutiques qu'il administre) | les deux appartenances créées, `acceptedCount = 2` |
| N3 | Invitation `pending` sur `SA`, puis `U_TARGET` accepte | `success`, invitation consommée une seule fois |
| N4 | Seconde acceptation du même jeton | `INVITATION_NOT_PENDING`, aucune nouvelle appartenance |
| N5 | Invitation dont `expires_at < now()` | `INVITATION_EXPIRED`, aucune appartenance |
| N6 | JWT d'un utilisateur dont l'e-mail diffère de `invitation.email` | `INVITATION_EMAIL_MISMATCH`, aucune appartenance |
| N7 | Invitant rétrogradé (admin → viewer) **avant** acceptation | `INVITER_NOT_AUTHORIZED` + `store_id`, invitation toujours `pending`, aucune appartenance |
| N8 | Invitant révoqué (`status = 'revoked'`) avant acceptation | idem N7 |
| N9 | Invitation multi-boutiques dont **une seule** boutique n'est plus administrée par l'invitant | refus **intégral** : aucune des deux appartenances, invitation `pending` |
| N10 | Acceptation et révocation concurrentes (deux sessions) | un seul effet : soit `accepted` + appartenance, soit `revoked` + `INVITATION_NOT_PENDING` |
| N11 | Admin actif de `SA` tente d'affecter `SB` | `403` / refus RLS, aucune ligne |
| N12 | Invitation forgée par REST pour une boutique étrangère | refus, aucune ligne d'affectation |
| N13 | Tentative de modification du propriétaire (`role = 'owner'`, `status != 'active'`) | `OWNER_ROLE_UNIQUE` / `OWNER_CANNOT_BE_REMOVED`, aucune modification |
| N14 | Lecture des invitations par leur invitant (`GET /api/team/invitations`) | liste inchangée, aucune régression |
| N15 | Révocation d'une invitation par son invitant (`DELETE /api/team/invitations/[id]`) | `revoked`, aucune autre invitation affectée |

## 3. Contrôles statiques après migration

- `pg_policies` : aucune politique INSERT/UPDATE de `team_invitation_assignments` ne cite `invited_by` sans `can_invite_to_store`.
- ACL : `accept_team_invitation(text)` et `can_invite_to_store(uuid,uuid)` exécutables par `authenticated` et `service_role`, pas par `anon` ni `public`.
- Aucune modification des huit rôles ni des permissions métier (`role_permissions` inchangée).
- `supabase_migrations.schema_migrations` contient exactement une nouvelle ligne, `20261021120000`.

## 4. Verdict

**PASS** si N1–N15 sont conformes, T1/T2 documentés, et qu'aucune appartenance indue n'existe.
**FAIL** si une seule appartenance indue apparaît, ou si une invitation légitime régresse.
**NOT COVERED** pour tout scénario non exécuté — jamais converti en PASS.
