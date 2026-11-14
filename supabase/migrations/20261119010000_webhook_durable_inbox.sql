begin;
set local lock_timeout = '5s';
create table public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('youcan','lightfunnels','ameex','digylog')),
  integration_id uuid not null references public.integrations(id),
  event_key text not null check (length(event_key) between 1 and 256),
  request_path text not null,
  raw_body text not null check (octet_length(raw_body) <= 1048576),
  signature text,
  content_type text not null,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  unique(provider,integration_id,event_key)
);
alter table public.webhook_inbox owner to supabase_admin;
alter table public.webhook_inbox enable row level security;
revoke all on public.webhook_inbox from public,anon,authenticated;
grant select,insert on public.webhook_inbox to service_role;
create index webhook_inbox_pending on public.webhook_inbox(received_at,id) where processed_at is null;

create function public.rpc_webhook_inbox_claim()
returns setof public.webhook_inbox language plpgsql security definer
set search_path = pg_catalog,public as $$
declare selected uuid;
begin
  -- One head-of-line event per integration, including retry delays and leases.
  select q.id into selected from public.webhook_inbox q
  where q.processed_at is null and q.available_at <= now()
    and (q.lease_until is null or q.lease_until < now())
    and not exists(select 1 from public.webhook_inbox earlier
      where earlier.integration_id=q.integration_id and earlier.processed_at is null
        and (earlier.received_at,earlier.id)<(q.received_at,q.id))
  order by q.received_at,q.id for update of q skip locked limit 1;
  if selected is null then return; end if;
  return query update public.webhook_inbox set lease_token=gen_random_uuid(),
    lease_until=now()+interval '5 minutes',attempts=attempts+1
    where id=selected returning *;
end $$;
create function public.rpc_webhook_inbox_finish(p_id uuid,p_token uuid,p_error text default null)
returns boolean language plpgsql security definer
set search_path = pg_catalog,public as $$
begin
  update public.webhook_inbox set
    processed_at=case when p_error is null then now() else null end,
    last_error=left(p_error,500),
    available_at=now()+make_interval(secs=>least(300,5*greatest(attempts,1))),
    lease_token=null,lease_until=null
  where id=p_id and lease_token=p_token and processed_at is null;
  return found;
end $$;
alter function public.rpc_webhook_inbox_claim() owner to supabase_admin;
alter function public.rpc_webhook_inbox_finish(uuid,uuid,text) owner to supabase_admin;
revoke all on function public.rpc_webhook_inbox_claim() from public,anon,authenticated;
revoke all on function public.rpc_webhook_inbox_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rpc_webhook_inbox_claim() to service_role;
grant execute on function public.rpc_webhook_inbox_finish(uuid,uuid,text) to service_role;
commit;