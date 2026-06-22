-- ============================================================
-- Digylog Integration — Tables & Config
-- ============================================================

-- 1. Config Digylog par store
CREATE TABLE IF NOT EXISTS digylog_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  default_external_store text,
  default_network_id integer,
  default_order_mode integer DEFAULT 1,
  default_send_status integer DEFAULT 1,
  check_duplicate integer DEFAULT 1,
  openproduct_default integer DEFAULT 1,
  port_default integer DEFAULT 1,
  webhook_secret text,
  webhook_url text,
  last_webhook_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(store_id)
);

-- 2. Webhook events Digylog (idempotence + audit)
CREATE TABLE IF NOT EXISTS digylog_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_key text,
  payload jsonb,
  processed boolean DEFAULT false,
  error text,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_digylog_webhook_events_integration ON digylog_webhook_events(integration_id);
CREATE INDEX IF NOT EXISTS idx_digylog_webhook_events_unprocessed ON digylog_webhook_events(processed, created_at);

-- 3. Enable RLS
ALTER TABLE digylog_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE digylog_webhook_events ENABLE ROW LEVEL SECURITY;

-- 4. RLS policies
CREATE POLICY "digylog_configs_store_access" ON digylog_configs
  FOR ALL USING (
    store_id IN (
      SELECT store_id FROM store_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "digylog_webhook_events_store_access" ON digylog_webhook_events
  FOR ALL USING (
    store_id IN (
      SELECT store_id FROM store_members WHERE user_id = auth.uid()
    )
  );
