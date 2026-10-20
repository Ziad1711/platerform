# B13 — Référence C0 : empreinte, source, historique et limites

## 1. Référence adoptée

| Élément | Valeur |
|---|---|
| Fonction | `public.dashboard_kpi_invalidate_insert_stmt()` |
| **Empreinte C0** | **`2536fe3c58c8af6b18acb844ac585049`** (`md5(pg_get_functiondef)`) |
| Source versionnée | `supabase/migrations/20261018232500_b13_final_state.sql` |
| Propriétaire | `postgres` |
| Propriétés | `SECURITY DEFINER`, `volatile`, `search_path=public, pg_temp`, ACL `{postgres, service_role}` |

## 2. Changement de référence (20/10/2026)

| Référence | Empreinte | Statut |
|---|---|---|
| C0 historique | `c685fdd2e81ee1f9034be3f4ceaf53fd` | **historique uniquement** |
| **C0 adoptée** | **`2536fe3c58c8af6b18acb844ac585049`** | **référence officielle active** |
| C1 évaluée | `578763df7d0c7431f626ba87429e0f2f` | **non adoptée** — générée puis mesurée pendant la campagne comparative |
| C1 tentative antérieure | `9b3c13d478b66860d00a5c1acd7a8cbf` | **non adoptée**, sans campagne rattachée |

### 2.1 Trois empreintes à ne pas confondre

| Empreinte | Ce qu'elle désigne | Usage |
|---|---|---|
| `2536fe3c…` | C0 officielle, seule référence opposable | pré-vol `precheck_c0.ps1`, restauration, garde `-C0` de `compare_c0_c1.ps1` |
| `578763df…` | C1 réellement générée (`opt1/c1-optimized.sql`) puis évaluée | garde `-C1` de `compare_c0_c1.ps1` et contrôle après application |
| `9b3c13d4…` | ancienne tentative de C1, non adoptée | **aucun usage opérationnel** — traçabilité uniquement |

`9b3c13d4…` n'est **pas** une empreinte de campagne : aucune mesure n'y est rattachée
et elle ne doit jamais servir de garde. Toute empreinte C1 différente de `578763df…`
invalide la comparaison C0/C1. Décision associée : `../CLOTURE-OPT1.md`
(C1 abandonnée, B13 revenue à C0).

**Pourquoi l'ancienne référence textuelle est abandonnée** : `md5(pg_get_functiondef)` dépend de la **forme exacte du texte source** (casse des mots-clés, mise en forme de l'en-tête `LANGUAGE / SECURITY DEFINER / SET search_path`). Trois sources ont été appliquées sans jamais reproduire `c685fdd2` :

| Source appliquée | Empreinte obtenue |
|---|---|
| `backup-function.sql` (capture `pg_get_functiondef`) | `f412945ead6ebeab1cc9202dab8f0a15` |
| `p7_1_package/10_install_objects.sql` | `3aae1ffbfbbba014d6de0c321559be21` |
| `migrations/20261018232500_b13_final_state.sql` | **`2536fe3c58c8af6b18acb844ac585049`** ← adoptée |

L'écart est **textuel, non comportemental** : les trois versions portent le même `INSERT … UNION ALL … ON CONFLICT DO NOTHING` avec les mêmes motifs (`orders:INSERT:stmt`, `order_items:INSERT:stmt`, `ad_spend_daily:INSERT:stmt`).

## 3. Oracle fonctionnel

`c0-functional-test.sql` — exécution transactionnelle annulée par `RAISE`.

**Anti-faux-PASS explicites** :

```sql
if v_orders <> 5 then raise exception 'FIXTURES_MISSING …'; end if;
if v_inv = 0    then raise exception 'INVALIDATIONS_EMPTY …'; end if;
if v_missing > 0 or v_extra > 0 or v_inv <> v_expected then raise exception 'MISMATCH …'; end if;
```

L'oracle **recalcule les journées depuis `orders`** (indépendant du code testé) et compare **les ensembles**, pas seulement les nombres.

### Cas couverts (vérifiés)

| Cas | Attendu | Résultat |
|---|---|---|
| Journée identique (`delivered_at` NULL) | 1 journée | PASS |
| Journée identique (livraison le même jour) | 1 journée | PASS |
| Journées distinctes (23:59:59 → 00:00:00 Casablanca) | 2 journées | PASS |
| Insert groupé (5 commandes, un `INSERT`) | déduplication correcte | PASS |
| Deux boutiques | 2 `store_id` | PASS |
| Déduplication `(store_id, business_date, note_tx)` | 3 événements pour 7 candidats | PASS |

Preuve mesurée : `P79_C0_FUNC_PASS orders=5 invalidations=3 expected=3 missing=0 extra=0`.

### Limites — NON couvertes

1. **Branche `order_items`** : non exercée (cascade articles → commandes).
2. **Branche `ad_spend_daily`** : non exercée.
3. **Deuxième fuseau** : seul `Africa/Casablanca` est testé.
4. **`COMMIT`** : exclu (transaction annulée).
5. **Verrous** : non instrumentés.
6. **Drainage cron** : `NOT COVERED` — `pg_cron` non installé.
7. **Performance** : l'oracle est fonctionnel, pas un banc de mesure.

## 4. Pré-vol obligatoire

```powershell
& '…\server-measure\precheck_c0.ps1' -Service b13-isolated
```

Contrôle en lecture seule : identité du pooler (`user=postgres.biqrgdopcvkrbgfxkzxm`), `current_database()`, **empreinte C0**, propriétaire / `SECURITY DEFINER` / `search_path` / ACL, **6 triggers actifs**, **0 résidu** (`orders|items|events`).
Sortie attendue : `P79_PRECHECK_PASS c0=2536fe3c… triggers=6 db=postgres` ; sinon `P79_PRECHECK_FAIL` et code 1.

## 5. Restauration reproductible

```powershell
# 1. extraire la fonction de la migration C0 (seul objet réécrit)
& '…\psql.exe' service=b13-isolated -v ON_ERROR_STOP=1 --single-transaction -f c0_from_migration.sql
# 2. vérifier l'empreinte obtenue
& '…\psql.exe' service=b13-isolated -At -c "select md5(pg_get_functiondef('public.dashboard_kpi_invalidate_insert_stmt()'::regprocedure))"
# attendu : 2536fe3c58c8af6b18acb844ac585049
# 3. pré-vol complet
& '…\precheck_c0.ps1'
```

`c0_from_migration.sql` s'obtient par :

```bash
awk '/^create or replace function public.dashboard_kpi_invalidate_insert_stmt/{f=1} /^create or replace function public.dashboard_kpi_mark_order_insert/{f=0} f' \
  supabase/migrations/20261018232500_b13_final_state.sql | sed '/dashboard_kpi_mark_order_insert/d' > c0_from_migration.sql
```

L'ACL doit être re-appliquée après restauration :

```sql
revoke all on function public.dashboard_kpi_invalidate_insert_stmt() from public, anon, authenticated;
grant execute on function public.dashboard_kpi_invalidate_insert_stmt() to service_role;
```

**Critère de succès** : empreinte `2536fe3c…`, propriétés conformes, 6 triggers, 0 résidu. Toute autre empreinte ⇒ **B13 NON CONFORME**, arrêt sans nouvelle tentative.
