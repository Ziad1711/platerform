-- ============================================================================
-- 20 — Vérification que le schéma cible est PRÊT pour 01/02/03b/05b
-- LECTURE SEULE. À exécuter avant toute migration et avant les fixtures.
-- Échoue (NO-GO) si un objet requis manque : les tests n'auraient pas de sens.
-- ============================================================================
\set ON_ERROR_STOP on

begin;

create table if not exists audit.required_columns (
  tbl text not null,
  col text not null,
  primary key (tbl, col)
);

delete from audit.required_columns;

insert into audit.required_columns (tbl, col) values
  ('chat_threads','id'), ('chat_threads','user_id'), ('chat_threads','store_id'),
  ('chat_threads','title'), ('chat_threads','is_pinned'),
  ('chat_threads','created_at'), ('chat_threads','updated_at'),
  ('chat_messages','id'), ('chat_messages','thread_id'), ('chat_messages','role'),
  ('chat_messages','content'), ('chat_messages','credits_used'),
  ('chat_messages','metadata'), ('chat_messages','created_at'),
  ('ai_usage','user_id'), ('ai_usage','store_id'), ('ai_usage','thread_id'),
  ('ai_usage','feature'), ('ai_usage','credits_used'), ('ai_usage','input_tokens'),
  ('ai_usage','output_tokens'), ('ai_usage','provider_name'), ('ai_usage','model_name'),
  ('ai_usage','provider_cost_usd'),
  ('ai_credit_wallets','id'), ('ai_credit_wallets','user_id'),
  ('ai_credit_wallets','monthly_credits'), ('ai_credit_wallets','credits_used'),
  ('ai_credit_wallets','reset_date'), ('ai_credit_wallets','updated_at'),
  ('profiles','id'),
  ('stores','id'), ('stores','owner_user_id'),
  ('store_members','store_id'), ('store_members','user_id'),
  ('store_members','role'), ('store_members','status'),
  ('plans','id'), ('plans','price'), ('plans','ai_credits_monthly'),
  ('subscriptions','user_id'), ('subscriptions','plan_id'), ('subscriptions','status'),
  ('subscriptions','started_at'), ('subscriptions','created_at'), ('subscriptions','expires_at');

-- Colonnes manquantes
select
  count(*) as missing_columns,
  string_agg(rc.tbl || '.' || rc.col, ', ' order by rc.tbl, rc.col) as missing
  from audit.required_columns rc
 where not exists (
   select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = rc.tbl and c.column_name = rc.col
 )
\gset

-- Fonctions requises (dépendances réelles de 02 et 05b)
select count(*) as missing_functions
  from (values
    ('resolve_effective_plan', 1),
    ('sync_ai_credit_wallet_for_plan', 2),
    ('can_view_store_finances', 1)
  ) v(fname, nargs)
 where not exists (
   select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v.fname and p.pronargs = v.nargs
 )
\gset

-- RLS active sur les tables dont l'audit dépend
select count(*) as tables_without_rls
  from (values ('chat_threads'),('chat_messages'),('ai_usage'),
               ('ai_credit_wallets'),('store_members')) v(t)
 where coalesce((
   select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v.t
 ), false) is not true
\gset

commit;

select
  :missing_columns as missing_columns,
  coalesce(:'missing', '(aucune)') as colonnes_manquantes,
  :missing_functions as missing_functions,
  :tables_without_rls as tables_without_rls;

select (:missing_columns + :missing_functions) > 0 as schema_incomplete \gset

\echo ''
\if :schema_incomplete
\echo 'NO-GO : schéma incomplet. Les migrations 01/02/03b/05b ne peuvent pas être'
\echo 'appliquées ni testées sur cette base. Corriger la source de schéma.'
\else
\echo 'SCHEMA READY : tous les objets requis sont présents.'
\endif

\echo 'REVIEW : tables sans RLS (doit être 0) et contraintes FK de chat_messages /'
\echo 'assistant_requests.thread_id (on delete cascade|set null|restrict) :'
select conrelid::regclass as relation, conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid in (to_regclass('public.chat_messages'), to_regclass('public.assistant_requests'))
   and contype = 'f'
 order by 1, 2;
