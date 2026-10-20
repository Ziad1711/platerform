# B13 — Analyse de fermeture des dépendances (lecture seule, jisra-test)

Mesures du 20/10/2026 sur **jisra-test** (`goqedvcdmgtejtyrawsp`), PostgreSQL 17.11.
Aucune écriture : uniquement des requêtes de catalogue et un `pg_dump --schema-only`.

## 1. Volumétrie réelle du schéma `public`

| Objet | Nombre |
|---|---|
| Tables | **104** |
| Fonctions | **184** |
| Triggers | **70** |
| Séquences | 3 |
| Vues | 4 |
| Politiques RLS | **219** |

## 2. Fermeture par clés étrangères (6 tables de départ)

`orders`, `order_items`, `products`, `stores`, `store_members`, `ad_spend_daily`
→ **12 tables** :

`ad_spend_daily`, `auth.users`, `confirmation_agents`, `delivery_companies`,
`order_items`, `orders`, `product_categories`, `product_variants`, `products`,
`profiles`, `store_members`, `stores`.

`auth.users` est un objet **managé** : il existe nativement sur tout nouveau
projet Supabase, il ne doit pas être recréé.

## 3. Triggers réellement présents sur ces tables

**38 triggers** (et non 11 comme supposé), dont :

- `orders` : 21 triggers (normalisation, attribution d'agent, quotas, dépenses,
  inventaire, commissions, suivi livraison, journalisation, KPI ×4) ;
- `order_items` : 3 ;
- `stores` : 5 ; `store_members` : 4 ; `products` : 2 ;
  `product_variants` : 1 ; `product_categories` : 1 ; `profiles` : 1.

Les fonctions correspondantes sont **~30**, dont plusieurs `SECURITY DEFINER`.

## 4. Dépendances ajoutées par les corps de fonctions

Extraction textuelle depuis les 30 fonctions de trigger : **18 objets
supplémentaires**, dont tables écrites hors périmètre :

`blacklist_rules`, `confirmation_agent_payments`, `delivery_tracking_state`,
`order_confirmation_events`, `supplier_payments`, `supplier_purchases`,
`dashboard_kpi_invalidation`, `dashboard_kpi_store_state`,
`resolve_confirmation_commission_for_order`.

Ces tables ont elles-mêmes des triggers : la fermeture **converge vers une large
part des 104 tables**.

## 5. Obstacle identifié

Une liste « minimale » écrite à la main est **non sûre** : il manquerait
nécessairement des cibles d'écriture ou des fonctions appelées, et l'installation
échouerait à l'exécution ou mesurerait un coût faussé.

Deux options seulement :

| Option | Fidélité | Risque |
|---|---|---|
| **A — schéma `public` complet, structure seule** | élevée | inclut des objets d'intégration non mesurés (bruit, pas d'effet sur le chemin testé) |
| B — fermeture restreinte au chemin mesuré | moyenne | dépendance manquante probable ; écart de mesure non quantifiable |

**Recommandation : option A**, avec documentation explicite du biais
« objets d'intégration présents mais inactifs ».

## 6. Artefact produit (hors dépôt, non appliqué)

`pg_dump --schema-only --no-owner --schema=public` exécuté en lecture seule :

| Élément | Valeur |
|---|---|
| Fichier | `C:\Users\HP-EXE\Documents\JISRA-QA\P79-B13-export\public-schema.sql` |
| Taille | 842 514 octets |
| `CREATE TABLE` | 105 (104 + 1 vue matérialisée/partitions éventuelles) |
| `CREATE FUNCTION` | 184 |
| `CREATE POLICY` | 219 |
| Données | **aucune** (`--schema-only`) |
| Secrets | aucun (structure uniquement) |

Le SHA-256 est consigné dans `schema-export.manifest.json`. Le fichier reste
**hors Git** (regénérable par une commande) ; seul le manifeste est versionné.

## 7. Points de vigilance à l'application

1. **`auth.users`** : créer un utilisateur synthétique sur le nouveau projet
   avant d'appliquer les FK, ou appliquer les tables puis l'utilisateur.
2. **Rôles** : `anon`, `authenticated`, `service_role` existent sur Supabase ;
   les `GRANT` du dump s'appliquent sans création de rôle.
3. **Extensions** : `pgcrypto`, `uuid-ossp`, `pg_cron`, `pg_net`,
   `pg_stat_statements` doivent être créées **avant** le dump si des objets en
   dépendent.
4. **`cron.job`** : aucun job n'est inclus (hors `public`), donc aucun worker ne
   démarrera automatiquement.
5. **Objets `dashboard_*`** : présents dans le dump ; ils seront remplacés par
   l'installation du paquet KPI. Ordre recommandé : schéma métier → paquet KPI
   (mode inactif) → activation.
6. **Aucune donnée réelle** : le dump ne contient que du DDL.

## 8. Ce que cette analyse ne prouve pas

- elle ne prouve pas que le schéma ainsi restauré se comporte exactement comme
  la production (versions d'extensions, paramètres serveur, volume) ;
- elle ne remplace pas la mesure : **B13 reste FAIL tant que la campagne n'a pas
  eu lieu sur la cible isolée**.
