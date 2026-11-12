-- Catalogue additif. Préparé pour Production, appliqué uniquement en Q4.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create extension if not exists btree_gist with schema extensions;
set local search_path=public,extensions,pg_temp;

alter table public.plans add column code text;
alter table public.plans add column rank integer;
update public.plans set code = case lower(name)
  when 'free' then 'free' when 'gratuit' then 'free'
  when 'pro' then 'pro' when 'ultimate' then 'ultimate' end,
  rank = case lower(name) when 'free' then 0 when 'gratuit' then 0
  when 'pro' then 1 when 'ultimate' then 2 end;
do $$ begin
  if exists(select 1 from public.plans where code is null or rank is null) then
    raise exception 'UNMAPPED_PLAN: explicit catalog mapping required';
  end if;
end $$;
alter table public.plans alter column code set not null;
alter table public.plans alter column rank set not null;
alter table public.plans add constraint plans_code_key unique(code);
alter table public.plans add constraint plans_rank_key unique(rank);
alter table public.plans add constraint plans_code_valid check(code ~ '^[a-z][a-z0-9_]*$');
alter table public.plans add constraint plans_rank_valid check(rank >= 0);
comment on column public.plans.price is 'Historique uniquement. Tarification commerciale : plan_prices. Ne pas utiliser pour classer les droits.';

create table public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete restrict,
  billing_period text not null check(billing_period in ('monthly','yearly')),
  duration_months integer not null,
  amount_minor bigint not null check(amount_minor >= 0 and amount_minor <= 9007199254740991),
  currency text not null default 'MAD' check(currency = 'MAD'),
  available boolean not null default true,
  version integer not null check(version > 0),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  constraint plan_prices_period_duration check(
    (billing_period='monthly' and duration_months=1) or
    (billing_period='yearly' and duration_months=12)),
  constraint plan_prices_valid_range check(valid_until is null or valid_until > valid_from),
  constraint plan_prices_version_unique unique(plan_id,billing_period,currency,version),
  constraint plan_prices_no_overlap exclude using gist (
    plan_id with =, billing_period with =, currency with =,
    tstzrange(valid_from,valid_until,'[)') with &&) where (available)
);

-- Toute version est immuable, même avant usage. Seules sa fermeture et sa
-- disponibilité évoluent ; les futures demandes référenceront son UUID par FK.
create function public.protect_plan_price_version() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'PLAN_PRICE_IMMUTABLE'; end if;
  if (to_jsonb(new)-'available'-'valid_until') is distinct from
     (to_jsonb(old)-'available'-'valid_until') then
    raise exception 'PLAN_PRICE_IMMUTABLE';
  end if;
  if old.available=false and new.available=true then raise exception 'PLAN_PRICE_CLOSED'; end if;
  if old.valid_until is not null and
     (new.valid_until is null or new.valid_until > old.valid_until) then
    raise exception 'PLAN_PRICE_CLOSED';
  end if;
  return new;
end $$;
create trigger protect_plan_price_version before update or delete on public.plan_prices
  for each row execute function public.protect_plan_price_version();
alter table public.plan_prices enable row level security;
revoke all on public.plan_prices from public,anon,authenticated;
grant all on public.plan_prices to service_role;
revoke truncate on public.plans,public.subscriptions from public,anon,authenticated;

create function public.rpc_public_plan_catalog()
returns table (
  price_id uuid,plan_id uuid,code text,name text,rank integer,
  billing_period text,duration_months integer,amount_minor bigint,
  currency text,version integer,valid_from timestamptz,valid_until timestamptz,
  monthly_equivalent_minor numeric,requires_payment boolean,commitment_months integer,
  order_limit integer,stores_limit integer,ai_credits_monthly integer,
  delivery_integrations_limit integer,confirmation_agents_limit integer,
  ads_automation_enabled boolean,api_access_enabled boolean
)
language sql stable security definer set search_path=public,pg_temp as $$
  select pp.id,p.id,p.code,p.name,p.rank,pp.billing_period,pp.duration_months,
    pp.amount_minor,pp.currency,pp.version,pp.valid_from,pp.valid_until,
    pp.amount_minor::numeric/pp.duration_months,pp.amount_minor>0,
    case when pp.amount_minor=0 then 0 else pp.duration_months end,
    p.order_limit,p.stores_limit,p.ai_credits_monthly,
    p.delivery_integrations_limit,p.confirmation_agents_limit,
    p.ads_automation_enabled,p.api_access_enabled
  from public.plans p join public.plan_prices pp on pp.plan_id=p.id
  where pp.available and pp.valid_from<=now()
    and (pp.valid_until is null or pp.valid_until>now())
  order by p.rank,pp.duration_months;
$$;
revoke all on function public.rpc_public_plan_catalog() from public;
grant execute on function public.rpc_public_plan_catalog() to anon,authenticated,service_role;
revoke all on function public.protect_plan_price_version() from public,anon,authenticated;

-- Préserve les lignes d'abonnement ; seul le choix temporel des droits change.
create or replace function public.resolve_effective_plan(p_user_id uuid)
returns public.plans language sql stable security definer set search_path=public,pg_temp as $$
  select p from public.plans p where p.id=coalesce(
    (select s.plan_id from public.subscriptions s join public.plans q on q.id=s.plan_id
     where s.user_id=p_user_id and s.status='active'
       and (s.started_at is null or s.started_at<=now())
       and (s.expires_at is null or s.expires_at>now())
     order by q.rank desc,s.started_at desc nulls last,s.created_at desc,s.id limit 1),
    (select f.id from public.plans f where f.code='free'));
$$;

-- Modification contrôlée du corps existant pour conserver son contrat complet.
do $$ declare definition text; begin
  select pg_get_functiondef('public.rpc_billing_status()'::regprocedure) into definition;
  if position('order by p.price desc, s.started_at desc nulls last, s.created_at desc' in definition)=0
     or position('and s.status = ''active''' in definition)=0 then
    raise exception 'UNEXPECTED_BILLING_STATUS_BODY';
  end if;
  definition := replace(definition,
    'order by p.price desc, s.started_at desc nulls last, s.created_at desc',
    'order by p.rank desc, s.started_at desc nulls last, s.created_at desc, s.id');
  definition := replace(definition,'and s.status = ''active''',
    'and s.status = ''active'' and (s.started_at is null or s.started_at <= now())');
  execute definition;
end $$;
commit;