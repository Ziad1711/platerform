# P7.8 — Tests et protocole de finalisation des métadonnées

## Tests déterministes (aucune fonction, aucune écriture)

`finalization_matrix.sql` reproduit la matrice de décision :

| Cas | Attendu |
|---|---|
| couverture complète, deux axes, propre | `done` |
| un jour sans partition `order` | `running`, `missing_days` |
| un jour avec invalidation en attente | `running`, `dirty_days` |
| un jour sans axe `delivery` | `running`, `missing_delivery_axis` |
| une partition d'une autre version | `running`, `incompatible_partitions` |
| fuseau ou devise différent | `running`, `incompatible_partitions` |
| plage déclarée plus courte que le calculé | plage **étendue** |
| plage déclarée plus longue que le calculé | plage **conservée**, `missing_days` |

Résultat obtenu le 20/10/2026 en lecture seule : **8/8 PASS**.

## Contrôles après application (autorisation distincte)

1. **HIST-STORE** — appeler `dashboard_kpi_finalize_store_state(store)` et vérifier :
   - `coverage_from = 2026-08-01`, `coverage_to = 2026-10-18` ;
   - `computed_days = 79`, `dirty_days = 0`, `backfill_state = 'done'` ;
   - `publish_counter`, `last_event_seq`, `last_rebuild_at` **inchangés** par la finalisation.
2. **Autres boutiques** — relever `to_jsonb(store_state)` de toutes les boutiques avant/après ;
   seule HIST-STORE doit changer.
3. **Publication normale** — provoquer une invalidation sur une journée de test
   (via `dashboard_kpi_note`) puis laisser le worker : `publish_counter` doit
   augmenter de 1 et les métadonnées se recalculer sans intervention manuelle.
4. **Permissions** — `dashboard_kpi_finalize_store_state` : `service_role` seulement ;
   `anon` et `authenticated` refusés.
5. **Charges** — mesurer la durée d’un `rebuild_day` avec finalisation (79 jours de
   couverture) ; aucune modification des paramètres globaux.

## Protocole de republication HIST-STORE (79 journées)

Objectif : remettre les 158 partitions sous la chaîne normale
(`claim → rebuild_day → acquittement → publication → finalisation`) sans
reconstruction directe.

1. Capturer `publish_counter`, `last_event_seq`, `last_rebuild_at` et les 158 partitions.
2. Pour chaque journée `2026-08-01` → `2026-10-18`, créer un événement de maintenance ciblé :
   `select dashboard_kpi_note(store, jour, 'maintenance:p78');`
   (insertion uniquement ; aucune donnée métier lue ni écrite).
3. Laisser le worker (`jisra_kpi_worker`, toutes les 2 s) traiter les événements.
   Ne pas lancer `dashboard_kpi_resume`/`worker_run` en parallèle sur la même boutique.
4. Surveiller `dashboard_kpi_invalidation` : les événements passent à `processed_at`
   non nul, avec `claim_token` et `claimed_by` renseignés.
5. Vérifier après traitement :
   - 79 journées acquittées, aucune en attente ;
   - `publish_counter` strictement supérieur à sa valeur initiale (une publication par partition) ;
   - `last_event_seq` ≥ séquence maximale acquittée ;
   - les 158 partitions conservent les mêmes montants financiers ;
   - `computed_days = 79`, `dirty_days = 0`, `backfill_state = 'done'` ;
   - shadow `match = true`, `diff_count = 0` sur plusieurs journées.
6. En cas d’échec d’une partition : le worker pose un backoff et renseigne `last_error` ;
   ne pas contourner, analyser puis relancer après correction.

## Rollback

1. Restaurer la définition précédente de `dashboard_kpi_rebuild_day` (capturée avant application).
2. Supprimer `dashboard_kpi_finalize_store_state` si le correctif est retiré.
3. Ne jamais décrémenter `publish_counter` ni supprimer les invalidations acquittées.
4. Les champs dérivés resteront dans leur dernier état calculé ; une future publication
   les recalculera.
