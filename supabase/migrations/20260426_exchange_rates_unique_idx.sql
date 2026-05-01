CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_unique_idx
ON exchange_rates (owner_user_id, base_currency, target_currency, rate_date);
