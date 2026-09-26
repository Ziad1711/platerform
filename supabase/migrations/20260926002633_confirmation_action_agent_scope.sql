-- ============================================================
-- Module Confirmation — périmètre agent sur l'action atomique
-- Un agent de confirmation ne peut traiter que ses commandes assignées.
-- Premier contact sur commande non assignée : elle est attribuée à l'agent.
-- ============================================================

create or replace function public.rpc_order_confirmation_action(
  p_order_id uuid,
  p_action text,
  p_callback_at timestamptz default null,
  p_reason_code text default null,
  p_note text default null,
  p_expected_status text default null,
  p_expected_attempt_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_statuses text[] := array[
    'new', 'confirmation_rejected',
    'follow_up_1', 'follow_up_2', 'follow_up_3', 'follow_up_4', 'follow_up_5',
    'no_answer', 'wrong_number', 'voicemail'
  ];
  v_order public.orders%rowtype;
  v_action text;
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_agent_id uuid;
  v_max_attempts integer;
  v_auto_cancel boolean;
  v_require_reason boolean;
  v_attempt integer;
  v_attempt_number integer;
  v_from_status text;
  v_new_status text;
  v_auto_cancelled boolean := false;
  v_limit_reached boolean := false;
  v_now timestamptz := now();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED';
  end if;

  v_action := upper(btrim(coalesce(p_action, '')));
  if v_action not in ('NO_ANSWER', 'POSTPONE', 'CANCEL', 'CONFIRM') then
    raise exception 'INVALID_ACTION';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.stores s
    where s.id = v_order.store_id and s.owner_user_id = v_actor
  ) then
    v_actor_role := 'owner';
  else
    select sm.role into v_actor_role
    from public.store_members sm
    where sm.store_id = v_order.store_id
      and sm.user_id = v_actor
      and sm.status = 'active'
    limit 1;
  end if;

  if v_actor_role not in ('owner', 'admin', 'confirmation') then
    raise exception 'FORBIDDEN';
  end if;

  select ca.id into v_agent_id
  from public.confirmation_agents ca
  join public.store_members sm on sm.id = ca.member_id
  where ca.store_id = v_order.store_id
    and sm.user_id = v_actor
  limit 1;

  if v_actor_role = 'confirmation' then
    if v_order.confirmation_agent_id is not null
       and v_order.confirmation_agent_id <> v_agent_id then
      raise exception 'FORBIDDEN';
    end if;

    if v_order.confirmation_agent_id is null and v_agent_id is not null then
      update public.orders
      set confirmation_agent_id = v_agent_id, updated_at = v_now
      where id = p_order_id;
      v_order.confirmation_agent_id := v_agent_id;
    end if;
  end if;

  if not (v_order.status = any (v_pending_statuses)) then
    raise exception 'ORDER_NOT_CONFIRMABLE';
  end if;

  if p_expected_status is not null and p_expected_status <> v_order.status then
    raise exception 'ORDER_ALREADY_UPDATED';
  end if;

  if p_expected_attempt_count is not null
     and p_expected_attempt_count <> coalesce(v_order.confirmation_attempt_count, 0) then
    raise exception 'ORDER_ALREADY_UPDATED';
  end if;

  select
    coalesce(cs.max_attempts, 6),
    coalesce(cs.auto_cancel_on_max_attempts, true),
    coalesce(cs.require_cancellation_reason, true)
  into v_max_attempts, v_auto_cancel, v_require_reason
  from (select 1) seed
  left join public.confirmation_settings cs on cs.store_id = v_order.store_id;

  if v_max_attempts < 1 then
    v_max_attempts := 1;
  end if;

  v_agent_id := coalesce(v_order.confirmation_agent_id, v_agent_id);

  v_attempt := coalesce(v_order.confirmation_attempt_count, 0);
  v_from_status := v_order.status;
  v_new_status := v_order.status;

  if v_action = 'NO_ANSWER' then
    v_attempt := v_attempt + 1;
    v_attempt_number := v_attempt;

    if v_attempt >= v_max_attempts then
      v_limit_reached := true;
      if v_auto_cancel then
        v_new_status := 'cancelled';
        v_auto_cancelled := true;
      else
        v_new_status := 'no_answer';
      end if;
    else
      v_new_status := case
        when v_attempt = 1 then 'follow_up_1'
        when v_attempt = 2 then 'follow_up_2'
        when v_attempt = 3 then 'follow_up_3'
        when v_attempt = 4 then 'follow_up_4'
        when v_attempt = 5 then 'follow_up_5'
        else 'no_answer'
      end;
    end if;

    update public.orders
    set confirmation_attempt_count = v_attempt,
        status = v_new_status,
        next_callback_at = null,
        cancellation_reason_code = case
          when v_auto_cancelled then 'max_attempts_reached'
          else cancellation_reason_code
        end,
        cancellation_note = case
          when v_auto_cancelled then coalesce(v_note, 'Nombre maximal de tentatives atteint')
          else cancellation_note
        end,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        last_status_update_at = v_now,
        delivery_status_source = 'manual',
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'no_answer',
      v_from_status, v_new_status, v_attempt_number, null, v_note,
      jsonb_build_object('maxAttempts', v_max_attempts, 'limitReached', v_limit_reached)
    );

    if v_auto_cancelled then
      insert into public.order_confirmation_events (
        store_id, order_id, actor_user_id, agent_id, event_type,
        from_status, to_status, attempt_number, reason_code, note, metadata
      ) values (
        v_order.store_id, p_order_id, v_actor, v_agent_id, 'cancelled_max_attempts',
        v_from_status, 'cancelled', v_attempt_number, 'max_attempts_reached',
        coalesce(v_note, 'Nombre maximal de tentatives atteint'),
        jsonb_build_object('maxAttempts', v_max_attempts)
      );
    end if;

  elsif v_action = 'POSTPONE' then
    if p_callback_at is null then
      raise exception 'MISSING_CALLBACK_DATETIME';
    end if;
    if p_callback_at <= v_now then
      raise exception 'INVALID_CALLBACK_DATETIME';
    end if;

    update public.orders
    set next_callback_at = p_callback_at,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, callback_at, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'postponed',
      v_from_status, v_new_status, null, p_callback_at, null, v_note,
      jsonb_build_object('attemptCount', v_attempt)
    );

  elsif v_action = 'CANCEL' then
    if v_require_reason and v_reason is null then
      raise exception 'MISSING_CANCELLATION_REASON';
    end if;
    if v_reason = 'other' and v_note is null then
      raise exception 'MISSING_CANCELLATION_NOTE';
    end if;

    v_new_status := 'cancelled';

    update public.orders
    set status = v_new_status,
        next_callback_at = null,
        cancellation_reason_code = coalesce(v_reason, 'other'),
        cancellation_note = v_note,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        last_status_update_at = v_now,
        delivery_status_source = 'manual',
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'cancelled_manual',
      v_from_status, v_new_status, null, coalesce(v_reason, 'other'), v_note,
      jsonb_build_object('attemptCount', v_attempt)
    );

  else
    v_new_status := 'confirmed';

    update public.orders
    set status = v_new_status,
        next_callback_at = null,
        cancellation_reason_code = null,
        cancellation_note = null,
        confirmation_last_action_at = v_now,
        confirmation_last_actor_user_id = v_actor,
        last_status_update_at = v_now,
        delivery_status_source = 'manual',
        updated_at = v_now
    where id = p_order_id;

    insert into public.order_confirmation_events (
      store_id, order_id, actor_user_id, agent_id, event_type,
      from_status, to_status, attempt_number, reason_code, note, metadata
    ) values (
      v_order.store_id, p_order_id, v_actor, v_agent_id, 'confirmed',
      v_from_status, v_new_status, null, null, v_note,
      jsonb_build_object('attemptCount', v_attempt)
    );
  end if;

  return jsonb_build_object(
    'orderId', p_order_id,
    'action', v_action,
    'fromStatus', v_from_status,
    'status', v_new_status,
    'attemptCount', v_attempt,
    'attemptNumber', v_attempt_number,
    'maxAttempts', v_max_attempts,
    'autoCancelled', v_auto_cancelled,
    'limitReached', v_limit_reached
  );
end;
$$;
