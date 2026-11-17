-- Lot 4 (correctif) : claim concurrent et idempotent des e-mails en file.
-- Évite le double envoi sous concurrence et récupère les envois restés « sending ».
begin;
set local lock_timeout='5s';

alter table public.email_outbox drop constraint email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check check(status in ('pending','sending','sent','failed'));

create or replace function public.rpc_email_outbox_claim(p_limit integer default 20)
returns setof public.email_outbox
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if coalesce(p_limit, 0) < 1 or p_limit > 100 then
    raise exception 'ADMIN_INVALID';
  end if;
  -- Reprise : un envoi resté « sending » après un crash redevient traitable.
  update public.email_outbox set status='pending'
  where status='sending' and created_at < now() - interval '10 minutes';
  return query
    update public.email_outbox set status='sending', attempts = attempts + 1
    where id in (
      select id from public.email_outbox
      where status='pending'
      order by id
      for update skip locked
      limit p_limit
    )
    returning *;
end $$;
revoke all on function public.rpc_email_outbox_claim(integer) from public,anon,authenticated;
grant execute on function public.rpc_email_outbox_claim(integer) to service_role;

commit;
