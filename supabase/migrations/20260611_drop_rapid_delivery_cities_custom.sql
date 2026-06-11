-- Drop legacy table rapid_delivery_cities_custom
-- All custom pricing is now stored in delivery_rates via pricing_groups
DROP TABLE IF EXISTS rapid_delivery_cities_custom;
