-- P7.4 — configuration de rollout KPI V5 (Test uniquement).
-- OFF par défaut : kill switch actif, mode legacy, aucune cohorte.
-- N'altère aucun trigger métier, worker, job ou définition financière.

create table if not exists public.dashboard_kpi_rollout_config (
  id smallint primary key default 1 check (id = 1),
  kill_switch boolean not null default true,
  requested_mode text not null default 'legacy'
    check (requested_mode in ('legacy', 'shadow', 'v5')),
  readiness_rbl4 boolean not null default false,
  readiness_tzdata boolean not null default false,
  readiness_backend boolean not null default false,
  shadow_sample_pct integer not null default 10
    check (shadow_sample_pct between 1 and 100),
  config_version bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.dashboard_kpi_rollout_cohorts (
  store_id uuid primary key references public.stores(id) on delete cascade,
  mode text not null check (mode in ('shadow', 'v5')),
  cohort text not null default 'pilot',
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.dashboard_kpi_rollout_events (
  id bigserial primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  user_id uuid,
  store_ids uuid[] not null default '{}'::uuid[],
  mode text not null,
  event text not null,
  widget text,
  duration_ms integer,
  error_code text,
  config_version bigint,
  details jsonb not null default '{}'::jsonb
);

create index if not exists idx_kpi_rollout_events_time
  on public.dashboard_kpi_rollout_events (occurred_at desc);
create index if not exists idx_kpi_rollout_events_user
  on public.dashboard_kpi_rollout_events (user_id, occurred_at desc);

create or replace function public.rollout_config_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.config_version := old.config_version + 1;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_rollout_config_touch on public.dashboard_kpi_rollout_config;
create trigger trg_rollout_config_touch
  before update on public.dashboard_kpi_rollout_config
  for each row execute function public.rollout_config_touch();

create or replace function public.rollout_cohort_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  update public.dashboard_kpi_rollout_config
     set updated_at = clock_timestamp()
   where id = 1;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;

drop trigger if exists trg_rollout_cohort_touch on public.dashboard_kpi_rollout_cohorts;
create trigger trg_rollout_cohort_touch
  after insert or update or delete on public.dashboard_kpi_rollout_cohorts
  for each row execute function public.rollout_cohort_touch();

insert into public.dashboard_kpi_rollout_config (id)
values (1)
on conflict (id) do nothing;

alter table public.dashboard_kpi_rollout_config enable row level security;
alter table public.dashboard_kpi_rollout_cohorts enable row level security;
alter table public.dashboard_kpi_rollout_events enable row level security;

revoke all on table public.dashboard_kpi_rollout_config from public, anon, authenticated;
revoke all on table public.dashboard_kpi_rollout_cohorts from public, anon, authenticated;
revoke all on table public.dashboard_kpi_rollout_events from public, anon, authenticated;
grant all on table public.dashboard_kpi_rollout_config to service_role;
grant all on table public.dashboard_kpi_rollout_cohorts to service_role;
grant all on table public.dashboard_kpi_rollout_events to service_role;

revoke all on sequence public.dashboard_kpi_rollout_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.dashboard_kpi_rollout_events_id_seq to service_role;

revoke all on function public.rollout_config_touch() from public, anon, authenticated;
revoke all on function public.rollout_cohort_touch() from public, anon, authenticated;
grant execute on function public.rollout_config_touch() to service_role;
grant execute on function public.rollout_cohort_touch() to service_role;
