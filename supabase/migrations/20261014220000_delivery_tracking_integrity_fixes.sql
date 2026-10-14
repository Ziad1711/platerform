-- ============================================================
-- Suivi livraison : correctifs d'integrite (dates, couverture, cooldown).
--
-- 1. finish_delivery_tracking_claim : la date metier de niveau statut est
--    ecrite dans le MEME update que le statut. Le trigger BEFORE
--    `trg_set_order_status_timestamps` remplit une date vide avec now() des
--    qu'un statut change ; en ecrivant la date avec le statut, une date
--    transporteur fiable est conservee (sinon now()), sans modifier le trigger.
-- 2. delivery_tracking_coverage : la detection « colis remplace » (tracking_key
--    different) passe AVANT le motif manual/terminal, sinon un ancien claim
--    terminal masque un colis remplace et bloque sa resynchronisation.
-- 3. mark_delivery_tracking_cooldown : le cooldown n'est jamais raccourci
--    (greatest) : un Retry-After plus long reste respecte.
--
-- NON APPLIQUE en base : migration locale, a deployer apres reconstruction de
-- l'historique distant (LOT 5) et accord explicite.
-- ============================================================

-- 3. Cooldown : jamais raccourci (greatest).
create or replace function public.mark_delivery_tracking_cooldown(p_integration_id uuid, p_worker text, p_cooldown_seconds integer, p_configuration_error boolean default false)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_rows integer := 0;
  v_seconds integer := greatest(30, least(coalesce(p_cooldown_seconds, 300), 86400));
begin
  update public.delivery_tracking_locks
  set cooldown_until = greatest(coalesce(cooldown_until, now()), now() + make_interval(secs => v_seconds)),
      configuration_error = coalesce(p_configuration_error, false) or configuration_error,
      updated_at = now()
  where integration_id = p_integration_id
    and (locked_by = p_worker or p_worker is null);

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$function$;

revoke all on function public.mark_delivery_tracking_cooldown(uuid, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.mark_delivery_tracking_cooldown(uuid, text, integer, boolean) to service_role;

-- 2. Couverture : colis remplace detecte avant le motif manual/terminal.
create or replace function public.delivery_tracking_coverage(p_store_id uuid, p_provider text, p_tracking_column text, p_delivery_company_ids uuid[], p_excluded_statuses text[], p_exchange_active_statuses text[], p_fresh_seconds integer default 900, p_lease_seconds integer default 180)
 returns table(eligible integer, excluded integer, fresh integer, stale integer, untracked integer, active integer, unresolved integer, backoff integer, blocked integer, ready integer, remaining integer, never_synced integer, oldest_pending_synced_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_allowed_columns text[] := array[
    'tracking_number','rapid_delivery_parcel_key','maroc_go_delivery_parcel_key',
    'rushliv_parcel_key','ameex_parcel_code','sendit_parcel_code',
    'forcelog_parcel_key','digylog_tracking'
  ];
  v_fresh integer := greatest(60, coalesce(p_fresh_seconds, 900));
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 180), 1800));
begin
  if p_store_id is null then
    raise exception 'STORE_REQUIRED' using errcode = '22023';
  end if;
  if not (p_tracking_column = any(v_allowed_columns)) then
    raise exception 'INVALID_TRACKING_COLUMN' using errcode = '22023';
  end if;

  if p_delivery_company_ids is null or coalesce(array_length(p_delivery_company_ids, 1), 0) = 0 then
    return query select 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null::timestamptz;
    return;
  end if;

  return query
  with eligible as (
    select o.id as order_id,
           btrim(coalesce(to_jsonb(o) ->> p_tracking_column, '')) as tracking_key
    from public.orders o
    where o.store_id = p_store_id
      and o.delivery_company_id = any(p_delivery_company_ids)
      and o.delivery_status_source is distinct from 'manual'
      and (
        not (coalesce(o.status, '') = any(coalesce(p_excluded_statuses, '{}'::text[])))
        or coalesce(o.exchange_status, '') = any(coalesce(p_exchange_active_statuses, '{}'::text[]))
        or (o.exchange_original_order_id is not null and o.status = 'confirmed')
      )
  ),
  joined as (
    select e.order_id, e.tracking_key,
           c.order_id as claim_order_id,
           c.tracking_key as claim_tracking_key,
           coalesce(c.attempts, 0) as attempts,
           c.next_attempt_at, c.locked_at, c.last_synced_at, c.last_outcome, c.park_reason
    from eligible e
    left join public.delivery_tracking_claims c
      on c.order_id = e.order_id and c.provider = p_provider
    where e.tracking_key <> ''
  ),
  classified as (
    select j.*,
           case
             when j.claim_order_id is null
               or j.claim_tracking_key is distinct from j.tracking_key then 'untracked'
             when j.park_reason in ('manual', 'terminal') then 'excluded'
             when j.locked_at is not null and j.locked_at >= now() - make_interval(secs => v_lease) then 'active'
             when j.park_reason in ('unrecognized', 'stale', 'retry_requested')
               or j.last_outcome = 'failed'
               or coalesce(j.attempts, 0) > 0 then 'unresolved'
             when j.last_synced_at is not null and j.last_synced_at > now() - make_interval(secs => v_fresh) then 'fresh'
             when j.last_synced_at is not null then 'stale'
             else 'untracked'
           end as klass
    from joined j
  )
  select
    count(*)::integer,
    count(*) filter (where c.klass = 'excluded')::integer,
    count(*) filter (where c.klass = 'fresh')::integer,
    count(*) filter (where c.klass = 'stale')::integer,
    count(*) filter (where c.klass = 'untracked')::integer,
    count(*) filter (where c.klass = 'active')::integer,
    count(*) filter (where c.klass = 'unresolved')::integer,
    count(*) filter (
      where c.klass = 'unresolved' and c.attempts between 1 and 2 and c.next_attempt_at > now()
    )::integer,
    count(*) filter (where c.klass = 'unresolved' and c.attempts >= 3)::integer,
    count(*) filter (
      where c.klass in ('untracked', 'stale', 'unresolved')
        and c.attempts < 3
        and (c.next_attempt_at is null or c.next_attempt_at <= now())
    )::integer,
    count(*) filter (where c.klass in ('untracked', 'stale', 'unresolved', 'active'))::integer,
    count(*) filter (where c.last_synced_at is null)::integer,
    min(c.last_synced_at) filter (where c.klass in ('untracked', 'stale'))
  from classified c;
end;
$function$;

revoke all on function public.delivery_tracking_coverage(uuid, text, text, uuid[], text[], text[], integer, integer) from public, anon, authenticated;
grant execute on function public.delivery_tracking_coverage(uuid, text, text, uuid[], text[], text[], integer, integer) to service_role;

-- 1. Finalisation : date metier ecrite avec le statut (avant le trigger).
create or replace function public.finish_delivery_tracking_claim(p_store_id uuid, p_provider text, p_order_id uuid, p_worker text, p_tracking_column text, p_delivery_company_ids uuid[], p_expected_tracking_key text, p_expected_updated_at timestamp with time zone, p_allow_without_claim boolean, p_lease_seconds integer, p_attempts integer, p_last_outcome text, p_park_reason text, p_next_attempt_at timestamp with time zone, p_last_error text, p_mark_synced boolean, p_status text, p_delivery_status text, p_status_date_field text, p_status_date_value timestamp with time zone, p_raw_status text, p_complete_exchange boolean)
 returns table(outcome text, status_changed boolean, delivery_changed boolean, detail text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_allowed_columns text[] := array[
    'tracking_number','rapid_delivery_parcel_key','maroc_go_delivery_parcel_key',
    'rushliv_parcel_key','ameex_parcel_code','sendit_parcel_code',
    'forcelog_parcel_key','digylog_tracking'
  ];
  v_allowed_dates text[] := array[
    'delivered_at','sent_at','picked_up_at','refused_at','cancelled_at',
    'returned_not_stocked_at','returned_stocked_at','dl_out_for_delivery_at',
    'dl_no_answer_at','dl_unreachable_at','dl_postponed_at'
  ];
  v_allowed_delivery_status text[] := array[
    'pending','deposited','picked_up','pickup_pending','in_transit',
    'delivered','refused','cancelled','returned'
  ];
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 180), 1800));
  v_claim record;
  v_order record;
  v_notes text[] := array[]::text[];
  v_status_changed boolean := false;
  v_delivery_changed boolean := false;
  v_manual boolean := false;
  v_complete_exchange boolean := false;
  v_holds_lease boolean := false;
  v_target_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_target_delivery text := nullif(btrim(coalesce(p_delivery_status, '')), '');
  v_has_claim boolean := false;
begin
  if p_store_id is null or p_order_id is null or p_worker is null then
    raise exception 'MISSING_ARGUMENTS' using errcode = '22023';
  end if;
  if p_status_date_field is not null and not (p_status_date_field = any(v_allowed_dates)) then
    v_notes := array_append(v_notes, 'champ de date ignore (' || p_status_date_field || ')');
    p_status_date_field := null;
  end if;
  if p_delivery_company_ids is null or coalesce(array_length(p_delivery_company_ids, 1), 0) = 0 then
    return query select 'invalid_association'::text, false, false, 'transporteur non fourni'::text;
    return;
  end if;
  if p_tracking_column is null or not (p_tracking_column = any(v_allowed_columns)) then
    return query select 'invalid_association'::text, false, false, 'colonne de suivi refusee'::text;
    return;
  end if;
  if p_last_outcome is not null and p_last_outcome not in ('applied','unchanged','skipped','failed') then
    raise exception 'INVALID_OUTCOME' using errcode = '22023';
  end if;

  select * into v_claim
  from public.delivery_tracking_claims
  where order_id = p_order_id and store_id = p_store_id and provider = p_provider
  for update;

  if found then
    v_has_claim := true;
    if v_claim.locked_by is not null and v_claim.locked_by is distinct from p_worker then
      return query select 'lease_lost'::text, false, false, 'bail detenu par un autre worker'::text;
      return;
    end if;
    if v_claim.locked_by = p_worker then
      v_holds_lease := true;
      if v_claim.locked_at is null or v_claim.locked_at < now() - make_interval(secs => v_lease) then
        update public.delivery_tracking_claims
        set locked_at = null, locked_by = null, park_reason = 'stale',
            next_attempt_at = now() + interval '60 seconds', updated_at = now()
        where order_id = p_order_id and locked_by = p_worker;
        return query select 'lease_lost'::text, false, false, 'bail expire'::text;
        return;
      end if;
    elsif not coalesce(p_allow_without_claim, false) then
      return query select 'lease_lost'::text, false, false, 'claim libre hors mode manuel'::text;
      return;
    end if;

    if p_expected_tracking_key is not null and v_claim.tracking_key is distinct from p_expected_tracking_key then
      return query select 'invalid_association'::text, false, false, 'colis remplace depuis la lecture'::text;
      return;
    end if;
  elsif not coalesce(p_allow_without_claim, false) then
    return query select 'lease_lost'::text, false, false, 'claim absent hors mode manuel'::text;
    return;
  end if;
  select * into v_order
  from public.orders
  where id = p_order_id and store_id = p_store_id
  for update;

  if not found then
    return query select 'invalid_association'::text, false, false, 'commande hors store'::text;
    return;
  end if;
  if v_order.delivery_company_id is null or not (v_order.delivery_company_id = any(p_delivery_company_ids)) then
    return query select 'invalid_association'::text, false, false, 'transporteur de la commande different'::text;
    return;
  end if;
  if p_expected_tracking_key is not null
     and btrim(coalesce(to_jsonb(v_order) ->> p_tracking_column, '')) is distinct from p_expected_tracking_key then
    return query select 'invalid_association'::text, false, false, 'colis de la commande different'::text;
    return;
  end if;

  if p_expected_updated_at is not null and v_order.updated_at is distinct from p_expected_updated_at then
    if v_holds_lease then
      update public.delivery_tracking_claims
      set locked_at = null, locked_by = null, park_reason = 'stale',
          last_outcome = 'skipped', last_error = 'conflict:commande modifiee pendant le traitement',
          next_attempt_at = now() + interval '60 seconds', updated_at = now()
      where order_id = p_order_id and locked_by = p_worker;
    end if;
    return query select 'conflict'::text, false, false, 'commande modifiee pendant le traitement'::text;
    return;
  end if;

  if v_order.delivery_status_source = 'manual' then
    v_manual := true;
    v_target_status := null;
    v_target_delivery := null;
    p_status_date_field := null;
    v_notes := array_append(v_notes, 'correction manuelle : aucune ecriture metier');
  end if;

  -- 1) Metadonnees de suivi : aucun trigger de statut.
  update public.orders o
  set delivery_company_status_raw = nullif(btrim(coalesce(p_raw_status, '')), ''),
      last_delivery_sync_at = now()
  where o.id = p_order_id and o.store_id = p_store_id;

  if not v_manual then
    if v_target_delivery is not null and not (v_target_delivery = any(v_allowed_delivery_status)) then
      v_notes := array_append(v_notes, 'delivery_status hors referentiel ignore (' || v_target_delivery || ')');
      v_target_delivery := null;
    end if;
    if v_target_delivery = v_order.delivery_status then v_target_delivery := null; end if;
    if v_target_status = v_order.status then v_target_status := null; end if;

    v_complete_exchange := coalesce(p_complete_exchange, false)
      and v_order.exchange_status in ('requested', 'linked')
      and (v_target_status is not null or v_target_delivery is not null);

    -- 2) Statut : ecrit SEULEMENT s'il change. La date metier de niveau statut est
    --    ecrite dans le MEME update, sinon le trigger BEFORE remplit la date vide
    --    avec now() avant que la date transporteur soit appliquee.
    if v_target_status is not null then
      update public.orders o
      set status = v_target_status,
          delivery_status_source = 'delivery_company',
          last_status_update_at = now(),
          delivered_at = case when p_status_date_field = 'delivered_at' and o.delivered_at is null then coalesce(p_status_date_value, now()) else o.delivered_at end,
          sent_at = case when p_status_date_field = 'sent_at' and o.sent_at is null then coalesce(p_status_date_value, now()) else o.sent_at end,
          picked_up_at = case when p_status_date_field = 'picked_up_at' and o.picked_up_at is null then coalesce(p_status_date_value, now()) else o.picked_up_at end,
          cancelled_at = case when p_status_date_field = 'cancelled_at' and o.cancelled_at is null then coalesce(p_status_date_value, now()) else o.cancelled_at end,
          refused_at = case when p_status_date_field = 'refused_at' and o.refused_at is null then coalesce(p_status_date_value, now()) else o.refused_at end,
          returned_not_stocked_at = case when p_status_date_field = 'returned_not_stocked_at' and o.returned_not_stocked_at is null then coalesce(p_status_date_value, now()) else o.returned_not_stocked_at end,
          returned_stocked_at = case when p_status_date_field = 'returned_stocked_at' and o.returned_stocked_at is null then coalesce(p_status_date_value, now()) else o.returned_stocked_at end
      where o.id = p_order_id and o.store_id = p_store_id;
    end if;
    -- 3) Livraison / dates / echange : ecrits seulement si l'un change.
    if v_target_delivery is not null
       or p_status_date_field is not null
       or v_complete_exchange then
      update public.orders o
      set delivery_status = coalesce(v_target_delivery, o.delivery_status),
          delivery_status_source = case
            when v_target_delivery is not null then 'delivery_company'
            else o.delivery_status_source
          end,
          exchange_status = case when v_complete_exchange then 'completed' else o.exchange_status end,
          exchange_completed_at = case when v_complete_exchange then now() else o.exchange_completed_at end,
          delivered_at = case when p_status_date_field = 'delivered_at' and o.delivered_at is null then coalesce(p_status_date_value, now()) else o.delivered_at end,
          sent_at = case when p_status_date_field = 'sent_at' and o.sent_at is null then coalesce(p_status_date_value, now()) else o.sent_at end,
          picked_up_at = case when p_status_date_field = 'picked_up_at' and o.picked_up_at is null then coalesce(p_status_date_value, now()) else o.picked_up_at end,
          refused_at = case when p_status_date_field = 'refused_at' and o.refused_at is null then coalesce(p_status_date_value, now()) else o.refused_at end,
          cancelled_at = case when p_status_date_field = 'cancelled_at' and o.cancelled_at is null then coalesce(p_status_date_value, now()) else o.cancelled_at end,
          returned_not_stocked_at = case when p_status_date_field = 'returned_not_stocked_at' and o.returned_not_stocked_at is null then coalesce(p_status_date_value, now()) else o.returned_not_stocked_at end,
          returned_stocked_at = case when p_status_date_field = 'returned_stocked_at' and o.returned_stocked_at is null then coalesce(p_status_date_value, now()) else o.returned_stocked_at end,
          dl_out_for_delivery_at = case when p_status_date_field = 'dl_out_for_delivery_at' and o.dl_out_for_delivery_at is null then coalesce(p_status_date_value, now()) else o.dl_out_for_delivery_at end,
          dl_no_answer_at = case when p_status_date_field = 'dl_no_answer_at' and o.dl_no_answer_at is null then coalesce(p_status_date_value, now()) else o.dl_no_answer_at end,
          dl_unreachable_at = case when p_status_date_field = 'dl_unreachable_at' and o.dl_unreachable_at is null then coalesce(p_status_date_value, now()) else o.dl_unreachable_at end,
          dl_postponed_at = case when p_status_date_field = 'dl_postponed_at' and o.dl_postponed_at is null then coalesce(p_status_date_value, now()) else o.dl_postponed_at end
      where o.id = p_order_id and o.store_id = p_store_id;
    end if;
  end if;

  -- Changements reellement constates (source de verite).
  select (o.status is distinct from v_order.status),
         (o.delivery_status is distinct from v_order.delivery_status)
  into v_status_changed, v_delivery_changed
  from public.orders o
  where o.id = p_order_id and o.store_id = p_store_id;

  if v_status_changed or v_delivery_changed then
    update public.delivery_tracking_state
    set last_changed_at = now(), updated_at = now()
    where store_id = p_store_id and provider = p_provider;
  end if;

  if v_holds_lease then
    update public.delivery_tracking_claims
    set attempts = greatest(coalesce(p_attempts, 0), 0),
        last_outcome = p_last_outcome,
        park_reason = p_park_reason,
        last_error = left(coalesce(p_last_error, ''), 400),
        last_synced_at = case when p_mark_synced then now() else last_synced_at end,
        last_attempt_at = now(),
        next_attempt_at = coalesce(p_next_attempt_at, now()),
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where order_id = p_order_id and locked_by = p_worker;
  elsif not v_has_claim then
    v_notes := array_append(v_notes, 'suivi manuel sans claim');
  end if;

  return query select
    case when v_status_changed or v_delivery_changed then 'applied' else 'unchanged' end::text,
    v_status_changed,
    v_delivery_changed,
    case when array_length(v_notes, 1) is null then 'ok' else array_to_string(v_notes, ' ; ') end::text;
end;
$function$;

revoke all on function public.finish_delivery_tracking_claim(uuid, text, uuid, text, text, uuid[], text, timestamp with time zone, boolean, integer, integer, text, text, timestamp with time zone, text, boolean, text, text, text, timestamp with time zone, text, boolean) from public, anon, authenticated;
grant execute on function public.finish_delivery_tracking_claim(uuid, text, uuid, text, text, uuid[], text, timestamp with time zone, boolean, integer, integer, text, text, timestamp with time zone, text, boolean, text, text, text, timestamp with time zone, text, boolean) to service_role;
