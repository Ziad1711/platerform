begin;

create table if not exists public.facebook_ad_account_store_configs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  ad_account_id uuid not null references public.facebook_ad_accounts(id) on delete cascade,
  sync_mode text not null default 'product' check (sync_mode in ('simple', 'product')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, ad_account_id)
);

create index if not exists idx_facebook_account_store_configs_integration_store
  on public.facebook_ad_account_store_configs (integration_id, store_id, is_active);
create index if not exists idx_facebook_account_store_configs_account
  on public.facebook_ad_account_store_configs (ad_account_id);
create index if not exists idx_facebook_account_store_configs_user
  on public.facebook_ad_account_store_configs (user_id);

alter table public.facebook_ad_account_store_configs enable row level security;

drop policy if exists facebook_account_store_configs_all on public.facebook_ad_account_store_configs;
create policy facebook_account_store_configs_all
on public.facebook_ad_account_store_configs for all
using (
  facebook_ad_account_store_configs.user_id = auth.uid()
  and facebook_ad_account_store_configs.store_id in (
    select sm.store_id from public.store_members sm where sm.user_id = auth.uid()
  )
  and exists (
    select 1 from public.integrations i
    where i.id = facebook_ad_account_store_configs.integration_id
      and i.user_id = auth.uid()
      and i.provider = 'facebook-ads'
  )
  and exists (
    select 1 from public.facebook_ad_accounts a
    where a.id = facebook_ad_account_store_configs.ad_account_id
      and a.integration_id = facebook_ad_account_store_configs.integration_id
      and a.user_id = auth.uid()
  )
)
with check (
  facebook_ad_account_store_configs.user_id = auth.uid()
  and facebook_ad_account_store_configs.store_id in (
    select sm.store_id from public.store_members sm where sm.user_id = auth.uid()
  )
  and exists (
    select 1 from public.integrations i
    where i.id = facebook_ad_account_store_configs.integration_id
      and i.user_id = auth.uid()
      and i.provider = 'facebook-ads'
  )
  and exists (
    select 1 from public.facebook_ad_accounts a
    where a.id = facebook_ad_account_store_configs.ad_account_id
      and a.integration_id = facebook_ad_account_store_configs.integration_id
      and a.user_id = auth.uid()
  )
);

drop trigger if exists set_facebook_account_store_configs_updated_at on public.facebook_ad_account_store_configs;
create trigger set_facebook_account_store_configs_updated_at
before update on public.facebook_ad_account_store_configs
for each row execute function public.handle_updated_at();

insert into public.facebook_ad_account_store_configs (
  integration_id, user_id, store_id, ad_account_id, sync_mode, is_active, updated_at
)
select integration_id, user_id, store_id, id, sync_mode, is_active, now()
from public.facebook_ad_accounts
where store_id is not null
on conflict (store_id, ad_account_id) do update
set sync_mode = excluded.sync_mode,
    is_active = excluded.is_active,
    updated_at = excluded.updated_at;

commit;
