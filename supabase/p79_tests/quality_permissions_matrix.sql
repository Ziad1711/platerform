-- P7.9 — matrice de décision des permissions de rpc_dashboard_kpi_quality_status.
--
-- Lecture seule (VALUES uniquement). Reproduit la classification de
-- `dashboard_kpi_access_level` et la règle de masquage P7.9 :
--   full       -> diagnostics financiers visibles ;
--   commercial -> mismatch_orders et data_issues_orders à null ;
--   none       -> DASHBOARD_NO_ACCESS (refus explicite, jamais de zéros muets).
--
-- Attendu : 10 lignes, toutes PASS. À exécuter après autorisation.

with cases(case_id, is_owner, member_role, member_status,
           exp_level, exp_refusal, exp_financial_visible) as (
  values
    ('owner_of_store',        true,  null,         null,       'full',       false, true),
    ('admin_active',          false, 'admin',      'active',   'full',       false, true),
    ('accountant_active',     false, 'accountant', 'active',   'full',       false, true),
    ('owner_role_active',     false, 'owner',      'active',   'full',       false, true),
    ('viewer_active',         false, 'viewer',     'active',   'commercial', false, false),
    ('marketer_active',       false, 'marketer',   'active',   'commercial', false, false),
    ('staff_active',          false, 'staff',      'active',   'none',       true,  false),
    ('viewer_inactive',       false, 'viewer',     'inactive', 'none',       true,  false),
    ('viewer_pending',        false, 'viewer',     'pending',  'none',       true,  false),
    ('foreign_user',          false, null,         null,       'none',       true,  false)
),
evaluated as (
  select c.*,
         case
           when c.is_owner then 'full'
           when c.member_status = 'active'
                and c.member_role in ('owner', 'admin', 'accountant') then 'full'
           when c.member_status = 'active'
                and c.member_role in ('marketer', 'viewer') then 'commercial'
           else 'none'
         end as observed_level
    from cases c
),
projected as (
  select e.*,
         (e.observed_level = 'none') as observed_refusal,
         (e.observed_level = 'full') as observed_financial_visible
    from evaluated e
)
select case_id, exp_level, observed_level,
       exp_refusal, observed_refusal,
       exp_financial_visible, observed_financial_visible,
       case when exp_level = observed_level
             and exp_refusal = observed_refusal
             and exp_financial_visible = observed_financial_visible
            then 'PASS' else 'FAIL' end as status
  from projected
 order by case_id;
