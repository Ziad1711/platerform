begin;
set local lock_timeout = '5s';

insert into saas_admin.role_permissions values ('platform_owner','acquisition.manage') on conflict do nothing;

create table saas_admin.acquisition_visits (
  consent_id uuid primary key references saas_admin.meta_consents(id) on delete cascade,
  first_touch jsonb not null,
  last_touch jsonb not null
);
create table saas_admin.acquisition_signups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_touch jsonb not null,
  last_touch jsonb not null
);

create function public.rpc_acquisition_touch(p_consent uuid, p_touch jsonb) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare touch jsonb;
begin
  if jsonb_typeof(p_touch) <> 'object' or length(p_touch::text) > 2000 then return; end if;
  -- Do not persist browser/click identifiers in internal reporting.
  select jsonb_object_agg(key,value) into touch from jsonb_each_text(p_touch)
  where key in ('utm_source','utm_medium','utm_campaign','utm_id','utm_content','campaign_id','adset_id','ad_id')
    and length(value) between 1 and 120;
  if touch is null then return; end if;
  perform 1 from saas_admin.meta_consents where id=p_consent and expires_at>now() and user_id is null for update;
  if not found then return; end if;
  touch := touch || jsonb_build_object('recorded_at',clock_timestamp());
  insert into saas_admin.acquisition_visits values(p_consent,touch,touch)
  on conflict(consent_id) do update set last_touch=excluded.last_touch;
end $$;

-- Runs before the existing CAPI signup trigger. No changes to its outbox.
create function saas_admin.acquisition_on_signup() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare token text := new.raw_user_meta_data->>'_jisra_acquisition_consent';
begin
  new.raw_user_meta_data := new.raw_user_meta_data - '_jisra_acquisition_consent';
  if token is null or token !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then return new; end if;
  begin
    perform 1 from saas_admin.meta_consents where id=token::uuid and expires_at>now() and user_id is null for update;
    if found then
      -- auth.users is not inserted yet; defer just this FK until commit.
      insert into saas_admin.acquisition_signups
      select new.id,first_touch,last_touch from saas_admin.acquisition_visits where consent_id=token::uuid;
      if found then delete from saas_admin.acquisition_visits where consent_id=token::uuid; end if;
    end if;
  exception when others then
    raise warning 'acquisition signup snapshot failed (%).', sqlstate;
  end;
  return new;
end $$;
alter table saas_admin.acquisition_signups alter constraint acquisition_signups_user_id_fkey deferrable initially deferred;
create trigger jisra_acquisition_on_signup before insert on auth.users
for each row execute function saas_admin.acquisition_on_signup();

-- Preserve the existing consent API; withdrawal and all purges are atomic.
create or replace function public.rpc_meta_consent(p_old uuid, p_new uuid, p_user uuid, p_matching jsonb) returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare previous_user uuid;
begin
  if p_old is not null then delete from saas_admin.meta_consents where id=p_old returning user_id into previous_user; end if;
  if p_new is null then
    if p_user is not null then delete from saas_admin.meta_consents where user_id=p_user; end if;
    delete from saas_admin.acquisition_signups where user_id in (p_user,previous_user);
  else
    insert into saas_admin.meta_consents(id,user_id,matching) values(p_new,p_user,p_matching);
  end if;
end;
$$;

create table saas_admin.acquisition_connection (
  singleton boolean primary key default true check(singleton),
  account_id text not null check(account_id ~ '^[0-9]{5,25}$'),
  account_name text not null,
  meta_user_id text not null,
  tasks text[] not null,
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  tz text not null,
  token_encrypted text not null check(token_encrypted like 'v1:%'),
  expires_at timestamptz not null,
  status text not null default 'pending' check(status in ('pending','running','ok','retry','reconnect')),
  error_code text,
  failures integer not null default 0,
  next_run timestamptz not null default now(),
  lease uuid,
  last_ok timestamptz,
  start_day date not null,
  unique(account_id)
);
create table saas_admin.acquisition_days (
  account_id text not null references saas_admin.acquisition_connection(account_id),
  day date not null,
  synced_at timestamptz not null default now(),
  primary key(account_id,day)
);
create table saas_admin.acquisition_objects (
  account_id text not null references saas_admin.acquisition_connection(account_id),
  level text not null check(level in ('campaign','adset','ad')),
  object_id text not null,
  name text not null,
  campaign_id text,
  adset_id text,
  primary key(account_id,level,object_id)
);
create table saas_admin.acquisition_insights (
  account_id text not null,
  day date not null,
  level text not null,
  object_id text not null,
  spend numeric not null check(spend>=0),
  impressions bigint not null check(impressions>=0),
  clicks bigint not null check(clicks>=0),
  primary key(account_id,day,level,object_id),
  foreign key(account_id,level,object_id) references saas_admin.acquisition_objects(account_id,level,object_id)
);

create function public.rpc_acquisition_connect(p_account text,p_name text,p_meta_user text,p_tasks text[],p_currency text,p_tz text,p_token text,p_expires timestamptz) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if not exists (select 1 from pg_timezone_names where name=p_tz) or not (p_expires>now()) then return false; end if;
  insert into saas_admin.acquisition_connection(account_id,account_name,meta_user_id,tasks,currency,tz,token_encrypted,expires_at,start_day)
  values(p_account,p_name,p_meta_user,p_tasks,p_currency,p_tz,p_token,p_expires,(now() at time zone p_tz)::date-90)
  on conflict(singleton) do update set account_name=excluded.account_name,meta_user_id=excluded.meta_user_id,tasks=excluded.tasks,
    token_encrypted=excluded.token_encrypted,expires_at=excluded.expires_at,
    status='pending',error_code=null,failures=0,next_run=now(),lease=null
  where acquisition_connection.account_id=excluded.account_id and acquisition_connection.currency=excluded.currency
    and acquisition_connection.tz=excluded.tz;
  return found;
end $$;

create function public.rpc_acquisition_claim(p_account text) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare c saas_admin.acquisition_connection; today date; first_day date; last_day date;
begin
  select * into c from saas_admin.acquisition_connection where account_id=p_account and next_run<=now() and status<>'reconnect' for update skip locked;
  if not found then return null; end if;
  if c.expires_at<=now() then
    update saas_admin.acquisition_connection set status='reconnect',error_code='TOKEN_EXPIRED',lease=null where singleton;
    return null;
  end if;
  delete from saas_admin.meta_consents where expires_at<=now();
  today := (now() at time zone c.tz)::date;
  -- A rolling refresh takes priority once a new day is available; recover all other gaps oldest first.
  if not exists(select 1 from saas_admin.acquisition_days d where d.account_id=c.account_id and d.day=today-1) then
    first_day := case when c.failures>0 then today-1 else greatest(c.start_day,today-3) end; last_day := today-1;
  else
    select g.day::date into first_day from generate_series(c.start_day::timestamp,(today-1)::timestamp,'1 day') g(day)
    where not exists(select 1 from saas_admin.acquisition_days d where d.account_id=c.account_id and d.day=g.day::date) order by g.day limit 1;
    last_day := least(first_day+6,today-1);
    if first_day is null then first_day := greatest(c.start_day,today-3); last_day := today-1; end if;
  end if;
  if c.failures>0 then last_day:=first_day; end if;
  update saas_admin.acquisition_connection set status='running',lease=gen_random_uuid(),next_run=now()+interval '10 minutes'
  where singleton returning * into c;
  return jsonb_build_object('account',c.account_id,'currency',c.currency,'token',c.token_encrypted,'lease',c.lease,'from',first_day,'to',last_day,
    'inventory',c.last_ok is null or (c.last_ok at time zone c.tz)::date<today);
end $$;

create function public.rpc_acquisition_finish(p_lease uuid,p_from date,p_to date,p_rows jsonb,p_error text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare c saas_admin.acquisition_connection; today date;
begin
  select * into c from saas_admin.acquisition_connection where lease=p_lease and next_run>now() for update;
  if not found then return false; end if;
  if p_error is not null then
    if p_error not in ('TOKEN_EXPIRED','ACCESS_DENIED','RATE_LIMIT','GRAPH_FAILED','GRAPH_DATA','SYNC_FAILED') then raise exception 'invalid_sync_error'; end if;
    update saas_admin.acquisition_connection set status=case when p_error in ('TOKEN_EXPIRED','ACCESS_DENIED') then 'reconnect' else 'retry' end,
      error_code=p_error, failures=least(c.failures+1,12),lease=null,
      next_run=now()+make_interval(mins=>case when p_error='RATE_LIMIT' then 30 else 5 end * (1 << least(c.failures,4))) where singleton;
    return true;
  end if;
  today := (now() at time zone c.tz)::date;
  if p_from is null or p_to is null or p_to<p_from or p_from<c.start_day or p_to>=today or p_to>p_from+6 or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'invalid_sync_window';
  end if;
  insert into saas_admin.acquisition_objects as o(account_id,level,object_id,name,campaign_id,adset_id)
  select distinct on (level,object_id) c.account_id,level,object_id,name,campaign_id,adset_id
  from jsonb_to_recordset(p_rows) as r(level text,object_id text,name text,campaign_id text,adset_id text,day date)
  order by level,object_id,day desc nulls first
  on conflict(account_id,level,object_id) do update set name=excluded.name,campaign_id=excluded.campaign_id,adset_id=excluded.adset_id;
  delete from saas_admin.acquisition_insights where account_id=c.account_id and day between p_from and p_to;
  insert into saas_admin.acquisition_insights
  select c.account_id,day,level,object_id,spend,impressions,clicks
  from jsonb_to_recordset(p_rows) as r(day date,level text,object_id text,spend numeric,impressions bigint,clicks bigint)
  where day between p_from and p_to;
  insert into saas_admin.acquisition_days(account_id,day) select c.account_id,g::date from generate_series(p_from::timestamp,p_to::timestamp,'1 day') g
  on conflict(account_id,day) do update set synced_at=now();
  update saas_admin.acquisition_connection set status='ok',lease=null,error_code=null,failures=0,last_ok=now(),
    next_run=case when exists(select 1 from generate_series(c.start_day::timestamp,(today-1)::timestamp,'1 day') g
      where not exists(select 1 from saas_admin.acquisition_days d where d.account_id=c.account_id and d.day=g::date))
      then now() else ((today+1)::timestamp at time zone c.tz)+interval '2 hours' end where singleton;
  return true;
end $$;

-- Historical and future metrics are derived from committed business events and
-- matched receipts/allocations, not from mutable UI state or the CAPI outbox.
create function public.rpc_admin_acquisition_report(p_days integer,p_level text,p_touch text,p_offset integer default 0,p_end date default null) returns jsonb
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
    where u.created_at>=from_day::timestamp at time zone tz_name and u.created_at<until_day::timestamp at time zone tz_name
      and not exists(select 1 from saas_admin.account_classification x where x.user_id=u.id and x.classification<>'customer')
  ), cohort as (
    select u.id,u.created_at,paid.paid_at, campaign.object_id as campaign_id, chosen.object_id as object_id
    from users_in_cohort u
    left join saas_admin.acquisition_objects campaign on campaign.account_id=c.account_id and campaign.level='campaign'
      and campaign.object_id=u.touch->>'campaign_id'
    left join saas_admin.acquisition_objects chosen on chosen.account_id=c.account_id and chosen.level=p_level
      and chosen.object_id=u.touch->>(p_level || '_id') and campaign.object_id is not null
      and (p_level='campaign' or chosen.campaign_id=campaign.object_id)
      and (p_level<>'ad' or u.touch->>'adset_id' is null or chosen.adset_id=u.touch->>'adset_id')
    left join lateral (
      select e.created_at as paid_at from public.payment_request_events e
      join public.payment_requests r on r.id=e.request_id and r.user_id=u.id and r.status='validated'
      join saas_admin.payments p on p.request_id=r.id and p.amount_minor>0
      join saas_admin.payment_allocations a on a.request_id=r.id and a.payment_id=p.id and a.amount_minor=p.amount_minor
      join public.subscriptions s on s.id=a.subscription_id and s.user_id=u.id and s.payment_request_id=r.id and s.amount_paid>0
      join public.plans plan on plan.id=s.plan_id and plan.code<>'free'
      where e.user_id=u.id and e.event_type='validated' and e.created_at>=u.created_at and s.started_at<=e.created_at
        and not exists(select 1 from public.subscriptions prior join public.plans pp on pp.id=prior.plan_id and pp.code<>'free'
          where prior.user_id=u.id and prior.id<>s.id and prior.amount_paid>0 and coalesce(prior.started_at,'-infinity')<=e.created_at)
      order by e.created_at,e.id limit 1
    ) paid on true
  ), summary as (
    select count(*) as signups,count(campaign_id) as attributed,count(paid_at) as paid,
      count(paid_at) filter(where campaign_id is not null) as attributed_paid,
      avg(extract(epoch from paid_at-created_at)/86400) as delay_days from cohort
  ), media as (
    select level,object_id,sum(spend) spend,sum(impressions) impressions,sum(clicks) clicks
    from saas_admin.acquisition_insights where account_id=c.account_id and day>=from_day and day<until_day group by level,object_id
  ), grouped as (
    select object_id,count(*) signups,count(paid_at) paid,avg(extract(epoch from paid_at-created_at)/86400) delay_days from cohort group by object_id
  ), breakdown as (
    select o.object_id id,o.name,o.campaign_id,o.adset_id,coalesce(m.spend,0) spend,coalesce(m.impressions,0) impressions,coalesce(m.clicks,0) clicks,
      coalesce(g.signups,0) signups,coalesce(g.paid,0) paid,g.delay_days
    from saas_admin.acquisition_objects o left join media m on m.level=o.level and m.object_id=o.object_id
    left join grouped g on g.object_id=o.object_id where o.account_id=c.account_id and o.level=p_level
    union all select null,null,null,null,null,null,null,g.signups,g.paid,g.delay_days from grouped g where g.object_id is null
  ), totals as (
    select coalesce(sum(spend),0) spend,coalesce(sum(impressions),0) impressions,coalesce(sum(clicks),0) clicks from media where level='campaign'
  )
  select jsonb_build_object('account',case when c.account_id is not null then jsonb_build_object('id',c.account_id,'name',c.account_name,
      'currency',c.currency,'tz',c.tz,'expires_at',c.expires_at,'status',c.status,'error',c.error_code,'last_ok',c.last_ok,'tasks',c.tasks) end,
    'from',from_day,'until',until_day-1,'days',p_days,
    'coverage',(select count(*) from saas_admin.acquisition_days where account_id=c.account_id and day>=from_day and day<until_day),
    'summary',to_jsonb(summary)||to_jsonb(totals),'row_count',(select count(*) from breakdown),
    'rows',(select coalesce(jsonb_agg(to_jsonb(b) order by (b.id is null) desc,b.spend desc nulls last,b.signups desc,b.id),'[]') from
      (select * from breakdown order by (id is null) desc,spend desc nulls last,signups desc,id limit 50 offset p_offset) b))
  into result from summary cross join totals;
  return result;
end $$;

alter table saas_admin.acquisition_visits enable row level security;
alter table saas_admin.acquisition_signups enable row level security;
alter table saas_admin.acquisition_connection enable row level security;
alter table saas_admin.acquisition_days enable row level security;
alter table saas_admin.acquisition_objects enable row level security;
alter table saas_admin.acquisition_insights enable row level security;
revoke all on saas_admin.acquisition_visits,saas_admin.acquisition_signups,saas_admin.acquisition_connection,
  saas_admin.acquisition_days,saas_admin.acquisition_objects,saas_admin.acquisition_insights from public,anon,authenticated,service_role;
revoke all on function saas_admin.acquisition_on_signup() from public,anon,authenticated,service_role;
revoke all on function public.rpc_acquisition_touch(uuid,jsonb),
  public.rpc_acquisition_connect(text,text,text,text[],text,text,text,timestamptz),public.rpc_acquisition_claim(text),
  public.rpc_acquisition_finish(uuid,date,date,jsonb,text),public.rpc_admin_acquisition_report(integer,text,text,integer,date) from public,anon,authenticated,service_role;
grant execute on function public.rpc_acquisition_touch(uuid,jsonb),
  public.rpc_acquisition_connect(text,text,text,text[],text,text,text,timestamptz),public.rpc_acquisition_claim(text),
  public.rpc_acquisition_finish(uuid,date,date,jsonb,text) to service_role;
grant execute on function public.rpc_admin_acquisition_report(integer,text,text,integer,date) to authenticated;
commit;