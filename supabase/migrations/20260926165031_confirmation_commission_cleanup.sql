-- ============================================================
-- Nettoyage : suppression de l'ancienne surcharge mono-store.
-- Elle calculait la commission avec le tarif courant de l'agent
-- (fallback sur commission_per_order) au lieu des snapshots.
-- Le dashboard utilise désormais la surcharge multi-store fondée
-- sur les snapshots (voir confirmation_commission_fixes).
-- ============================================================

drop function if exists public.rpc_dashboard_confirmation_performance(uuid, timestamptz, timestamptz);
