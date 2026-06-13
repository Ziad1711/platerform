-- Supprimer le trigger legacy qui normalisait automatiquement la ville
-- vers Rapid Delivery à chaque insert/update
drop trigger if exists orders_set_rapid_delivery_city_key on public.orders;
drop function if exists public.trg_orders_set_rapid_delivery_city_key();

-- Supprimer la colonne legacy rapid_delivery_city_key (remplacée par le système générique)
alter table public.orders drop column if exists rapid_delivery_city_key;
