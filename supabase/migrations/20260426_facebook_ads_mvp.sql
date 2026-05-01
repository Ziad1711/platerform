begin;

alter table public.ad_spend_daily
  rename column amount to spend;

alter table public.ad_spend_daily
  add column if not exists product_id uuid null,
  add column if not exists spend_currency text null,
  add column if not exists currency_convert text null,
  add column if not exists spend_converted numeric(12,2) not null default 0,
  add column if not exists is_provisional boolean not null default false,
  add column if not exists external_account_id text null,
  add column if not exists external_campaign_id text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ad_spend_daily_product_id_fkey'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_product_id_fkey
      foreign key (product_id) references public.products(id) on delete set null;
  end if;
end
$$;

alter table public.ad_spend_daily
  drop constraint if exists ad_spend_daily_amount_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_spend_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_spend_check check (spend >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_spend_converted_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_spend_converted_check check (spend_converted >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_spend_currency_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_spend_currency_check check (spend_currency is null or char_length(spend_currency) = 3);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_currency_convert_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_currency_convert_check check (currency_convert is null or char_length(currency_convert) = 3);
  end if;
end
$$;

create index if not exists idx_ad_spend_daily_product on public.ad_spend_daily using btree (product_id);
create index if not exists idx_ad_spend_daily_store_product_date on public.ad_spend_daily using btree (store_id, product_id, spend_date);
create index if not exists idx_ad_spend_daily_external_campaign on public.ad_spend_daily using btree (external_campaign_id);

create unique index if not exists uq_ad_spend_daily_store_platform_campaign_date
on public.ad_spend_daily (
  store_id,
  platform,
  coalesce(external_account_id, ''),
  coalesce(external_campaign_id, ''),
  spend_date,
  coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

create or replace function public.get_effective_exchange_rate(
  p_owner_user_id uuid,
  p_base_currency text,
  p_target_currency text,
  p_rate_date date
)
returns numeric(12,6)
language plpgsql
as $$
declare
  v_rate numeric(12,6);
begin
  if upper(coalesce(p_base_currency, '')) = upper(coalesce(p_target_currency, '')) then
    return 1;
  end if;

  select er.rate
  into v_rate
  from public.exchange_rates er
  where upper(er.base_currency) = upper(p_base_currency)
    and upper(er.target_currency) = upper(p_target_currency)
    and er.rate_date <= p_rate_date
    and (er.owner_user_id = p_owner_user_id or er.owner_user_id is null)
  order by
    case when er.owner_user_id = p_owner_user_id then 0 else 1 end,
    er.rate_date desc,
    er.created_at desc
  limit 1;

  return v_rate;
end;
$$;

create or replace function public.set_ad_spend_converted()
returns trigger
language plpgsql
as $$
declare
  v_store_currency text;
  v_owner_user_id uuid;
  v_rate numeric(12,6);
begin
  select s.currency, s.owner_user_id
  into v_store_currency, v_owner_user_id
  from public.stores s
  where s.id = new.store_id;

  new.spend_currency := upper(coalesce(new.spend_currency, 'USD'));
  new.currency_convert := upper(coalesce(new.currency_convert, v_store_currency));

  v_rate := public.get_effective_exchange_rate(
    v_owner_user_id,
    new.spend_currency,
    new.currency_convert,
    new.spend_date::date
  );

  if v_rate is null then
    if new.spend_currency = new.currency_convert then
      v_rate := 1;
    else
      raise exception 'EXCHANGE_RATE_NOT_FOUND: % -> % on %', new.spend_currency, new.currency_convert, new.spend_date::date;
    end if;
  end if;

  new.spend_converted := round(coalesce(new.spend, 0) * v_rate, 2);
  return new;
end;
$$;

drop trigger if exists trg_set_ad_spend_converted on public.ad_spend_daily;
create trigger trg_set_ad_spend_converted
before insert or update of spend, spend_currency, currency_convert, spend_date, store_id
on public.ad_spend_daily
for each row
execute function public.set_ad_spend_converted();

create or replace function public.allocate_ads_cost_for_day(p_store_id uuid, p_day date)
returns void
language plpgsql
as $$
declare
  v_total_ads numeric(12,2) := 0;
  v_orders_count integer := 0;
  v_cost_per_order numeric(12,2) := 0;
  v_has_daily_spend boolean := false;
begin
  select count(*) > 0,
         coalesce(sum(spend_converted), 0)
  into v_has_daily_spend, v_total_ads
  from public.ad_spend_daily
  where store_id = p_store_id
    and spend_date::date = p_day;

  if not v_has_daily_spend then
    return;
  end if;

  select count(*)
  into v_orders_count
  from public.orders
  where store_id = p_store_id
    and order_date::date = p_day
    and status = 'delivered'
    and source = 'ads';

  if v_orders_count > 0 then
    v_cost_per_order := round(v_total_ads / v_orders_count, 2);
  else
    v_cost_per_order := 0;
  end if;

  update public.orders
  set ads_cost_allocated = v_cost_per_order
  where store_id = p_store_id
    and order_date::date = p_day
    and status = 'delivered'
    and source = 'ads'
    and ads_cost_allocated is distinct from v_cost_per_order;

  update public.orders
  set ads_cost_allocated = 0
  where store_id = p_store_id
    and order_date::date = p_day
    and (status <> 'delivered' or source <> 'ads')
    and ads_cost_allocated is distinct from 0;
end;
$$;

create or replace function public.trigger_allocate_ads_from_ad_spend()
returns trigger
language plpgsql
as $$
begin
  perform public.allocate_ads_cost_for_day(new.store_id, new.spend_date::date);
  return new;
end;
$$;

drop trigger if exists trg_allocate_ads_on_ad_spend on public.ad_spend_daily;
create trigger trg_allocate_ads_on_ad_spend
after insert or update of spend, spend_converted, spend_date, store_id, product_id, is_provisional
on public.ad_spend_daily
for each row
execute function public.trigger_allocate_ads_from_ad_spend();

create table if not exists public.facebook_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid null references public.stores(id) on delete cascade,
  account_id text not null,
  account_name text not null,
  account_currency text not null,
  timezone_name text null,
  timezone_offset_hours integer null,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (integration_id, account_id)
);

create table if not exists public.facebook_campaign_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  ad_account_id uuid not null references public.facebook_ad_accounts(id) on delete cascade,
  external_campaign_id text not null,
  campaign_name text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (ad_account_id, external_campaign_id, store_id)
);

create table if not exists public.facebook_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid null references public.stores(id) on delete cascade,
  job_type text not null check (job_type in ('daily_final', 'attribution_resync', 'manual', 'live_refresh', 'token_refresh')),
  sync_from date not null,
  sync_to date not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  attempts integer not null default 0,
  error_message text null,
  started_at timestamp with time zone null,
  finished_at timestamp with time zone null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.facebook_sync_errors (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid null references public.integrations(id) on delete set null,
  ad_account_id uuid null references public.facebook_ad_accounts(id) on delete set null,
  store_id uuid null references public.stores(id) on delete set null,
  error_code text null,
  error_subcode text null,
  error_type text null,
  error_message text not null,
  payload jsonb null,
  created_at timestamp with time zone not null default now()
);

alter table public.integrations
  add column if not exists token_expires_at timestamp with time zone null,
  add column if not exists meta_user_id text null,
  add column if not exists granted_scopes text[] null;

create index if not exists idx_facebook_ad_accounts_integration on public.facebook_ad_accounts(integration_id);
create index if not exists idx_facebook_campaign_mappings_store on public.facebook_campaign_mappings(store_id);
create index if not exists idx_facebook_sync_jobs_status on public.facebook_sync_jobs(status, created_at);
create index if not exists idx_facebook_sync_errors_integration on public.facebook_sync_errors(integration_id, created_at);

alter table public.facebook_ad_accounts enable row level security;
alter table public.facebook_campaign_mappings enable row level security;
alter table public.facebook_sync_jobs enable row level security;
alter table public.facebook_sync_errors enable row level security;

drop policy if exists facebook_ad_accounts_select on public.facebook_ad_accounts;
create policy facebook_ad_accounts_select
on public.facebook_ad_accounts for select
using (user_id = auth.uid());

drop policy if exists facebook_ad_accounts_all on public.facebook_ad_accounts;
create policy facebook_ad_accounts_all
on public.facebook_ad_accounts for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists facebook_campaign_mappings_select on public.facebook_campaign_mappings;
create policy facebook_campaign_mappings_select
on public.facebook_campaign_mappings for select
using (
  store_id in (
    select sm.store_id from public.store_members sm where sm.user_id = auth.uid()
  )
);

drop policy if exists facebook_campaign_mappings_all on public.facebook_campaign_mappings;
create policy facebook_campaign_mappings_all
on public.facebook_campaign_mappings for all
using (
  store_id in (
    select sm.store_id from public.store_members sm where sm.user_id = auth.uid()
  )
)
with check (
  store_id in (
    select sm.store_id from public.store_members sm where sm.user_id = auth.uid()
  )
);

drop policy if exists facebook_sync_jobs_select on public.facebook_sync_jobs;
create policy facebook_sync_jobs_select
on public.facebook_sync_jobs for select
using (user_id = auth.uid());

drop policy if exists facebook_sync_jobs_all on public.facebook_sync_jobs;
create policy facebook_sync_jobs_all
on public.facebook_sync_jobs for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists facebook_sync_errors_select on public.facebook_sync_errors;
create policy facebook_sync_errors_select
on public.facebook_sync_errors for select
using (
  store_id is null or store_id in (
    select sm.store_id from public.store_members sm where sm.user_id = auth.uid()
  )
);

drop trigger if exists set_facebook_ad_accounts_updated_at on public.facebook_ad_accounts;
create trigger set_facebook_ad_accounts_updated_at
before update on public.facebook_ad_accounts
for each row execute function public.handle_updated_at();

drop trigger if exists set_facebook_campaign_mappings_updated_at on public.facebook_campaign_mappings;
create trigger set_facebook_campaign_mappings_updated_at
before update on public.facebook_campaign_mappings
for each row execute function public.handle_updated_at();

insert into public.integration_providers (
  slug,
  name,
  description,
  category,
  logo_url,
  is_active,
  created_at,
  rating_avg,
  total_reviews
)
values (
  'facebook-ads',
  'Facebook Ads',
  'Connexion Facebook Ads pour récupérer automatiquement les dépenses publicitaires et mapper les campagnes aux produits.',
  'marketing',
  'https://static.xx.fbcdn.net/rsrc.php/y1/r/4lCu2zih0ca.svg',
  true,
  now(),
  5,
  0
)
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  logo_url = excluded.logo_url,
  is_active = excluded.is_active,
  rating_avg = excluded.rating_avg,
  total_reviews = excluded.total_reviews;

commit;