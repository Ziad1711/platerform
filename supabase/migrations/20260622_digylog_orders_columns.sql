-- ============================================================
-- Digylog: colonne de tracking dans orders (colonne standard utilisée)
-- ============================================================

-- On utilise les colonnes standard existantes :
--   tracking_number        → numéro de suivi Digylog
--   delivery_city_external_id → clé ville Digylog
--   external_delivery_id   → ID externe du colis
--   delivery_voucher_key   → clé du voucher/BL

-- Colonne supplémentaire pour le tracking Digylog (fallback webhook)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS digylog_tracking text;

CREATE INDEX IF NOT EXISTS idx_orders_digylog_tracking ON orders(digylog_tracking);
