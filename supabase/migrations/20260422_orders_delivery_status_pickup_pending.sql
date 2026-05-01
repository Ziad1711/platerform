alter table public.orders drop constraint if exists orders_delivery_status_check;

alter table public.orders
  add constraint orders_delivery_status_check
  check (
    delivery_status is null
    or delivery_status = any (
      array[
        'pending'::text,
        'deposited'::text,
        'picked_up'::text,
        'pickup_pending'::text,
        'in_transit'::text,
        'delivered'::text,
        'refused'::text,
        'cancelled'::text,
        'returned'::text
      ]
    )
  );