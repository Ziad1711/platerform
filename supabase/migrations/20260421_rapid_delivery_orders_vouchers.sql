alter table public.orders
  add column if not exists rapid_delivery_city_key bigint null,
  add column if not exists rapid_delivery_parcel_key text null,
  add column if not exists rapid_delivery_voucher_key text null;

update public.orders
set rapid_delivery_parcel_key = tracking_number
where tracking_number is not null
  and coalesce(rapid_delivery_parcel_key, '') = '';

create index if not exists orders_store_confirmed_parcels_without_voucher_idx
  on public.orders(store_id, confirmed_at desc)
  where status = 'confirmed'
    and rapid_delivery_parcel_key is not null
    and rapid_delivery_voucher_key is null;

create index if not exists orders_store_rapid_voucher_key_idx
  on public.orders(store_id, rapid_delivery_voucher_key);