-- Ajouter une contrainte unique sur (store_id, name) pour delivery_companies
-- Cela permet à l'upsert de fonctionner correctement et empêche les doublons

-- 1. Nettoyer les doublons existants avant d'ajouter la contrainte
DELETE FROM delivery_companies dc1 USING (
  SELECT MIN(id) as id, store_id, name
  FROM delivery_companies
  GROUP BY store_id, name
  HAVING COUNT(*) > 1
) dc2
WHERE dc1.store_id = dc2.store_id
  AND dc1.name = dc2.name
  AND dc1.id <> dc2.id;

-- 2. Ajouter la contrainte unique
ALTER TABLE delivery_companies
ADD CONSTRAINT delivery_companies_store_id_name_key UNIQUE (store_id, name);
