-- ============================================================================
-- Quotas d'offre : comptage fiable sous concurrence.
--
-- Le comptage se fait après insertion (une seule mesure par propriétaire et par
-- instruction), mais deux insertions simultanées pouvaient chacune se croire sous
-- la limite et la dépasser ensemble. Chaque propriétaire concerné est désormais
-- verrouillé le temps de la transaction (`pg_advisory_xact_lock`), ce qui
-- sérialise le comptage sans bloquer les autres comptes.
--
-- Clé de verrou à deux dimensions : (espace de noms, propriétaire). Les
-- propriétaires sont parcourus dans un ordre déterministe pour écarter tout
-- interblocage quand une instruction touche plusieurs comptes.
-- ============================================================================

create or replace function public.enforce_order_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_plan public.plans;
  v_limit integer;
  v_used integer;
begin
  for v_owner in
    select distinct st.owner_user_id
    from new_rows nr
    join public.stores st on st.id = nr.store_id
    where st.owner_user_id is not null
    order by st.owner_user_id
  loop
    perform pg_advisory_xact_lock(hashtext('jisra_quota_orders'), hashtext(v_owner::text));

    v_plan := public.resolve_effective_plan(v_owner);
    if v_plan.id is null then
      continue;
    end if;

    v_limit := v_plan.order_limit;
    if public.plan_limit_is_unlimited(v_limit) then
      continue;
    end if;

    select count(*) into v_used
    from public.orders o
    join public.stores st on st.id = o.store_id
    where st.owner_user_id = v_owner
      and o.created_at >= date_trunc('month', now());

    if v_used > v_limit then
      raise exception 'QUOTA_ORDER_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.enforce_order_quota() is
  'Quota mensuel de commandes par propriétaire. Verrou par propriétaire pour un comptage fiable sous concurrence.';

create or replace function public.enforce_store_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_plan public.plans;
  v_limit integer;
  v_used integer;
begin
  for v_owner in
    select distinct nr.owner_user_id
    from new_rows nr
    where nr.owner_user_id is not null
    order by nr.owner_user_id
  loop
    perform pg_advisory_xact_lock(hashtext('jisra_quota_stores'), hashtext(v_owner::text));

    v_plan := public.resolve_effective_plan(v_owner);
    if v_plan.id is null then
      continue;
    end if;

    v_limit := v_plan.stores_limit;
    if public.plan_limit_is_unlimited(v_limit) then
      continue;
    end if;

    select count(*) into v_used
    from public.stores st
    where st.owner_user_id = v_owner;

    if v_used > v_limit then
      raise exception 'QUOTA_STORES_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;

comment on function public.enforce_store_quota() is
  'Quota de stores par propriétaire. Verrou par propriétaire pour un comptage fiable sous concurrence.';
