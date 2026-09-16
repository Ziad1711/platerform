-- ============================================================
-- delivery_rates : déduplication + contrainte unique attendue
-- par les upserts (pricing_group_id, external_city_key).
-- Sans cette contrainte, l'insertion des tarifs d'un nouveau
-- provider (ex: Maroc Go Delivery) échoue avec 42P10.
-- ============================================================

-- 1. Supprimer les doublons stricts (on garde la ligne la plus récente,
--    puis l'id le plus petit en cas d'égalité de date)
delete from public.delivery_rates dr
using public.delivery_rates dr2
where dr.pricing_group_id = dr2.pricing_group_id
  and dr.external_city_key = dr2.external_city_key
  and dr.id <> dr2.id
  and (
    dr.updated_at < dr2.updated_at
    or (dr.updated_at = dr2.updated_at and dr.id > dr2.id)
  );

-- 2. Contrainte unique nécessaire aux upsert() côté application
create unique index if not exists delivery_rates_pricing_group_city_unique
  on public.delivery_rates (pricing_group_id, external_city_key);
