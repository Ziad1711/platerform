begin;

-- Mode de synchronisation par ad account: simple (sans produit) ou product (mapping campagne -> produit)
alter table public.facebook_ad_accounts
  add column if not exists sync_mode text not null default 'product';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'facebook_ad_accounts_sync_mode_check'
  ) then
    alter table public.facebook_ad_accounts
      add constraint facebook_ad_accounts_sync_mode_check
      check (sync_mode in ('simple', 'product'));
  end if;
end
$$;

-- Le produit devient optionnel: en mode simple les campagnes sont synchronisées sans produit
alter table public.facebook_campaign_mappings
  alter column product_id drop not null;

create index if not exists idx_facebook_ad_accounts_store_active
  on public.facebook_ad_accounts (integration_id, store_id, is_active);

commit;
