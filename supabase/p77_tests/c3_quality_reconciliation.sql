-- P7.7 / C3 — tests synthétiques de la réconciliation qualité.
--
-- Aucune dépendance aux agrégateurs, au lecteur V5 ou à des données métier.
-- Exécutable en lecture seule (SELECT uniquement) sur jisra-test.
-- Attendu : 10 lignes, toutes PASS.

with cases(id, lines_rev, subtotal, discount, ship_customer, rounding, total, expect_mismatch) as (
  values
    -- 1. Cas nominal : lignes = sous-total, total = sous-total (aucun frais)
    (1, 200.00::numeric, 200.00::numeric, 0.00::numeric,  0.00::numeric, 0.00::numeric, 200.00::numeric, false),
    -- 2. Livraison client incluse dans le total : plus de faux positif
    (2, 200.00::numeric, 200.00::numeric, 0.00::numeric, 25.00::numeric, 0.00::numeric, 225.00::numeric, false),
    -- 3. Remise appliquée
    (3, 200.00::numeric, 200.00::numeric, 10.00::numeric,  0.00::numeric, 0.00::numeric, 190.00::numeric, false),
    -- 4. Arrondi d'encaissement
    (4, 199.00::numeric, 199.00::numeric,  0.00::numeric,  0.00::numeric, 1.00::numeric, 200.00::numeric, false),
    -- 5. Combinaison remise + livraison + arrondi
    (5, 200.00::numeric, 200.00::numeric, 10.00::numeric, 25.00::numeric, 1.00::numeric, 216.00::numeric, false),
    -- 6. Écart de lignes réelles (1 MAD)
    (6, 199.00::numeric, 200.00::numeric,  0.00::numeric,  0.00::numeric, 0.00::numeric, 200.00::numeric, true),
    -- 7. Limite de tolérance : 0,01 exact => pas d'anomalie
    (7, 200.00::numeric, 200.01::numeric,  0.00::numeric,  0.00::numeric, 0.00::numeric, 200.01::numeric, false),
    -- 8. Dépassement de tolérance : 0,02 => anomalie
    (8, 200.00::numeric, 200.02::numeric,  0.00::numeric,  0.00::numeric, 0.00::numeric, 200.02::numeric, true),
    -- 9. Total incohérent avec la formule (10 MAD manquants)
    (9, 200.00::numeric, 200.00::numeric,  0.00::numeric,  0.00::numeric, 0.00::numeric, 190.00::numeric, true),
    -- 10. Remise oubliée dans le total (total trop élevé)
    (10, 200.00::numeric, 200.00::numeric, 15.00::numeric, 0.00::numeric, 0.00::numeric, 200.00::numeric, true)
),
evaluated as (
  select
    c.id,
    c.expect_mismatch,
    (
      abs(c.lines_rev - c.subtotal) > 0.01
      or abs(c.total - greatest(0, c.subtotal - c.discount + c.ship_customer + c.rounding)) > 0.01
    ) as observed_mismatch
  from cases c
)
select id,
       case when expect_mismatch then 'attendu anomalie' else 'attendu conforme' end as expected,
       case when observed_mismatch then 'observé anomalie' else 'observé conforme' end as observed,
       case when observed_mismatch = expect_mismatch then 'PASS' else 'FAIL' end as status
from evaluated
order by id;
