insert into public.integration_providers (
  slug,
  name,
  description,
  category,
  logo_url,
  is_active,
  created_at,
  rating_avg,
  total_reviews
)
values (
  'rapid-delivery',
  'Rapid delivery',
  'Intégration Rapid Delivery pour synchroniser shops, villes, états et colis.',
  'delivery',
  'https://www.rapiddelivery.ma/favicon.ico',
  true,
  now(),
  5,
  0
)
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  logo_url = excluded.logo_url,
  is_active = excluded.is_active,
  rating_avg = excluded.rating_avg,
  total_reviews = excluded.total_reviews;