# Action 2 — Casablanca et préconditions du worker automatique

## Casablanca : preuve comportementale PASS

Référence officielle : IANA tzdb 2026c (2026-07-08), consultée dans NEWS et africa
via https://data.iana.org/time-zones/tzdb/ (version actuelle consultée : 2026e).
Le Maroc passe à UTC+0 permanent le 20/09/2026.

| UTC | Attendu = B13 observé |
|---|---|
| 2026-02-25 12:00Z | 2026-02-25 12:00 |
| 2026-07-01 12:00Z | 2026-07-01 13:00 |
| 2026-09-20 01:00Z | 2026-09-20 01:00 |
| 2026-10-21 23:30Z | 2026-10-21 23:30 |

L'ancien attendu UTC+1 après le 20 septembre est retiré des références locales.
Les règles comportementales de cette matrice sont satisfaites ; cela ne certifie
pas le numéro du paquet tzdata installé. Le drapeau `readiness_tzdata` reste
**false** : aucune écriture de readiness effectuée. Le relevé Production ancien
ne doit plus être qualifié PASS par comparaison à l'ancien attendu ; aucune
opération ni nouveau contrôle Production effectué ici.

## Cron : NOT COVERED, aucune activation

Lectures réelles B13 :
- PostgreSQL 17.11, rôle courant `postgres` avec `rolsuper=false`.
- `shared_preload_libraries` contient déjà `pg_cron`.
- `cron.database_name=postgres`.
- Extension `pg_cron` disponible (dont 1.6.4), mais non installée :
  `cron.job` absent. Métadonnées : `superuser=true`, `trusted=false`.
- Le rôle a CREATE sur la base, ce qui ne suffit pas à garantir CREATE EXTENSION
  pour une extension non trusted ; les délégations propres à Supabase n'ont pas
  été prouvées par un essai administratif.
- Worker désactivé, zéro boutique/commande/événement.

`40_activate_worker.sql` exige `cron.job`, puis active le worker et programme
`jisra_kpi_worker` toutes les deux secondes. Il ajoute également une purge
quotidienne : ce lot ne doit donc pas être lancé sans autorisation adaptée.
Le traitement prévu est SQL local, sans appel HTTP ni besoin de pg_net pour
ce chemin. Aucun ordonnanceur externe n'a été substitué à ce mécanisme.

L'approbation antérieure du plan exigeait une autorisation distincte pour
l'installation/activation de pg_cron ; aucune instruction présente ne donne
explicitement cette autorisation et la mission interdit une installation non
autorisée. Aucun CREATE EXTENSION, cron.schedule, changement serveur, ni fixture
n'a donc été exécuté. Fraîcheur automatique et p95 : NOT COVERED.

Prérequis exact : administrateur Supabase habilité doit autoriser puis effectuer
l'installation de pg_cron sur la base postgres de B13, ou confirmer la délégation
au rôle postgres avec une autorisation explicite d'installation. Bibliothèque
déjà préchargée : pas de modification de shared_preload_libraries demandée.
Autoriser ensuite explicitement le job temporaire toutes les deux secondes et
sa suppression, avec capture/restauration de l'extension, jobs et configuration.
Ne pas installer pg_net ni activer la purge globale implicitement pour cette preuve.

## Performance — décision proposée, aucune approbation implicite

- Import 600 : soumettre séparément l'exception documentée +36 à +40 ms,
  médiane +15,27/+15,44 %, seuils inchangés et B13 historique FAIL maintenu.
- p95 update_item_price : point ouvert, cause INCONCLUSIVE. Pas de correction
  de triggers sans attribution et pas d'assimilation automatique au bruit réseau.
- En l'absence d'une exception séparée explicitement approuvée pour ce risque,
  recommandation maintenue : NO-GO Production. Aucun benchmark relancé.

## État final

B13 lu seulement : C0 `2536fe3c58c8af6b18acb844ac585049`, worker arrêté,
kill_switch=true, requested_mode=legacy, readiness_tzdata=false ; zéro fixture.
Aucune écriture Production/TEST/P7, modification MCP, installation ou redémarrage.