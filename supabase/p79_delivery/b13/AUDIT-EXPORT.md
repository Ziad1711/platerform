# Audit hors dépôt de l'export structurel (jisra-test → cible B13)

Fichier audité : `C:/Users/HP-EXE/Documents/JISRA-QA/P79-B13-export/public-schema.sql`
SHA-256 `27eb1b699ba1d9bbd9423f9bb4ce41b045c4e1177852d204ec2e1d86602136fa`,
842 514 octets, **DDL seul** (0 bloc `COPY`, 0 `INSERT` de données).

## 1. Secrets et configuration externe

| Recherche | Résultat |
|---|---|
| URL `http(s)://` en dur | **0** |
| `api_key`, `apikey`, `secret=`, `bearer` | 0 valeur ; seules occurrences = noms de colonnes/GUC |
| `pg_read_file`, `pg_ls_dir`, `COPY … FROM PROGRAM`, `dblink` | **0** |
| Emails ou identifiants personnels | 0 (aucune donnée) |
| Appels sortants | **1 seul** : `net.http_post` dans `dashboard_kpi_wakeup_trg` |

### Le seul point d'effet externe

`dashboard_kpi_wakeup_trg` :

1. lit `dashboard_kpi_wakeup_config` (table privilégiée, **vide** dans l'export) ;
2. si `enabled is not true` → `return null` **avant tout appel réseau** ;
3. lit ensuite un secret dans `vault.decrypted_secrets` ; absent → `invalid_configuration`, retour ;
4. vérifie l'hôte HTTPS exact avant `net.http_post` ;
5. l'échec d'enfilement est capturé : l'écriture métier ne peut pas échouer.

L'export préserve en outre son état désactivé :

```sql
ALTER TABLE public.dashboard_kpi_invalidation DISABLE TRIGGER trg_kpi_wakeup;
```

**Conclusion : aucun appel externe possible sur la cible**, même en cas d'oubli,
tant que `dashboard_kpi_wakeup_config` reste vide — ce qui doit être vérifié
après installation.

## 2. Applicabilité du DDL sur un nouveau projet Supabase

| Point | Constat | Action requise |
|---|---|---|
| `CREATE EXTENSION` dans l'export | **0** | créer `pgcrypto`, `uuid-ossp`, `pg_net`, `pg_stat_statements` avant application |
| `vault.decrypted_secrets` | référencé par 1 fonction | `supabase_vault` présent par défaut ; sinon la fonction échoue et l'erreur est capturée |
| `auth.users` | 299 références ; FK depuis `profiles`/`stores`/`orders` | natif Supabase ; créer un utilisateur **synthétique** avant les FK ou désactiver temporairement les contraintes |
| Ordre des objets | `pg_dump` émet tables → séquences → contraintes → index → fonctions → triggers → policies → grants | applicable tel quel |
| `SECURITY DEFINER` | **131** fonctions | conserver ; elles supposent `search_path` défini (présent) |
| RLS | **219** politiques | incluses ; ne pas les désactiver (fuite potentielle) |
| ACL | **782 GRANT**, **50 REVOKE** | rôles `anon`/`authenticated`/`service_role` natifs : applicables |
| `pg_cron` | **0** référence dans l'export | aucun job ne sera créé : worker dormant par construction |
| Triggers | **69** `CREATE TRIGGER` | aucun trigger KPI d'invalidation n'est attendu (le paquet les ajoute) |

## 3. Écarts connus entre l'export et jisra-test

- 104 tables exportées sur 104 (aucune exclusion) ;
- fonctions, triggers et politiques identiques à la source (même dump) ;
- **aucune donnée**, donc aucun `store_id` historique ni état KPI.

## 4. Neutralisation contrôlée des effets externes

| Objet | Méthode | Vérification |
|---|---|---|
| `trg_kpi_wakeup` | reste **désactivé** (état de l'export) | `tgenabled = 'D'` |
| `dashboard_kpi_wakeup_config` | **0 ligne** | `count(*) = 0` |
| `pg_cron` | aucun job créé | `cron.job` vide |
| Fonctions d'intégration (youcan, sendit, ameex, ozone, forcelog, digylog, rushliv, maroc_go, lightfunnels, facebook) | présentes mais **non appelées** par le chemin mesuré ; aucun trigger ne les invoque sur `orders`/`order_items` | vérifié : les 38 triggers du chemin n'appellent que des fonctions métier locales |

Aucune neutralisation destructive n'est nécessaire ; il suffit de ne pas
alimenter les tables de configuration d'intégration.

## 5. Risques résiduels

1. Le dump inclut des objets d'intégration **inactifs** : bruit de catalogue,
   pas d'effet mesuré.
2. `auth.users` synthétique : si l'utilisateur est absent, les FK bloquent
   l'insertion de `profiles` → l'installation doit le créer d'abord.
3. Les paramètres serveur (work_mem, autovacuum) diffèrent d'un projet neuf :
   documenter la configuration au moment de la mesure.
