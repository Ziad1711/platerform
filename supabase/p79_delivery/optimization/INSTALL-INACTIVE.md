# P7.10 — Installation INACTIVE en Production

**État visé :** objets installés, **zéro trigger**, **capture désarmée**, **zéro boutique éligible**,
worker/réveil arrêtés, cohortes inchangées, lecteur `legacy`.

**Pré-requis (vérifiés le 22/10/2026, `92_verify_production_compatibility.sql`) :**
27 fonctions KPI, 0 trigger KPI, `dashboard_kpi_local_ts` présent, tables P7.10 absentes,
rollout `true/legacy`, worker `false`, 0 cohorte, hashes C0 conformes.

---

## 1. Commandes exactes

```bash
# Variables : URL de connexion Production fournie par l'exploitant (jamais dans le dépôt).
PSQL="psql -X -w -1 -v ON_ERROR_STOP=1"

# 0) Contrôle de compatibilité (lecture seule)
$PSQL "$PROD_URL" -f 92_verify_production_compatibility.sql

# 1) Installation inactive : aucun trigger, aucune activation
$PSQL "$PROD_URL" \
  -c "set kpi.producers_opt_authorized='yes'" \
  -f 10_install_producer_optimization.sql \
  -f 11_worker_failure_resilience.sql

# 2) Vérification de l'état inactif (attend INSTALL_INACTIVE_OK)
$PSQL "$PROD_URL" -f 89_verify_inactive_install.sql
```

`-1` garantit une transaction unique : toute erreur annule l'installation entière.

## 2. Contrôles attendus après installation

| Contrôle | Attendu |
|---|---|
| `trg_kpi_%` actifs | **0** |
| `dashboard_kpi_producer_config.enabled` | `false` |
| `dashboard_kpi_producer_stores` | **0 ligne** |
| 7 fonctions P7.10 présentes | oui |
| 12 empreintes (10 producteurs + worker + helper) | conformes au `MANIFEST.json` |
| worker / réveil | `false` / `false` |
| cohortes lecteur | inchangées (0) |
| rollout | `true/legacy` |
| journal / agrégats | inchangés |

## 3. Ce que cette installation ne fait pas

- aucun `create trigger` (réservé à `20_activate_producers_optimized.sql`) ;
- aucun `cron.schedule`, aucune extension ;
- aucune ligne dans `dashboard_kpi_producer_stores` ;
- aucun armement (`enabled` reste `false`) ;
- aucune écriture métier, aucun agrégat recalculé.

## 4. Conditions d'arrêt (abort immédiat)

1. `92_verify_production_compatibility.sql` : tout écart d'empreinte ou inventaire ≠ 27 → **STOP**.
2. `89_verify_inactive_install.sql` renvoie un FAIL → **STOP**, appliquer le retour (§5).
3. `trg_kpi_%` ≠ 0 après installation → **STOP** (installation non inactive).
4. Toute erreur psql avec `ON_ERROR_STOP` → transaction annulée, aucune action supplémentaire.
5. Fonction modifiée entre `92_` et l'installation (dérive concurrente) → **STOP**.

## 5. Retour (rollback)

```bash
$PSQL "$PROD_URL" \
  -c "set kpi.producers_opt_authorized='yes'" \
  -f 91_rollback_producer_optimization.sql
```

Effets : suppression des 6 triggers s'ils existent, restauration des 4 producteurs C0 et du worker
d'origine, suppression des 7 fonctions P7.10, de la vue et des 2 tables de configuration.
Postcondition : `ROLLBACK_OK_C0_RESTORED_NO_PRODUCER` + hashes C0 vérifiés.
Aucune donnée métier ni agrégat n'est supprimé ; la configuration de capture est perdue (à redéclarer).

## 6. Retour partiel (sans désinstallation)

- Désarmer la capture : `select public.dashboard_kpi_producer_arm(false);`
- Retirer une boutique : `select public.dashboard_kpi_producer_disable_store('<STORE_ID>'::uuid, 'arret');`
- Arrêter le worker : `update public.dashboard_kpi_worker_config set enabled=false where id=1;`
- Lecteur legacy : `update public.dashboard_kpi_rollout_config set kill_switch=true, requested_mode='legacy' where id=1;`

## 7. Après l'installation

L'activation des six producteurs (`20_`) et le pilote sont décrits dans `PILOT-PROCEDURE.md`.
`20_` exige `kpi.global_write_risk_accepted='yes'` et un projet autorisé ; il reste sans effet
métier tant que la capture n'est pas armée.
