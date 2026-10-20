-- B13 — oracle fonctionnel de la reference C0 (dashboard_kpi_invalidate_insert_stmt).
--
-- Reference C0 adoptee : md5(pg_get_functiondef) = 2536fe3c58c8af6b18acb844ac585049
-- Source             : supabase/migrations/20261018232500_b13_final_state.sql
-- Ancienne reference : c685fdd2e81ee1f9034be3f4ceaf53fd (textuelle, non reproductible
--                      depuis les sources versionnees) — conservee pour tracabilite.
--
-- GARANTIES ANTI-FAUX-PASS :
--   * aucun PASS si les fixtures manquent ;
--   * aucun PASS si aucune invalidation n'est produite ;
--   * aucun PASS si l'ensemble observe differe de l'oracle ;
--   * toute erreur SQL leve immediatement (ON_ERROR_STOP + exceptions).
--
-- Le test se termine par un RAISE volontaire : la transaction est annulee
-- (fixtures supprimees, triggers intacts). Le message P79_C0_FUNC_PASS est
-- l'unique preuve de succes.
--
-- psql "$URL" -v ON_ERROR_STOP=1 -f c0-functional-test.sql

\set ON_ERROR_STOP on
begin;

DO $$
declare
  v_orders int; v_inv int; v_expected int; v_missing int; v_extra int;
  c_f1 uuid := '7f000000-0000-4000-8000-0000000000f1';
  c_f2 uuid := '7f000000-0000-4000-8000-0000000000f2';
begin
  insert into public.stores (id, owner_user_id, name, currency, country) values
   (c_f1, 'c45355f3-6ab5-4dda-8861-d52e283bf163', 'C0T1', 'MAD', 'MA'),
   (c_f2, 'c45355f3-6ab5-4dda-8861-d52e283bf163', 'C0T2', 'MAD', 'MA');

  -- 5 commandes : journee identique (delivered NULL), journee identique (livree),
  -- journees distinctes (frontiere 23:59:59 -> 00:00:00 Casablanca), 2 boutiques.
  insert into public.orders (id, store_id, status, order_date, delivered_at,
    subtotal_amount, discount_amount, delivery_charge_to_customer,
    rounding_adjustment, total_selling_price, discount_type, discount_value,
    customer_name, source) values
   ('7f000000-0000-4000-8000-0000000000c1', c_f1, 'new',
    (date '2000-01-10'::timestamp at time zone 'Africa/Casablanca'), null,
    0,0,0,0,0,'fixed',0,'C0','organic'),
   ('7f000000-0000-4000-8000-0000000000c2', c_f1, 'new',
    (date '2000-01-10'::timestamp at time zone 'Africa/Casablanca'),
    ((date '2000-01-10'::timestamp at time zone 'Africa/Casablanca') + interval '15 hours'),
    0,0,0,0,0,'fixed',0,'C0','organic'),
   ('7f000000-0000-4000-8000-0000000000c3', c_f1, 'new',
    ((date '2000-01-10'::timestamp at time zone 'Africa/Casablanca') + interval '23 hours 59 minutes 59 seconds'),
    (date '2000-01-11'::timestamp at time zone 'Africa/Casablanca'),
    0,0,0,0,0,'fixed',0,'C0','organic'),
   ('7f000000-0000-4000-8000-0000000000c4', c_f2, 'new',
    (date '2000-01-11'::timestamp at time zone 'Africa/Casablanca'), null,
    0,0,0,0,0,'fixed',0,'C0','organic'),
   ('7f000000-0000-4000-8000-0000000000c5', c_f2, 'new',
    ((date '2000-01-11'::timestamp at time zone 'Africa/Casablanca') + interval '1 second'),
    ((date '2000-01-11'::timestamp at time zone 'Africa/Casablanca') + interval '1 second'),
    0,0,0,0,0,'fixed',0,'C0','organic');

  select count(*) into v_orders from public.orders where store_id in (c_f1, c_f2);
  if v_orders <> 5 then
    raise exception 'FIXTURES_MISSING orders=% (attendu 5)', v_orders;
  end if;

  -- Oracle independant : journees derivees de la source, pas du code teste.
  with exp as (
    select distinct store_id,
           (order_date at time zone 'Africa/Casablanca')::date as d
      from public.orders where store_id in (c_f1, c_f2)
    union
    select distinct store_id,
           (coalesce(delivered_at, order_date) at time zone 'Africa/Casablanca')::date
      from public.orders where store_id in (c_f1, c_f2)
  ), act as (
    select distinct store_id, business_date as d
      from public.dashboard_kpi_invalidation
     where store_id in (c_f1, c_f2) and note_tx = txid_current()
  )
  select (select count(*) from exp),
         (select count(*) from exp e where not exists
            (select 1 from act a where a.store_id = e.store_id and a.d = e.d)),
         (select count(*) from act a where not exists
            (select 1 from exp e where e.store_id = a.store_id and e.d = a.d))
    into v_expected, v_missing, v_extra;

  select count(*) into v_inv
    from public.dashboard_kpi_invalidation
   where store_id in (c_f1, c_f2) and note_tx = txid_current();

  if v_inv = 0 then
    raise exception 'INVALIDATIONS_EMPTY (test non concluant)';
  end if;
  if v_missing > 0 or v_extra > 0 or v_inv <> v_expected then
    raise exception 'MISMATCH inv=% expected=% missing=% extra=%',
      v_inv, v_expected, v_missing, v_extra;
  end if;

  raise exception 'P79_C0_FUNC_PASS orders=% invalidations=% expected=% missing=0 extra=0',
    v_orders, v_inv, v_expected;
end
$$;

-- Jamais atteint : le RAISE ci-dessus annule la transaction (fixtures + triggers).
rollback;
