-- ============================================================
-- Seed ForceLog provider
-- ============================================================
insert into public.integration_providers (
  id,
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
  '422b8621-f708-4e5a-ba50-c9196c214a8a',
  'forcelog',
  'ForceLog',
  'Intégration ForceLog pour synchroniser colis, étiquettes et demandes de ramassage.',
  'delivery',
  'https://api.forcelog.ma/favicon.ico',
  true,
  now(),
  5,
  0
)
on conflict (id) do update
set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  logo_url = excluded.logo_url,
  is_active = excluded.is_active,
  rating_avg = excluded.rating_avg,
  total_reviews = excluded.total_reviews;