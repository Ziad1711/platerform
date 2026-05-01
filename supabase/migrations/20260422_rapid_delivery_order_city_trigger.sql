create or replace function public.trg_orders_set_rapid_delivery_city_key()
returns trigger
language plpgsql
as $$
declare
  matched_city record;
begin
  if coalesce(new.rapid_delivery_city_key, 0) <> 0 then
    return new;
  end if;

  if coalesce(trim(new.city), '') = '' then
    return new;
  end if;

  select city_key, city_name
    into matched_city
  from public.rapid_delivery_cities_standard
  where lower(city_name) = lower(trim(new.city))
  limit 1;

  if matched_city.city_key is not null then
    new.rapid_delivery_city_key := matched_city.city_key;
    new.city := matched_city.city_name;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_set_rapid_delivery_city_key on public.orders;
create trigger orders_set_rapid_delivery_city_key
before insert or update of city, rapid_delivery_city_key
on public.orders
for each row
execute function public.trg_orders_set_rapid_delivery_city_key();

update public.orders o
set
  rapid_delivery_city_key = c.city_key,
  city = c.city_name,
  updated_at = now()
from public.rapid_delivery_cities_standard c
where o.city is not null
  and coalesce(o.rapid_delivery_city_key, 0) = 0
  and lower(o.city) = lower(c.city_name);