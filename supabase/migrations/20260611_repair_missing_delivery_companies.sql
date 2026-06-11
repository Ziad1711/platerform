-- Réparer les delivery_companies manquantes pour les stores qui ont Rapid Delivery connecté
-- mais où l'upsert a échoué silencieusement à cause de l'absence de contrainte unique

INSERT INTO delivery_companies (store_id, name, api_provider, is_active, created_at)
SELECT DISTINCT
  rd.store_id,
  'Rapid Delivery',
  'rapid-delivery',
  true,
  NOW()
FROM rapid_delivery_configs rd
WHERE NOT EXISTS (
  SELECT 1 FROM delivery_companies dc
  WHERE dc.store_id = rd.store_id
    AND dc.name = 'Rapid Delivery'
)
  AND rd.store_id IS NOT NULL;
