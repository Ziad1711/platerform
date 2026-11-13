begin;
-- Réservation budgétaire du chat public : le coût maximal d'un appel est
-- immobilisé avant l'appel fournisseur, puis rapproché du coût réel.
--
-- Sans réservation, plusieurs requêtes simultanées lisent le même budget
-- restant et peuvent le dépasser. Ici :
--   - rpc_public_chat_reserve  : vérifie et immobilise sous verrou advisory ;
--   - rpc_public_chat_settle   : libère la réservation et enregistre le coût ;
--   - une réservation non réglée expire (TTL) et ne bloque pas la journée.
-- Aucune fonction existante n'est remplacée.
create table saas_admin.public_chat_reservations (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null check(key_hash ~ '^[a-f0-9]{64}$'),
  amount_micro bigint not null check(amount_micro>=0),
  created_at timestamptz not null default now()
);
create index public_chat_reservations_expiry
  on saas_admin.public_chat_reservations(created_at);

alter table saas_admin.public_chat_reservations enable row level security;
revoke all on saas_admin.public_chat_reservations from public,anon,authenticated,service_role;
grant select,insert,delete on saas_admin.public_chat_reservations to service_role;

create function public.rpc_public_chat_reserve(
  p_key_hash text,
  p_amount_micro bigint,
  p_daily_budget_micro bigint,
  p_ttl_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  today date:=current_date;
  spent bigint;
  held bigint;
  reservation uuid;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_amount_micro is null or p_amount_micro<0
    or p_daily_budget_micro is null or p_daily_budget_micro<0 then
    return jsonb_build_object('reserved',false,'code','invalid'); end if;

  perform pg_advisory_xact_lock(hashtext('public_chat_budget'));

  -- Réservations orphelines (processus interrompu) : jamais bloquantes.
  delete from saas_admin.public_chat_reservations
  where created_at<clock_timestamp()-make_interval(secs=>greatest(p_ttl_seconds,30));

  insert into saas_admin.public_chat_usage(day) values(today)
  on conflict(day) do nothing;
  select cost_micro_usd into spent
  from saas_admin.public_chat_usage where day=today for update;
  select coalesce(sum(amount_micro),0) into held
  from saas_admin.public_chat_reservations;

  if coalesce(spent,0)+held+p_amount_micro>p_daily_budget_micro then
    insert into saas_admin.public_chat_events(outcome,reason) values('budget','reservation_refused');
    return jsonb_build_object('reserved',false,'code','budget',
      'remaining_micro',greatest(0,p_daily_budget_micro-coalesce(spent,0)-held));
  end if;

  insert into saas_admin.public_chat_reservations(key_hash,amount_micro)
  values(p_key_hash,p_amount_micro) returning id into reservation;

  return jsonb_build_object('reserved',true,'reservation_id',reservation,
    'remaining_micro',
    greatest(0,p_daily_budget_micro-coalesce(spent,0)-held-p_amount_micro));
end $$;

-- Rapprochement : la réservation est supprimée une seule fois (idempotent),
-- puis le coût réel et les tokens sont comptabilisés. Un usage illisible est
-- transmis avec le coût estimé : jamais zéro par défaut.
create function public.rpc_public_chat_settle(
  p_reservation uuid,
  p_cost_micro bigint,
  p_input bigint,
  p_output bigint,
  p_outcome text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  released bigint;
  cost bigint:=greatest(coalesce(p_cost_micro,0),0);
  tokens_in bigint:=greatest(coalesce(p_input,0),0);
  tokens_out bigint:=greatest(coalesce(p_output,0),0);
begin
  if p_reservation is null then
    return jsonb_build_object('settled',false,'code','invalid'); end if;

  perform pg_advisory_xact_lock(hashtext('public_chat_budget'));

  delete from saas_admin.public_chat_reservations
  where id=p_reservation returning amount_micro into released;
  if released is null then
    return jsonb_build_object('settled',false,'code','already_settled'); end if;

  insert into saas_admin.public_chat_usage(day,requests,input_tokens,output_tokens,cost_micro_usd,updated_at)
  values(current_date,1,tokens_in,tokens_out,cost,now())
  on conflict(day) do update set requests=saas_admin.public_chat_usage.requests+1,
    input_tokens=saas_admin.public_chat_usage.input_tokens+tokens_in,
    output_tokens=saas_admin.public_chat_usage.output_tokens+tokens_out,
    cost_micro_usd=saas_admin.public_chat_usage.cost_micro_usd+cost,
    updated_at=now();

  if p_outcome in ('reply','provider_error') then
    insert into saas_admin.public_chat_events(outcome,reason) values(p_outcome,null); end if;

  return jsonb_build_object('settled',true,'cost_micro',cost,'reserved_micro',released);
end $$;

revoke all on function public.rpc_public_chat_reserve(text,bigint,bigint,integer)
  from public,anon,authenticated;
revoke all on function public.rpc_public_chat_settle(uuid,bigint,bigint,bigint,text)
  from public,anon,authenticated;
grant execute on function public.rpc_public_chat_reserve(text,bigint,bigint,integer)
  to service_role;
grant execute on function public.rpc_public_chat_settle(uuid,bigint,bigint,bigint,text)
  to service_role;
commit;
