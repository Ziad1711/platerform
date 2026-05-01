-- Ajout des colonnes de métriques Facebook Ads à ad_spend_daily
begin;

-- Métriques de performance
alter table public.ad_spend_daily
  add column if not exists impressions bigint not null default 0,
  add column if not exists clicks bigint not null default 0,
  add column if not exists reach bigint not null default 0,
  add column if not exists frequency numeric(12,4) not null default 0;

-- Métriques de coût
alter table public.ad_spend_daily
  add column if not exists cpc numeric(12,4) not null default 0,
  add column if not exists cpm numeric(12,4) not null default 0,
  add column if not exists cpp numeric(12,4) not null default 0,
  add column if not exists ctr numeric(12,4) not null default 0;

-- Conversions
alter table public.ad_spend_daily
  add column if not exists actions_total integer not null default 0,
  add column if not exists purchases integer not null default 0,
  add column if not exists add_to_cart integer not null default 0,
  add column if not exists initiate_checkout integer not null default 0,
  add column if not exists view_content integer not null default 0;

-- Valeur des conversions
alter table public.ad_spend_daily
  add column if not exists conversion_value numeric(12,2) not null default 0,
  add column if not exists conversion_value_currency text null;

-- Engagement
alter table public.ad_spend_daily
  add column if not exists post_engagement integer not null default 0,
  add column if not exists page_engagement integer not null default 0,
  add column if not exists link_clicks integer not null default 0,
  add column if not exists outbound_clicks integer not null default 0;

-- Vidéo
alter table public.ad_spend_daily
  add column if not exists video_views integer not null default 0,
  add column if not exists video_avg_time_watched numeric(12,2) not null default 0;

-- Métadonnées brutes
alter table public.ad_spend_daily
  add column if not exists raw_metrics jsonb null;

-- Contraintes de validation
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_impressions_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_impressions_check check (impressions >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_clicks_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_clicks_check check (clicks >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_reach_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_reach_check check (reach >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ad_spend_daily_conversion_value_currency_check'
  ) then
    alter table public.ad_spend_daily
      add constraint ad_spend_daily_conversion_value_currency_check
        check (conversion_value_currency is null or char_length(conversion_value_currency) = 3);
  end if;
end
$$;

-- Index pour performance des requêtes analytiques
create index if not exists idx_ad_spend_daily_impressions
  on public.ad_spend_daily (impressions) where impressions > 0;
create index if not exists idx_ad_spend_daily_clicks
  on public.ad_spend_daily (clicks) where clicks > 0;
create index if not exists idx_ad_spend_daily_purchases
  on public.ad_spend_daily (purchases) where purchases > 0;
create index if not exists idx_ad_spend_daily_metrics_date
  on public.ad_spend_daily (store_id, spend_date, platform);

commit;
