-- ============================================================
-- P8.4 D4 - Livraison : interdiction des colonnes commerciales
-- Version : 20261023110000
-- Projet : jisra-test / goqedvcdmgtejtyrawsp
-- ------------------------------------------------------------
-- Defaut reproduit : un membre actif de role `delivery` pouvait modifier
-- `total_selling_price` (et toute autre colonne) par un PATCH REST direct,
-- la politique orders_update_store_scope ne restreignant pas les colonnes.
--
-- Correctif : garde BEFORE UPDATE, en premiere position alphabetique pour
-- observer le payload tel que soumis (avant les triggers qui recalculent
-- updated_at, profit, timestamps de statut...), donc sans faux positif.
--
-- Portee : uniquement les appels directs d'un utilisateur `authenticated`
-- ou `anon`. Les contextes privilegies (service_role utilise par les routes
-- applicatives, postgres) ne sont pas filtres, ce qui preserve les parcours
-- legitimes : /api/orders/status met a jour via le client admin.
--
-- Un utilisateur qui est aussi owner/admin du store n'est jamais filtre.
-- ============================================================

create or replace function public.p84_is_delivery_only(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = 'delivery'
  )
  and not exists (
    select 1 from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin')
  )
  and not exists (
    select 1 from public.stores s
    where s.id = p_store_id
      and s.owner_user_id = auth.uid()
  );
$$;

revoke all on function public.p84_is_delivery_only(uuid) from public;
revoke all on function public.p84_is_delivery_only(uuid) from anon;
grant execute on function public.p84_is_delivery_only(uuid) to authenticated, service_role;

-- Garde : fonction en SECURITY INVOKER (volontaire), afin que current_user
-- reflete le role appelant reel (authenticated / service_role / postgres).
create or replace function public.p84_guard_delivery_order_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_allowed text[] := array[
    'status',
    'delivery_status',
    'delivery_note',
    'delivery_company_id',
    'tracking_number',
    'delivery_city_external_id',
    'delivery_status_source',
    'last_status_update_at',
    'updated_at'
  ];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if auth.uid() is null then
    return new;
  end if;

  if old.store_id is distinct from new.store_id then
    raise exception 'ORDER_STORE_IMMUTABLE';
  end if;

  if not public.p84_is_delivery_only(old.store_id) then
    return new;
  end if;

  if (to_jsonb(old) - v_allowed) is distinct from (to_jsonb(new) - v_allowed) then
    raise exception 'DELIVERY_COLUMN_FORBIDDEN';
  end if;

  return new;
end;
$$;

revoke all on function public.p84_guard_delivery_order_columns() from public;
revoke all on function public.p84_guard_delivery_order_columns() from anon, authenticated;
grant execute on function public.p84_guard_delivery_order_columns() to service_role;

-- Nom prefixe `a_` : execute avant les triggers `set_*` / `trg_*`.
drop trigger if exists a_p84_delivery_order_columns on public.orders;
create trigger a_p84_delivery_order_columns
  before update on public.orders
  for each row
  execute function public.p84_guard_delivery_order_columns();
