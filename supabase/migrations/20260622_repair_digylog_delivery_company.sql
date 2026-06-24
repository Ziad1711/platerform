-- Réparer les sociétés de livraison Digylog manquantes pour les stores déjà connectés

INSERT INTO delivery_companies (store_id, name, api_provider, is_active, created_at)
SELECT DISTINCT
  cfg.store_id,
  'Digylog',
  'digylog',
  true,
  NOW()
FROM digylog_configs cfg
WHERE NOT EXISTS (
  SELECT 1
  FROM delivery_companies dc
  WHERE dc.store_id = cfg.store_id
    AND dc.name = 'Digylog'
);

UPDATE delivery_companies
SET api_provider = 'digylog', is_active = true
WHERE name = 'Digylog'
  AND api_provider IS DISTINCT FROM 'digylog';