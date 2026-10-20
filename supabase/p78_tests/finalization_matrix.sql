-- P7.8 — tests déterministes de la finalisation (aucune fonction, aucune écriture).
--
-- Reproduit la matrice de décision de dashboard_kpi_finalize_store_state :
--   bornes = union(plage déclarée, couverture réellement calculée) ;
--   done uniquement si jours calculés complets, aucun jour sale, les deux axes,
--   version/fuseau/devise homogènes.
-- Attendu : 8/8 PASS.

with bounds(case_id, declared_from, declared_to, min_d, max_d) as (
  values
    ('complete',    date '2026-09-01', date '2026-09-03', date '2026-09-01', date '2026-09-03'),
    ('missing',     date '2026-09-01', date '2026-09-03', date '2026-09-01', date '2026-09-03'),
    ('dirty',       date '2026-09-01', date '2026-09-03', date '2026-09-01', date '2026-09-03'),
    ('no_delivery', date '2026-09-01', date '2026-09-03', date '2026-09-01', date '2026-09-03'),
    ('other_ver',   date '2026-09-01', date '2026-09-03', date '2026-09-01', date '2026-09-03'),
    ('bad_config',  date '2026-09-01', date '2026-09-03', date '2026-09-01', date '2026-09-03'),
    ('extend',      date '2026-09-01', date '2026-09-02', date '2026-09-01', date '2026-09-03'),
    ('no_shrink',   date '2026-09-01', date '2026-09-10', date '2026-09-01', date '2026-09-03')
),
flags(case_id, day, has_order, has_delivery, dirty, other_version, bad_config) as (
  values
    ('complete',    date '2026-09-01', true,  true,  false, false, false),
    ('complete',    date '2026-09-02', true,  true,  false, false, false),
    ('complete',    date '2026-09-03', true,  true,  false, false, false),
    ('missing',     date '2026-09-01', true,  true,  false, false, false),
    ('missing',     date '2026-09-02', false, false, false, false, false),
    ('missing',     date '2026-09-03', true,  true,  false, false, false),
    ('dirty',       date '2026-09-01', true,  true,  false, false, false),
    ('dirty',       date '2026-09-02', true,  true,  true,  false, false),
    ('dirty',       date '2026-09-03', true,  true,  false, false, false),
    ('no_delivery', date '2026-09-01', true,  true,  false, false, false),
    ('no_delivery', date '2026-09-02', true,  false, false, false, false),
    ('no_delivery', date '2026-09-03', true,  true,  false, false, false),
    ('other_ver',   date '2026-09-01', true,  true,  false, true,  false),
    ('other_ver',   date '2026-09-02', true,  true,  false, false, false),
    ('other_ver',   date '2026-09-03', true,  true,  false, false, false),
    ('bad_config',  date '2026-09-01', true,  true,  false, false, true),
    ('bad_config',  date '2026-09-02', true,  true,  false, false, false),
    ('bad_config',  date '2026-09-03', true,  true,  false, false, false),
    ('extend',      date '2026-09-01', true,  true,  false, false, false),
    ('extend',      date '2026-09-02', true,  true,  false, false, false),
    ('extend',      date '2026-09-03', true,  true,  false, false, false),
    ('no_shrink',   date '2026-09-01', true,  true,  false, false, false),
    ('no_shrink',   date '2026-09-02', true,  true,  false, false, false),
    ('no_shrink',   date '2026-09-03', true,  true,  false, false, false)
),
cov_range as (
  select b.case_id,
         least(coalesce(b.declared_from, b.min_d), b.min_d) as from_d,
         greatest(coalesce(b.declared_to, b.max_d), b.max_d) as to_d
    from bounds b
),
days as (
  select r.case_id, g::date as d_day
    from cov_range r
    cross join lateral generate_series(r.from_d::timestamp, r.to_d::timestamp, interval '1 day') g
),
joined as (
  select d.case_id, d.d_day as day,
         coalesce(f.has_order, false)      as has_order,
         coalesce(f.has_delivery, false)   as has_delivery,
         coalesce(f.dirty, false)          as dirty,
         coalesce(f.other_version, false)  as other_version,
         coalesce(f.bad_config, false)     as bad_config
    from days d
    left join flags f on f.case_id = d.case_id and f.day = d.d_day
),
agg as (
  select case_id,
         count(*) as expected,
         count(*) filter (where has_order) as computed,
         count(*) filter (where dirty) as dirty,
         count(*) filter (where has_order and not has_delivery) as missing_delivery,
         count(*) filter (where other_version or bad_config) as incompatible
    from joined group by case_id
),
evaluated as (
  select a.case_id, a.expected, a.computed, a.dirty, a.missing_delivery, a.incompatible,
         case
           when a.computed = a.expected and a.dirty = 0
                and a.missing_delivery = 0 and a.incompatible = 0 then null
           when a.computed < a.expected then 'missing_days'
           when a.dirty > 0 then 'dirty_days'
           when a.missing_delivery > 0 then 'missing_delivery_axis'
           else 'incompatible_partitions'
         end as observed_reason,
         r.from_d, r.to_d
    from agg a join cov_range r using (case_id)
),
expected(case_id, exp_expected, exp_computed, exp_reason, exp_from, exp_to) as (
  values
    ('complete',    3, 3, null::text,                date '2026-09-01', date '2026-09-03'),
    ('missing',     3, 2, 'missing_days',            date '2026-09-01', date '2026-09-03'),
    ('dirty',       3, 3, 'dirty_days',              date '2026-09-01', date '2026-09-03'),
    ('no_delivery', 3, 3, 'missing_delivery_axis',   date '2026-09-01', date '2026-09-03'),
    ('other_ver',   3, 3, 'incompatible_partitions', date '2026-09-01', date '2026-09-03'),
    ('bad_config',  3, 3, 'incompatible_partitions', date '2026-09-01', date '2026-09-03'),
    ('extend',      3, 3, null,                      date '2026-09-01', date '2026-09-03'),
    ('no_shrink',  10, 3, 'missing_days',            date '2026-09-01', date '2026-09-10')
)
select e.case_id, e.exp_expected, v.expected, e.exp_computed, v.computed,
       coalesce(e.exp_reason, '-') as expected_reason,
       coalesce(v.observed_reason, '-') as observed_reason,
       e.exp_from, v.from_d, e.exp_to, v.to_d,
       case when e.exp_expected = v.expected
             and e.exp_computed = v.computed
             and e.exp_reason is not distinct from v.observed_reason
             and e.exp_from = v.from_d
             and e.exp_to = v.to_d
            then 'PASS' else 'FAIL' end as status
  from expected e join evaluated v using (case_id)
 order by e.case_id;

