-- ============================================================================
-- JISRA — KPI V5 Phase 2 / 93 — CAPTURE DE SOCLE (LECTURE SEULE)
-- ============================================================================
-- Objet : figer l'état de référence AVANT toute installation, sans lire de
-- donnée métier autre que des compteurs. Aucune écriture permanente : une
-- table temporaire de session, supprimée au COMMIT.
--
-- Usage :
--   psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f 93_preflight_capture.sql
--
-- Interdits respectés : aucune installation, aucune activation, aucun job,
-- aucun appel réseau, aucune modification de règle financière.
--
-- Lecture du résultat :
--   * `kpi` doit être vide / à zéro sur une cible saine avant installation ;
--   * `prerequisites` doit être à true, sauf `pg_cron` / `pg_net`, requis
--     uniquement par les lots d'activation A et D ;
--   * `p8` reflète l'état sécurité réel : `false` signifie que les migrations
--     P8 ne sont pas encore appliquées sur cette cible ;
--   * `counts` sert de référence de non-perte au rollback combiné (92).
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

create temp table _p79_capture(section text, payload jsonb) on commit drop;

insert into _p79_capture(section, payload)
select 'identity', jsonb_build_object(
  'captured_at', now(),
  'database', current_database(),
  'role', current_user,
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num')
);

do $capture$
declare
  v jsonb;
  v_partial jsonb;
  v_jobs jsonb;
  r record;
begin
  -- 1. Compteurs métier et KPI (référence de non-perte).
  v := '{}'::jsonb;
  for r in
    select * from (values
      ('stores',                    'public.stores'),
      ('orders',                    'public.orders'),
      ('order_items',               'public.order_items'),
      ('ad_spend_daily',            'public.ad_spend_daily'),
      ('dashboard_daily_metrics',   'public.dashboard_daily_metrics'),
      ('dashboard_kpi_invalidation', 'public.dashboard_kpi_invalidation'),
      ('dashboard_kpi_worker_run',  'public.dashboard_kpi_worker_run'),
      ('dashboard_kpi_store_state', 'public.dashboard_kpi_store_state')
    ) t(k, rel)
  loop
    if to_regclass(r.rel) is null then
      v := v || jsonb_build_object(r.k, 'ABSENT');
    else
      execute format('select jsonb_build_object(%L, count(*)) from %s', r.k, r.rel)
        into v_partial;
      v := v || v_partial;
    end if;
  end loop;
  insert into _p79_capture(section, payload) values ('counts', v);

  -- 2. Objets KPI déjà installés (doit être vide avant l'étape 1 du manifeste).
  --    cron.job est résolu dynamiquement : la table peut ne pas exister.
  if to_regclass('cron.job') is null then
    v_jobs := '"ABSENT"'::jsonb;
  else
    execute 'select coalesce(jsonb_agg(jobname order by jobname), ''[]''::jsonb)
               from cron.job where jobname like ''jisra\_kpi%''' into v_jobs;
  end if;

  v := jsonb_build_object(
    'tables', (
      select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and (c.relname like 'dashboard\_%' or c.relname like 'kpi\_%')
    ),
    'functions', (
      select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'dashboard\_kpi\_%'
    ),
    'triggers', (
      select coalesce(jsonb_agg(t.tgname order by t.tgname), '[]'::jsonb)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where not t.tgisinternal and n.nspname = 'public'
         and t.tgname like 'trg\_kpi\_%'
    ),
    'cron_jobs', v_jobs
  );
  insert into _p79_capture(section, payload) values ('kpi', v);

  -- 3. Préconditions du socle.
  v := jsonb_build_object(
    'pg_cron', (select extversion from pg_extension where extname = 'pg_cron'),
    'pg_net',  (select extversion from pg_extension where extname = 'pg_net'),
    'vault_schema', exists (select 1 from pg_namespace where nspname = 'vault'),
    'can_view_store_finances', to_regprocedure('public.can_view_store_finances(uuid)') is not null,
    'order_purchase_cost',     to_regprocedure('public.order_purchase_cost(text,numeric,numeric)') is not null,
    'dashboard_legacy_access', to_regprocedure('public.dashboard_legacy_access(uuid)') is not null,
    'rbl4_impl_revenue_chart', to_regprocedure('public._rbl4_impl_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)') is not null,
    'tables', (
      select jsonb_object_agg(t.k, to_regclass(t.rel) is not null)
        from (values
          ('store_members',               'public.store_members'),
          ('profiles',                    'public.profiles'),
          ('products',                    'public.products'),
          ('product_variants',            'public.product_variants'),
          ('product_images',              'public.product_images'),
          ('inventory_movements',         'public.inventory_movements'),
          ('expenses',                    'public.expenses'),
          ('expense_recurring_templates', 'public.expense_recurring_templates'),
          ('team_invitations',            'public.team_invitations'),
          ('team_invitation_assignments', 'public.team_invitation_assignments')
        ) t(k, rel)
    )
  );
  insert into _p79_capture(section, payload) values ('prerequisites', v);

  -- 4. État sécurité P8 (doit rester identique après tout rollback KPI).
  v := jsonb_build_object(
    'p8_1_can_invite_to_store',       to_regprocedure('public.can_invite_to_store(uuid,uuid)') is not null,
    'p8_2_can_manage_store_expenses', to_regprocedure('public.can_manage_store_expenses(uuid)') is not null,
    'p8_3_product_functions',         to_regprocedure('public.can_manage_store_products(uuid)') is not null
                                      and to_regprocedure('public.can_view_store_products(uuid)') is not null,
    'p8_4_delivery_trigger',          exists (select 1 from pg_trigger
                                               where tgname = 'a_p84_delivery_order_columns'),
    'p8_4_confirmation_guarded',      exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'rpc_order_confirmation_action'
         and pg_get_functiondef(p.oid) like '%v_actor_role is null%'
    ),
    'policy_digest', (
      select md5(coalesce(string_agg(
               c.relname || '|' || pol.polname || '|' || pol.polcmd::text || '|' ||
               coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' ||
               coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
               E'\n' order by c.relname, pol.polname), ''))
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
    ),
    'function_digest', (
      select md5(coalesce(string_agg(
               p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' ||
               md5(pg_get_functiondef(p.oid)),
               E'\n' order by p.proname, pg_get_function_identity_arguments(p.oid)), ''))
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prokind = 'f'
         and (p.proname like 'can\_%' or p.proname like 'p84\_%'
              or p.proname in ('accept_team_invitation', 'rpc_order_confirmation_action',
                               'rpc_update_confirmation_order_details'))
    )
  );
  insert into _p79_capture(section, payload) values ('p8', v);

  -- 5. Historique des migrations (lecture seule ; table absente = ABSENT).
  if to_regclass('supabase_migrations.schema_migrations') is null then
    insert into _p79_capture(section, payload)
    values ('history', jsonb_build_object('history', 'ABSENT'));
  else
    execute $hist$
      select jsonb_build_object(
        'count', count(*),
        'max_version', max(version),
        'last_5', (select jsonb_agg(x.version order by x.version desc)
                     from (select version from supabase_migrations.schema_migrations
                            order by version desc limit 5) x)
      )
      from supabase_migrations.schema_migrations
    $hist$ into v;
    insert into _p79_capture(section, payload) values ('history', v);
  end if;

  -- 6. ACL du lecteur V5 et des surcharges sensibles.
  v := jsonb_build_object(
    'reader_authenticated', coalesce(has_function_privilege('authenticated',
        to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)'), 'execute'), false),
    'reader_anon', coalesce(has_function_privilege('anon',
        to_regprocedure('public.rpc_dashboard_kpi_reader(uuid[],date,date,boolean)'), 'execute'), false),
    'surcharge_authenticated', coalesce(has_function_privilege('authenticated',
        to_regprocedure('public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)'), 'execute'), false),
    'surcharge_anon', coalesce(has_function_privilege('anon',
        to_regprocedure('public.rpc_dashboard_revenue_chart(uuid[],timestamptz,timestamptz,text,timestamptz,timestamptz)'), 'execute'), false)
  );
  insert into _p79_capture(section, payload) values ('acl', v);
end
$capture$;

select section, jsonb_pretty(payload) as payload
from _p79_capture
order by section;
