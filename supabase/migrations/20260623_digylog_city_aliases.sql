-- Alias de villes Digylog (référentiel villes/codes stocké dans delivery_rates)

CREATE TABLE IF NOT EXISTS public.digylog_city_aliases (
  alias text PRIMARY KEY,
  canonical_city_name text NOT NULL,
  city_key text,
  learned_from_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  learned_at timestamptz DEFAULT now(),
  last_used_at timestamptz DEFAULT now(),
  usage_count integer DEFAULT 1,
  source text DEFAULT 'manual' CHECK (source = ANY (ARRAY['manual'::text, 'ai_learned'::text, 'common_alias'::text])),
  confidence_score numeric DEFAULT 1.0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.digylog_city_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS digylog_city_aliases_select_authenticated ON public.digylog_city_aliases;
CREATE POLICY digylog_city_aliases_select_authenticated
ON public.digylog_city_aliases
FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS digylog_city_aliases_service_role_all ON public.digylog_city_aliases;
CREATE POLICY digylog_city_aliases_service_role_all
ON public.digylog_city_aliases
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');