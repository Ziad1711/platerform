# Borne historique du lecteur KPI V5 — préparation (NON APPLIQUÉE EN PRODUCTION)

## 1. Cause démontrée

Pour « Cette année », woodea affichait **197 journées indisponibles** alors que
l’historique réel est complet :

| Élément | Valeur |
|---|---|
| Création de la boutique | **2026-09-15** |
| Première commande | 2026-10-12 |
| Première livraison | 2026-10-17 |
| Publicité | aucune |
| Période demandée | 2026-01-01 → 2026-10-23 = **295 jours** |
| Journées précalculées | 91 (depuis 2026-07-24) |
| Journées recalculées (secours) | 7 |
| Manquantes annoncées | **197** (295 − 91 − 7) |
| Journées antérieures à la création | **204** |

Aucune partition ne manque **dans** l’historique : les journées signalées sont
antérieures à l’existence de la boutique. Un backfill produirait des zéros pour
une période qui n’a jamais existé.

## 2. Contenu du patch

`KPI-HISTORY-FROM.sql` :

1. colonne `dashboard_kpi_store_state.history_from` (nullable) ;
2. `dashboard_kpi_history_from(store)` : minimum vérifié de `stores.created_at`,
   `orders.order_date`, `orders.delivered_at`, `ad_spend_daily.spend_date`,
   converti en journée métier Casablanca (les deux axes sont donc couverts) ;
3. `dashboard_kpi_set_history_from(store, from default null)` : écrit la borne.
   Sans borne explicite, la valeur est **monotone décroissante** : elle ne peut
   que reculer, jamais avancer, afin de ne jamais retirer une journée datée ;
4. `rpc_dashboard_kpi_reader` : les journées **antérieures à la borne sortent de
   la grille** (ni manquantes, ni comptées). Aucun zéro n’est fabriqué ;
5. une boutique dont toute la fenêtre est antérieure à sa borne est renvoyée avec
   `days_total = 0` et des totaux nuls (`store_totals_all`), sans `KPI_NO_ACCESS`
   et sans journée inventée.

Aucun calcul financier, aucun producteur, aucune ACL du lecteur, aucune donnée
métier. Le déclencheur de qualité des commandes n’est **pas** modifié par ce lot.

## 3. Empreintes

| Objet | Avant | Après |
|---|---|---|
| `rpc_dashboard_kpi_reader` (prosrc) | `b95d97616b6ba7c513c5937f78ada3c4` (18548) | `4aea1265fe253db2ba2b201416a71b2e` (19547) |
| `dashboard_kpi_history_from` | absent | `f89dac8662edb4fdc1657da3b05db489` (697) |
| `dashboard_kpi_set_history_from` | absent | `a2532c5280ba1cb4d3b63d1ebcd1b08e` (947) |
| `dashboard_kpi_invalidate_orders_quality_trg` | `6965304f01b0963def022abb08746912` | **inchangé** |

Le lecteur de production a été vérifié égal à la base TZ-COMPAT
(`b95d976…`) avant ce lot : le diff du lecteur ne contient que les six
modifications décrites ci-dessus.

## 4. Préflight Production (lecture seule)

```sql
-- identité
select current_database(), current_user;                     -- postgres / postgres
-- empreinte du lecteur : doit valoir b95d97616b6ba7c513c5937f78ada3c4
select md5(prosrc) from pg_proc where proname = 'rpc_dashboard_kpi_reader';
-- colonne et fonctions absentes : 0, 0
select count(*) from information_schema.columns
 where table_schema='public' and table_name='dashboard_kpi_store_state'
   and column_name='history_from';
select count(*) from pg_proc
 where proname in ('dashboard_kpi_history_from','dashboard_kpi_set_history_from');
-- woodea possède bien sa ligne d'état
select count(*) from public.dashboard_kpi_store_state
 where store_id = 'f46d2666-add5-4437-8f19-b6731fc5f4a8';     -- 1
```

Contrôles déjà exécutés le 22/10/2026 : base et rôle `postgres`, lecteur
`b95d976…`, colonne et fonctions absentes, une seule ligne d’état (woodea).
Borne calculée pour woodea : **2026-09-15**. Couverture simulée « Cette année » :
**38 jours, 38 agrégés, 0 manquant, 0 note en attente, 0 incompatible**.

## 5. Installation Production — transaction unique

```bash
export PGURL='postgresql://postgres:<secret>@<host>:5432/postgres'   # jamais dans un rapport

psql -X -w -1 -v ON_ERROR_STOP=1 "$PGURL" \
  -c "set kpi.history_authorized='yes'" \
  -f supabase/p79_delivery/release/KPI-HISTORY-FROM.sql
```

`-1` garantit une transaction unique. Toute erreur annule l’ensemble (colonne,
fonctions et lecteur).

## 6. Initialisation de la borne — woodea uniquement

Ne jamais lancer une boucle sur toutes les boutiques : les neuf autres boutiques
n’ont pas de ligne `dashboard_kpi_store_state`, donc `history_from` reste `NULL`
et leur grille est strictement inchangée.

```bash
psql -X -w -1 -v ON_ERROR_STOP=1 "$PGURL" \
  -c "select public.dashboard_kpi_set_history_from('f46d2666-add5-4437-8f19-b6731fc5f4a8');"
```

Résultat attendu : `{"store_id":"f46d…","history_from":"2026-09-15"}`.

## 7. Vérifications après installation

```sql
-- 1) une seule boutique bornée, valeur attendue
select store_id, history_from from public.dashboard_kpi_store_state
 where history_from is not null;                               -- 1 ligne, 2026-09-15

-- 2) empreinte du lecteur
select md5(prosrc) from pg_proc where proname='rpc_dashboard_kpi_reader';
-- 4aea1265fe253db2ba2b201416a71b2e

-- 3) ACL : service_role seulement, lecteur toujours accessible aux connectés
select has_function_privilege('authenticated',
         'public.dashboard_kpi_history_from(uuid)','execute'),      -- false
       has_function_privilege('anon',
         'public.dashboard_kpi_set_history_from(uuid,date)','execute'), -- false
       has_function_privilege('service_role',
         'public.dashboard_kpi_set_history_from(uuid,date)','execute'), -- true
       has_function_privilege('authenticated',
         'public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)','execute'); -- true

-- 4) couverture attendue « Cette année » (doit renvoyer 38 / 0 / 0)
with days as (
  select d::date bd from generate_series(date '2026-01-01', date '2026-10-22', interval '1 day') d
   where d::date >= date '2026-09-15'
)
select count(*) as days_total,
       count(*) filter (where m.store_id is null) as days_missing,
       (select count(*) from public.dashboard_kpi_invalidation i
         where i.store_id='f46d2666-add5-4437-8f19-b6731fc5f4a8'
           and i.business_date >= date '2026-09-15' and i.processed_at is null) as pending
  from days d
  left join public.dashboard_daily_metrics m
    on m.store_id='f46d2666-add5-4437-8f19-b6731fc5f4a8'
   and m.business_date=d.bd and m.axis='order' and m.definition_version=1
   and m.tz_used='Africa/Casablanca' and m.currency_code='MAD';
```

## 8. Résultat attendu dans l’interface

« Cette année » pour woodea :

| Avant | Après |
|---|---|
| 295 jours, 91 agrégés, 7 directs, **197 manquants** | **38 jours, 38 agrégés, 0 manquant, aucune alerte** |

La comparaison « Année dernière » renvoie 0 jour / totaux nuls et **non
incomplète** (aucun avertissement technique), au lieu de lever une erreur.

## 9. Rollback

```bash
psql -X -w -1 -v ON_ERROR_STOP=1 "$PGURL" \
  -c "set kpi.history_rollback_authorized='yes'" \
  -f supabase/p79_delivery/release/KPI-HISTORY-FROM-ROLLBACK.sql
```

Le fichier restaure le lecteur exact d’avant le patch, supprime les deux
fonctions puis la colonne, et affiche `0 | 0 | false`. Il ne réinstalle ni les
producteurs ni les déclencheurs. Côté frontend, `vercel rollback` suffit.

## 10. Backfill : inutile ici

La couverture actuelle (2026-07-24 → 2026-10-22) contient toute la période
postérieure à la borne. Un backfill n’est requis que si une **nouvelle** source
antérieure apparaît (import historique de commandes ou de publicité) :

```sql
select public.dashboard_kpi_history_from('<STORE_ID>');
select public.dashboard_kpi_backfill_enqueue('<STORE_ID>', <nouvelle_borne>, current_date);
select * from public.dashboard_kpi_resume(50, 'history-backfill', true);
```

## 11. Qualification B13 (environnement de test `goqedvcdmgtejtyrawsp`)

B13 ne portait pas TZ-COMPAT et son lecteur différait de la production. Les
mêmes fragments SQL (borne, filtre de grille, `store_totals_all`, suppression du
`from grid`) ont donc été appliqués à son lecteur par `pg_get_functiondef`, puis
les cas suivants ont été exécutés :

| Cas | Résultat |
|---|---|
| Période entièrement antérieure à la borne | boutique renvoyée, `days_total=0`, totaux nuls, `incomplete=false` (plus de `KPI_NO_ACCESS`) |
| Journée sans activité mais partition existante | `aggregate`, valeurs réelles à zéro (légitime) |
| Partition réellement absente dans l’historique | `missing`, exclue des totaux, **jamais convertie en zéro** |
| Donnée historique importée avant la création (2026-09-10) | borne calculée à 2026-09-08 via `delivered_at` (axe livraison inclus) |
| Axe order vs delivery | la journée livraison seule reste `missing` côté order, sans zéro fabriqué |
| Boutique sans borne (contrôle) | grille complète, 4 jours, 4 manquants, inchangée |
| Borne monotone | explicite 2026-09-20 acceptée, recalcul suivant → 2026-09-08 |
| Secours direct (`p_include_direct=true`) | 2 journées `direct`, aucun échec |
| ACL | `authenticated`/`anon` refusés, `service_role` autorisé, lecteur inchangé |
| Montants | 500 / 200 / 30 / 20 / 50, marge 200 : aucun montant masqué |
