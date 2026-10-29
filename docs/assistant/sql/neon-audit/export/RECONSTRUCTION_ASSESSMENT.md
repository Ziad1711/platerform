# Reconstruction DDL via MCP — évaluation et verdict

Statut : **NO-GO**. Aucun DDL n'a été produit, aucune restauration, aucune
écriture. Toutes les mesures ci-dessous proviennent de requêtes en lecture seule
(`supabase_read_only_user`, PostgreSQL 17.6).

Motif : la reconstruction fidèle n'est pas transférable par le canal MCP et,
réduite au périmètre de l'audit, elle exigerait de couper des triggers — ce que
la règle « pas de mock silencieux » interdit.

---

## 1. Volume de DDL à transférer (mesuré)

| Poste | Octets |
|---|---|
| Corps des fonctions (`pg_get_functiondef`) | 394 998 |
| Définitions d'index (`pg_get_indexdef`) | 40 151 |
| Contraintes (`pg_get_constraintdef`) | 29 000 |
| Triggers (`pg_get_triggerdef`) | 11 043 |
| Policies (`pg_policies`) | 40 767 |
| Colonnes + types + défauts | 65 658 |
| **Total** | **581 619 (~568 Kio)** |

Le canal MCP renvoie du JSON dans la conversation : ~150 k tokens au minimum,
au-delà du budget disponible, avec troncature inévitable. Un export partiel
silencieusement tronqué serait inutilisable et non vérifiable — donc interdit.

## 2. Fermeture du périmètre audit (mesurée)

Périmètre de départ : 10 tables (102 colonnes, 28 policies, 35 index,
40 contraintes, 14 triggers) et 13 fonctions (9 253 octets de DDL — modeste).

Mais les fonctions de trigger tirent d'autres tables :

| Table du périmètre | Trigger | Fonction | Tables référencées |
|---|---|---|---|
| `stores` | `trg_create_default_blacklist_rule` | `tg_create_default_blacklist_rule` | `blacklist_rules` |
| `stores` (DELETE) | `trg_stores_block_financial_history` | `block_store_delete_with_financial_history` | `confirmation_agent_payments`, `supplier_payments`, `supplier_purchases` |
| `store_members` | `trg_sync_confirmation_agent` | `sync_confirmation_agent_for_member` | `confirmation_agents` → **`orders`**, `order_confirmation_events`, `pick_confirmation_agent` |

Chaîne décisive : `store_members → confirmation_agents → reassign_orders_on_agent_deactivation → orders`.
`orders` est le hub du schéma (ses propres triggers rappellent produits, stock,
livraison, événements de confirmation…) : **la fermeture converge vers le schéma
complet**. Toute réduction obligerait à désactiver des triggers, c'est-à-dire à
substituer un comportement simulé à la réalité — refusé (règle 8/9).

## 3. Écarts de fidélité, même si le volume avait été transférable

| Élément | Reproduit ? | Commentaire |
|---|---|---|
| Tables, colonnes, défauts, contraintes, index, séquences | oui (texte catalogue) | reconstruction manuelle, ordre de dépendance à garantir |
| Fonctions (corps réels) | oui | `pg_get_functiondef` : aucune substitution par mock |
| Vues, triggers, policies | oui | policies liées aux rôles `public`/`authenticated`/`service_role` |
| Propriétaires des objets | **non** | rôle lecture seule ; de toute façon `--no-owner` |
| Privilèges effectifs / default privileges | **non** | rétablis par `01` pour le périmètre assistant |
| `COMMENT ON` | non (exclu volontairement) | — |
| Extensions `pg_net`, `supabase_vault`, `pg_cron` | **non** (indisponibles sur Neon) | déjà exclues du plan |
| `pgcrypto`, `uuid-ossp` | inutiles (0 usage vérifié) | — |
| Schéma `auth` | **simulé** (stub `auth.users` + `auth.uid()`) | écart assumé et documenté |
| Types personnalisés | aucun (0 enum/domain vérifié) | rien à reproduire |
| RLS `FORCE ROW LEVEL SECURITY` | à vérifier sur les 107 tables | non mesuré |

## 4. Contrôle de complétude et empreinte

Sans DDL produit, il n'y a **ni contrôle objet par objet, ni empreinte SHA-256
de DDL**. Le contrôle prévu (`export/verify_restore.sql`, référence
107/4/4/209/219/70) reste valable et sera utilisé sur la sortie `pg_dump`.

## 5. Voies débloquantes

### A. Rôle d'audit minimal + `pg_dump` (recommandé si la fidélité est exigée)

`pg_dump --schema-only` **ne lit aucune donnée** : un rôle `LOGIN` avec
`CONNECT` et `USAGE` sur `public` suffit. À exécuter **une fois**, par une
session `postgres` du Dashboard SQL Editor, puis retirer immédiatement :

```sql
-- 1. création (mot de passe SCRAM généré localement, jamais réutilisé)
create role audit_ro_20261029 login password '<SCRAM_ALEATOIRE>'
  connection limit 1 valid until '2026-10-31 00:00:00+00';
grant connect on database postgres to audit_ro_20261029;
grant usage on schema public to audit_ro_20261029;

-- 2. export local (hors dépôt), puis :
--    psql … -c 'drop owned by audit_ro_20261029;'   (aucun objet possédé attendu)
drop role audit_ro_20261029;

-- 3. vérification
select rolname from pg_roles where rolname like 'audit_ro_%';   -- attendu : 0 ligne
```

Aucun rôle existant n'est modifié, aucun mot de passe existant n'est changé.

### B. Obtenir les identifiants du rôle lecture seule existant

Ils ne sont **pas** disponibles localement : les configurations MCP ne
contiennent aucune chaîne `postgresql://` ni mention de ce rôle (0 occurrence) ;
le MCP hébergé s'authentifie par un autre canal. Il faudrait que le fournisseur
de ce canal vous communique un mot de passe de connexion directe.

### C. Périmètre réduit avec triggers désactivés — **refusé**

Cela reviendrait à tester un schéma qui n'est pas celui de la production.

## 6. Ce qui n'a pas été fait

Aucun DDL généré ni stocké, aucune restauration Neon, aucune migration
`01/02/03b/05b`, aucune fixture, aucune écriture production, aucun push.
Le répertoire privé `~/jisra-audit/export/` reste vide : il n'y a rien de
fidèle à y déposer.
