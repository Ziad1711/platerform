-- ============================================================
-- Migration: delivery_provider_logs
-- Table de logs structurés pour toutes les opérations delivery
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_provider_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  action TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT NULL,
  duration_ms INTEGER DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_delivery_provider_logs_integration ON delivery_provider_logs (integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_provider_logs_store ON delivery_provider_logs (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_provider_logs_action ON delivery_provider_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_provider_logs_level ON delivery_provider_logs (level, created_at DESC);

-- RLS: accessible uniquement via service_role (admin client)
ALTER TABLE delivery_provider_logs ENABLE ROW LEVEL SECURITY;

-- Seul le service_role peut insérer/lire
CREATE POLICY "service_role_all" ON delivery_provider_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
