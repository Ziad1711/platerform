begin;
set local lock_timeout = '5s';

-- Platform rates must never become the fallback for client stores.
create table saas_admin.acquisition_fx_rates (
  effective_on date primary key check (effective_on between date '2000-01-01' and date '2099-12-31'),
  rate numeric not null check (rate > 0 and rate < 1000 and scale(rate) <= 8),
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);
alter table saas_admin.acquisition_fx_rates enable row level security;
revoke all on saas_admin.acquisition_fx_rates from public,anon,authenticated,service_role;

create function public.rpc_admin_acquisition_fx_save(p_day date,p_rate numeric) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare old_rate numeric;
begin
  if not saas_admin.has_permission('acquisition.manage',true) then raise exception 'ADMIN_FORBIDDEN' using errcode='42501'; end if;
  if p_day is null or p_day not between date '2000-01-01' and date '2099-12-31' or
     p_rate is null or not (p_rate > 0 and p_rate < 1000 and scale(p_rate) <= 8) then
    raise exception 'ADMIN_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(611222, p_day-date '2000-01-01');
  select rate into old_rate from saas_admin.acquisition_fx_rates where effective_on=p_day;
  if old_rate=p_rate then return; end if;
  insert into saas_admin.acquisition_fx_rates(effective_on,rate,updated_by) values(p_day,p_rate,auth.uid())
  on conflict(effective_on) do update set rate=excluded.rate,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  insert into saas_admin.audit_events(actor_id,action,outcome,reason)
    values(auth.uid(),'acquisition.fx.save','changed',jsonb_build_object('day',p_day,'before',old_rate,'after',p_rate)::text);
end $$;
revoke all on function public.rpc_admin_acquisition_fx_save(date,numeric) from public,anon,authenticated,service_role;
grant execute on function public.rpc_admin_acquisition_fx_save(date,numeric) to authenticated;

create function public.rpc_admin_acquisition_fx(p_before date default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare today date;
begin
  if not saas_admin.has_permission('acquisition.manage',true) then raise exception 'ADMIN_FORBIDDEN' using errcode='42501'; end if;
  select (now() at time zone coalesce((select tz from saas_admin.acquisition_connection where singleton),'Africa/Casablanca'))::date into today;
  return jsonb_build_object(
    'current',(select jsonb_build_object('day',effective_on,'rate',rate::text,'updated_at',updated_at) from saas_admin.acquisition_fx_rates where effective_on<=today order by effective_on desc limit 1),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('day',effective_on,'rate',rate::text,'updated_at',updated_at) order by effective_on desc),'[]')
      from (select effective_on,rate,updated_at from saas_admin.acquisition_fx_rates where p_before is null or effective_on<p_before order by effective_on desc limit 31) r));
end $$;
revoke all on function public.rpc_admin_acquisition_fx(date) from public,anon,authenticated,service_role;
grant execute on function public.rpc_admin_acquisition_fx(date) to authenticated;
create or replace function public.rpc_admin_acquisition_report(p_days integer,p_level text,p_touch text,p_offset integer default 0,p_end date default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare c saas_admin.acquisition_connection; until_day date; from_day date; tz_name text; result jsonb;
begin
  if not saas_admin.has_permission('acquisition.manage',true) then raise exception 'ADMIN_FORBIDDEN' using errcode='42501'; end if;
  if p_days is null or p_days not in (7,30,90) or p_level is null or p_level not in ('campaign','adset','ad') or
      p_touch is null or p_touch not in ('first','last') or p_offset is null or p_offset not between 0 and 100000 then raise exception 'ADMIN_INVALID'; end if;
  select * into c from saas_admin.acquisition_connection where singleton;
  tz_name := coalesce(c.tz,'UTC'); until_day := (now() at time zone tz_name)::date;
  if p_end is not null then
    if p_end>=until_day or p_end<date '2000-01-01' then raise exception 'ADMIN_INVALID'; end if;
    until_day := p_end+1;
  end if;
  from_day := until_day-p_days;
  with users_in_cohort as (
    select u.id,u.created_at,case when p_touch='first' then s.first_touch else s.last_touch end as touch
    from auth.users u left join saas_admin.acquisition_signups s on s.user_id=u.id
    where u.created_at<until_day::timestamp at time zone tz_name and (
      u.created_at>=from_day::timestamp at time zone tz_name or u.id in (
        select e.user_id from public.payment_request_events e where e.event_type='validated'
        and e.created_at>=from_day::timestamp at time zone tz_name and e.created_at<until_day::timestamp at time zone tz_name
      ))
      and not exists(select 1 from saas_admin.account_classification x where x.user_id=u.id and x.classification<>'customer')
  ), cohort as (
    select u.id,u.created_at,paid.paid_at, paid.amount_minor, paid.currency, campaign.object_id as campaign_id, chosen.object_id as object_id
    from users_in_cohort u
    left join saas_admin.acquisition_objects campaign on campaign.account_id=c.account_id and campaign.level='campaign'
      and campaign.object_id=u.touch->>'campaign_id'
    left join saas_admin.acquisition_objects chosen on chosen.account_id=c.account_id and chosen.level=p_level
      and chosen.object_id=u.touch->>(p_level || '_id') and campaign.object_id is not null
      and (p_level='campaign' or chosen.campaign_id=campaign.object_id)
      and (p_level<>'ad' or u.touch->>'adset_id' is null or chosen.adset_id=u.touch->>'adset_id')
    left join lateral (
      select e.created_at as paid_at,p.amount_minor,p.currency from public.payment_request_events e
      join public.payment_requests r on r.id=e.request_id and r.user_id=u.id and r.status='validated'
      join saas_admin.payments p on p.request_id=r.id and p.amount_minor>0
      join saas_admin.payment_allocations a on a.request_id=r.id and a.payment_id=p.id and a.amount_minor=p.amount_minor
      join public.subscriptions s on s.id=a.subscription_id and s.user_id=u.id and s.payment_request_id=r.id and s.amount_paid>0
      join public.plans plan on plan.id=s.plan_id and plan.code<>'free'
      where e.user_id=u.id and e.event_type='validated' and e.created_at>=u.created_at and s.started_at<=e.created_at
        and not exists(select 1 from public.subscriptions prior join public.plans pp on pp.id=prior.plan_id and pp.code<>'free'
          where prior.user_id=u.id and prior.id<>s.id and prior.amount_paid>0 and coalesce(prior.started_at,'-infinity')<=e.created_at)
      order by e.created_at,e.id,p.id limit 1
    ) paid on true
  ), summary as (
    select count(*) as signups,count(campaign_id) as attributed,count(paid_at) as paid,
      count(paid_at) filter(where campaign_id is not null) as attributed_paid,
      avg(extract(epoch from paid_at-created_at)/86400) as delay_days from cohort
      where created_at>=from_day::timestamp at time zone tz_name
  ), conversions as (
    select count(*) filter(where campaign_id is not null) paid_in_period,
      coalesce(sum(amount_minor) filter(where campaign_id is not null and currency='MAD'),0)::numeric/100 revenue_mad,
      count(*) filter(where campaign_id is not null and currency is distinct from 'MAD') non_mad_receipts
    from cohort where paid_at>=from_day::timestamp at time zone tz_name and paid_at<until_day::timestamp at time zone tz_name
  ), daily as (
    select g.day::date as day,r.effective_on,r.rate from generate_series(from_day::timestamp,(until_day-1)::timestamp,'1 day') g(day)
    left join lateral (select effective_on,rate from saas_admin.acquisition_fx_rates
      where effective_on<=g.day::date order by effective_on desc limit 1) r on c.currency='USD'
  ), daily_media as (
    select i.day,i.level,i.object_id,i.spend,i.impressions,i.clicks,d.rate
    from saas_admin.acquisition_insights i join daily d using(day)
    where i.account_id=c.account_id
  ), media as (
    select level,object_id,sum(spend) spend,sum(impressions) impressions,sum(clicks) clicks,
      sum(round(spend*rate,2)) spend_mad,bool_or(spend<>0 and rate is null) missing_fx
    from daily_media group by level,object_id
  ), campaign_days as (
    select day,rate,sum(spend) spend,sum(impressions) impressions,sum(clicks) clicks
    from daily_media where level='campaign' group by day,rate
  ), grouped as (
    select object_id,count(*) signups,count(paid_at) paid,avg(extract(epoch from paid_at-created_at)/86400) delay_days from cohort where created_at>=from_day::timestamp at time zone tz_name group by object_id
  ), breakdown as (
    select o.object_id id,o.name,o.campaign_id,o.adset_id,coalesce(m.spend,0) spend,coalesce(m.impressions,0) impressions,coalesce(m.clicks,0) clicks,
      case when c.currency='USD' and not coalesce(m.missing_fx,false) then coalesce(m.spend_mad,0) end spend_mad,
      coalesce(g.signups,0) signups,coalesce(g.paid,0) paid,g.delay_days
    from saas_admin.acquisition_objects o left join media m on m.level=o.level and m.object_id=o.object_id
    left join grouped g on g.object_id=o.object_id where o.account_id=c.account_id and o.level=p_level
    union all select null,null,null,null,null,null,null,null,g.signups,g.paid,g.delay_days from grouped g where g.object_id is null
  ), totals as (
    select coalesce(sum(spend),0) spend,coalesce(sum(impressions),0) impressions,coalesce(sum(clicks),0) clicks,
      case when c.currency='USD' and not coalesce(bool_or(spend<>0 and rate is null),false)
        then coalesce(sum(round(spend*rate,2)),0) end spend_mad from campaign_days
  )
  select jsonb_build_object('account',case when c.account_id is not null then jsonb_build_object('id',c.account_id,'name',c.account_name,
      'currency',c.currency,'tz',c.tz,'expires_at',c.expires_at,'status',c.status,'error',c.error_code,'last_ok',c.last_ok,'tasks',c.tasks,'next_run',case when c.status<>'reconnect' then c.next_run end) end,
    'from',from_day,'until',until_day-1,'days',p_days,
    'coverage',(select count(*) from saas_admin.acquisition_days where account_id=c.account_id and day>=from_day and day<until_day),
    'daily',(select jsonb_agg(jsonb_build_object('day',d.day,'rate_day',d.effective_on,'rate',d.rate::text,
      'usd',case when c.currency='USD' and s.day is not null then coalesce(m.spend,0) end,
      'mad',case when c.currency='USD' and s.day is not null then
        case when coalesce(m.spend,0)=0 then 0 else round(m.spend*d.rate,2) end end) order by d.day desc)
      from daily d left join saas_admin.acquisition_days s on s.account_id=c.account_id and s.day=d.day
      left join campaign_days m on m.day=d.day),
    'summary',to_jsonb(summary)||to_jsonb(totals)||to_jsonb(conversions),'row_count',(select count(*) from breakdown),
    'rows',(select coalesce(jsonb_agg(to_jsonb(b) order by (b.id is null) desc,b.spend desc nulls last,b.signups desc,b.id),'[]') from
      (select * from breakdown order by (id is null) desc,spend desc nulls last,signups desc,id limit 50 offset p_offset) b))
  into result from summary cross join totals cross join conversions;
  return result;
end $$;

commit;
