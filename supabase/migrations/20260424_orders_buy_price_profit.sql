alter table public.orders
  add column if not exists buy_price numeric(12,2) not null default 0,
  add column if not exists profit numeric(12,2) not null default 0;

create or replace function public.recalc_order_financials(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  v_buy_price numeric(12,2) := 0;
begin
  if p_order_id is null then
    return;
  end if;

  select coalesce(sum(coalesce(oi.quantity, 0) * coalesce(oi.unit_purchase_cost_snapshot, 0)), 0)::numeric(12,2)
  into v_buy_price
  from public.order_items oi
  where oi.order_id = p_order_id;

  update public.orders o
  set
    buy_price = coalesce(v_buy_price, 0),
    profit = (
      coalesce(o.total_selling_price, 0)
      - coalesce(v_buy_price, 0)
      - coalesce(o.ads_cost_allocated, 0)
      - coalesce(o.confirmation_cost_allocated, 0)
      - coalesce(o.delivery_fee, 0)
      + coalesce(o.delivery_charge_to_customer, 0)
    )::numeric(12,2)
  where o.id = p_order_id;
end;
$$;

create or replace function public.orders_set_profit_before_write()
returns trigger
language plpgsql
as $$
begin
  new.buy_price := coalesce(new.buy_price, 0);
  new.profit := (
    coalesce(new.total_selling_price, 0)
    - coalesce(new.buy_price, 0)
    - coalesce(new.ads_cost_allocated, 0)
    - coalesce(new.confirmation_cost_allocated, 0)
    - coalesce(new.delivery_fee, 0)
    + coalesce(new.delivery_charge_to_customer, 0)
  )::numeric(12,2);

  return new;
end;
$$;

create or replace function public.order_items_recalc_order_financials_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_order_financials(old.order_id);
    return old;
  end if;

  perform public.recalc_order_financials(new.order_id);

  if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
    perform public.recalc_order_financials(old.order_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_set_profit_before_write on public.orders;
create trigger trg_orders_set_profit_before_write
before insert or update of total_selling_price, ads_cost_allocated, confirmation_cost_allocated, delivery_fee, delivery_charge_to_customer, buy_price
on public.orders
for each row
execute function public.orders_set_profit_before_write();

drop trigger if exists trg_order_items_recalc_order_financials on public.order_items;
create trigger trg_order_items_recalc_order_financials
after insert or update or delete
on public.order_items
for each row
execute function public.order_items_recalc_order_financials_trigger();

update public.orders o
set buy_price = coalesce(src.buy_price, 0)
from (
  select
    order_id,
    coalesce(sum(coalesce(quantity, 0) * coalesce(unit_purchase_cost_snapshot, 0)), 0)::numeric(12,2) as buy_price
  from public.order_items
  group by order_id
) as src
where o.id = src.order_id;

update public.orders
set buy_price = 0
where buy_price is null;

update public.orders o
set profit = (
  coalesce(o.total_selling_price, 0)
  - coalesce(o.buy_price, 0)
  - coalesce(o.ads_cost_allocated, 0)
  - coalesce(o.confirmation_cost_allocated, 0)
  - coalesce(o.delivery_fee, 0)
  + coalesce(o.delivery_charge_to_customer, 0)
)::numeric(12,2);

do $$
declare
  r record;
begin
  for r in select id from public.orders loop
    perform public.recalc_order_financials(r.id);
  end loop;
end;
$$;