-- P7.9 — matrice des transitions de dashboard_kpi_finalize_store_state.
--
-- Lecture seule (VALUES uniquement) : reproduit la décision du correctif P7.9
-- et vérifie que chaque transition attendue est bien celle produite.
-- À exécuter sur jisra-test après autorisation (aucune écriture).
-- Attendu : 13 lignes, toutes PASS.
-- Cas `no_state` exclu de la matrice : la fonction retourne avant tout calcul
-- (`{updated:false, reason:'no_state'}`) et n'écrit rien ; il est donc
-- volontairement NON COUVERT ici (voir README).
--
-- Colonnes d'entrée :
--   declared_state   état présent avant l'appel
--   has_partitions   au moins une partition dans la version active
--   expected_days    largeur de la plage déclarée après extension
--   computed         jours avec axe order
--   dirty            jours avec invalidation en attente dans la plage
--   missing_delivery jours sans axe delivery
--   incompatible     jours d'une autre version / mauvais fuseau ou devise
--   pending_total    jours en attente sur TOUTE la boutique (plage incluse)

with cases(case_id, declared_state, has_partitions,
           expected_days, computed, dirty, missing_delivery, incompatible, pending_total,
           exp_reason, exp_state, exp_computed) as (
  values
    ('complete_idle',        'idle',    true,  3, 3, 0, 0, 0, 0, null::text,                'done',    3),
    ('complete_done',        'done',    true,  3, 3, 0, 0, 0, 0, null,                      'done',    3),
    ('complete_paused',      'paused',  true,  3, 3, 0, 0, 0, 0, null,                      'paused',  3),
    ('complete_error',       'error',   true,  3, 3, 0, 0, 0, 0, null,                      'error',   3),
    ('dirty_from_done',      'done',    true,  3, 3, 1, 0, 0, 1, 'dirty_days',              'running', 3),
    ('dirty_from_paused',    'paused',  true,  3, 3, 1, 0, 0, 1, 'dirty_days',              'paused',  3),
    ('pending_outside',      'done',    true,  3, 3, 0, 0, 0, 2, 'pending_outside_range',   'running', 3),
    ('missing_days',         'idle',    true,  3, 2, 0, 0, 0, 0, 'missing_days',           'running', 2),
    ('missing_delivery',     'idle',    true,  3, 3, 0, 1, 0, 0, 'missing_delivery_axis',  'running', 3),
    ('incompatible',         'idle',    true,  3, 3, 0, 0, 1, 0, 'incompatible_partitions','running', 3),
    ('no_partitions_done',   'done',    false, 0, 0, 0, 0, 0, 0, 'no_partitions',          'idle',    0),
    ('no_partitions_paused', 'paused',  false, 0, 0, 0, 0, 0, 0, 'no_partitions',          'paused',  0),
    ('no_partitions_error',  'error',   false, 0, 0, 0, 0, 0, 0, 'no_partitions',          'error',   0)
),
evaluated as (
  select c.*,
         case
           when not c.has_partitions then 'no_partitions'
           when c.computed = c.expected_days and c.dirty = 0
                and c.missing_delivery = 0 and c.incompatible = 0
                and c.pending_total = 0 then null
           when c.computed < c.expected_days then 'missing_days'
           when c.dirty > 0 then 'dirty_days'
           when c.missing_delivery > 0 then 'missing_delivery_axis'
           when c.incompatible > 0 then 'incompatible_partitions'
           else 'pending_outside_range'
         end as observed_reason
    from cases c
),
projected as (
  select e.*,
         case
           when not e.has_partitions then
             case when e.declared_state in ('paused', 'error') then e.declared_state
                  when e.declared_state = 'done' then 'idle'
                  else e.declared_state end
           when e.declared_state in ('paused', 'error') then e.declared_state
           when e.observed_reason is null then 'done'
           when e.declared_state in ('done', 'idle') then 'running'
           else e.declared_state
         end as observed_state,
         case when e.has_partitions then e.computed else 0 end as observed_computed
    from evaluated e
)
select p.case_id,
       coalesce(p.exp_reason, '-') as expected_reason,
       coalesce(p.observed_reason, '-') as observed_reason,
       p.exp_state, p.observed_state,
       p.exp_computed, p.observed_computed,
       case when p.exp_reason is not distinct from p.observed_reason
             and p.exp_state = p.observed_state
             and p.exp_computed = p.observed_computed
            then 'PASS' else 'FAIL' end as status
  from projected p
 order by p.case_id;
