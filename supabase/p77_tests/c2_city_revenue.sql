-- P7.7 / C2 — tests synthétiques du CA par ville.
--
-- Vérifie :
--   * CA = revenus des lignes des commandes livrées uniquement ;
--   * annulées et retours exclus du CA (mais conservés dans les compteurs) ;
--   * regroupement NULL conservé comme clé propre (l'UI l'affiche « Non renseignée ») ;
--   * borne de fin exclusive : une commande exactement à `end` est exclue.
--
-- Indépendant des fonctions et des données métier. SELECT uniquement.

with src(id, city, status, order_ts, line_revenue) as (
  values
    (1, 'A',    'delivered',         timestamptz '2026-09-01 10:00:00+00', 100.00::numeric),
    (2, 'A',    'cancelled',         timestamptz '2026-09-05 10:00:00+00',  50.00::numeric),
    (3, 'B',    'delivered',         timestamptz '2026-09-10 10:00:00+00', 200.00::numeric),
    (4, null,   'delivered',         timestamptz '2026-09-15 10:00:00+00',  30.00::numeric),
    (5, 'B',    'returned_stocked',  timestamptz '2026-09-20 10:00:00+00',  40.00::numeric),
    -- Borne de fin exacte : doit être exclue
    (6, 'A',    'delivered',         timestamptz '2026-10-01 00:00:00+00', 999.00::numeric)
),
bounds as (
  select timestamptz '2026-09-01 00:00:00+00' as b_start,
         timestamptz '2026-10-01 00:00:00+00' as b_end
),
scoped as (
  select s.* from src s, bounds b
  where s.order_ts >= b.b_start and s.order_ts < b.b_end
),
per_city as (
  select city,
         count(*) as orders,
         coalesce(sum(line_revenue) filter (where status = 'delivered'), 0) as revenue,
         count(*) filter (where status = 'delivered') as delivered
  from scoped group by city
),
checks as (
  select 'spring_exclue' as check_id, '5' as expected,
         (select count(*)::text from scoped) as observed
  union all
  select 'ca_total_livre', '330.00',
         (select to_char(coalesce(sum(revenue), 0), 'FM999999990.00') from per_city)
  union all
  select 'ca_ville_A', '100.00',
         (select to_char(revenue, 'FM999999990.00') from per_city where city = 'A')
  union all
  select 'ca_ville_B', '200.00',
         (select to_char(revenue, 'FM999999990.00') from per_city where city = 'B')
  union all
  select 'ca_ville_null', '30.00',
         (select to_char(revenue, 'FM999999990.00') from per_city where city is null)
  union all
  select 'annule_exclu_du_ca', '100.00',
         (select to_char(revenue, 'FM999999990.00') from per_city where city = 'A')
  union all
  select 'retour_exclu_du_ca', '200.00',
         (select to_char(revenue, 'FM999999990.00') from per_city where city = 'B')
)
select check_id, expected, observed,
       case when expected = observed then 'PASS' else 'FAIL' end as status
from checks
order by check_id;
