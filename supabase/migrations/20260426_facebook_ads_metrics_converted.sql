-- Ajout des colonnes de métriques converties en MAD
-- Les métriques monétaires Facebook sont en USD, on stocke aussi la version convertie

ALTER TABLE ad_spend_daily
  ADD COLUMN IF NOT EXISTS cpc_converted numeric(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cpm_converted numeric(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cpp_converted numeric(14,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conversion_value_converted numeric(14,4) DEFAULT 0;

COMMENT ON COLUMN ad_spend_daily.cpc_converted IS 'CPC converti en MAD (currency_convert)';
COMMENT ON COLUMN ad_spend_daily.cpm_converted IS 'CPM converti en MAD (currency_convert)';
COMMENT ON COLUMN ad_spend_daily.cpp_converted IS 'CPP converti en MAD (currency_convert)';
COMMENT ON COLUMN ad_spend_daily.conversion_value_converted IS 'Valeur de conversion convertie en MAD (currency_convert)';
