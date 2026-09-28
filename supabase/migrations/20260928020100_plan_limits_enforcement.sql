-- ============================================================================
-- Application des limites d'offre au niveau transactionnel.
--
-- Le contrôle est posé sur la base (et non seulement dans l'interface) afin de
-- couvrir tous les chemins de création : interface, import, duplication,
-- synchronisation, webhooks et API publique.
--
-- Périmètre volontairement limité aux droits dont les valeurs du catalogue sont
-- sans ambiguïté : commandes, stores, crédits IA. Les droits
-- `delivery_integrations_limit`, `confirmation_agents_limit`,
-- `ads_automation_enabled` et `api_access_enabled` ne sont PAS appliqués ici :
-- l'offre gratuite porte 0 / 0 / false, ce qui bloquerait des fonctions déjà
-- utilisées. Décision commerciale requise avant activation.
-- ============================================================================

-- ---------- 1. Commandes : quota mensuel par propriétaire ----------
-- Comptage à la fin de l'instruction (une seule mesure par propriétaire et par
-- instruction), ce qui reste rapide même sur un import massif. Une commande
-- comptée reste comptée : une suppression ne rend pas de quota.
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
  loop
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

drop trigger if exists trg_enforce_order_quota on public.orders;
create trigger trg_enforce_order_quota
after insert on public.orders
referencing new table as new_rows
for each statement execute function public.enforce_order_quota();

-- ---------- 2. Stores : quota par propriétaire ----------
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
  loop
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

drop trigger if exists trg_enforce_store_quota on public.stores;
create trigger trg_enforce_store_quota
after insert on public.stores
referencing new table as new_rows
for each statement execute function public.enforce_store_quota();
