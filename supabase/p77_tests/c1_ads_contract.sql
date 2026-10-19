-- P7.7 / C1 — tests synthétiques du contrat publicitaire du graphique.
--
-- Vérifie la règle retenue (identique aux cartes legacy) :
--   publicité de période suivie > 0  -> publicité suivie par jour
--   sinon                            -> publicité allouée par jour
-- et l'additivité : somme(profit jour) = CA - achats - livraison - confirmation - publicité.
--
-- Indépendant des fonctions, du lecteur V5 et des données métier. SELECT uniquement.

with rows(period_id, day_id, tracked, allocated, revenue, purchase, delivery, confirmation) as (
  values
    -- Période A : publicité suivie non nulle
    ('A', 1, 100.00::numeric,  90.00::numeric, 1000.00::numeric, 400.00::numeric, 50.00::numeric, 10.00::numeric),
    ('A', 2,  50.00::numeric,  50.00::numeric,  500.00::numeric, 200.00::numeric, 25.00::numeric,  5.00::numeric),
    ('A', 3,   0.00::numeric,  30.00::numeric,    0.00::numeric,   0.00::numeric,  0.00::numeric,  0.00::numeric),
    -- Période B : aucune publicité suivie (repli sur les allocations)
    ('B', 1,   0.00::numeric,  10.00::numeric,  200.00::numeric,  80.00::numeric, 10.00::numeric,  2.00::numeric),
    ('B', 2,   0.00::numeric,  20.00::numeric,  100.00::numeric,  40.00::numeric,  5.00::numeric,  1.00::numeric),
    ('B', 3,   0.00::numeric,   5.00::numeric,    0.00::numeric,   0.00::numeric,  0.00::numeric,  0.00::numeric)
),
totals as (
  select period_id, sum(tracked) as tracked_total
  from rows group by period_id
),
daily as (
  select r.period_id, r.day_id, r.revenue, r.purchase, r.delivery, r.confirmation,
         case when t.tracked_total > 0 then r.tracked else r.allocated end as ads
  from rows r join totals t using (period_id)
),
aggregated as (
  select period_id,
         sum(revenue) as revenue, sum(purchase) as purchase, sum(delivery) as delivery,
         sum(confirmation) as confirmation, sum(ads) as ads,
         sum(revenue - purchase - delivery - confirmation - ads) as profit
  from daily group by period_id
),
expected(period_id, exp_ads, exp_profit, exp_points) as (
  values ('A', 150.00::numeric, 660.00::numeric, 2),
         ('B',  35.00::numeric, 127.00::numeric, 3)
)
select a.period_id,
       a.ads,       e.exp_ads,
       a.profit,    e.exp_profit,
       (select count(*) from daily d where d.period_id = a.period_id and (d.ads <> 0 or d.revenue <> 0)) as points,
       e.exp_points,
       case when a.ads = e.exp_ads
             and a.profit = e.exp_profit
             and (select count(*) from daily d where d.period_id = a.period_id and (d.ads <> 0 or d.revenue <> 0)) = e.exp_points
            then 'PASS' else 'FAIL' end as status
from aggregated a join expected e using (period_id)
order by a.period_id;
