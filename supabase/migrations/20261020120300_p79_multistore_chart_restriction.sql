-- P7.9 / P0-4 — restriction de la surcharge multiboutiques du graphique CA/profit.
--
-- Surcharge concernée : `rpc_dashboard_revenue_chart(uuid[], ...)` et son
-- implémentation `_rbl4_impl_dashboard_revenue_chart(uuid[], ...)`.
--
-- Diagnostic (inchangé, non corrigé ici) : cette surcharge ne respecte pas le
-- contrat C1-A corrigé en P7.7 :
--   * publicité allouée à toutes les commandes, sans arbitrage « jour suivi » ;
--   * coût des lignes dans le profit, sans appliquer uniformément le coût
--     manuel (`order_purchase_cost`) ;
--   * `buy_price` agrégé dans une autre composante ;
--   * borne de fin inclusive.
--
-- Consommateurs vérifiés au 20/10/2026 :
--   * `components/dashboard/revenue-chart.tsx` appelle la signature boutique
--     unique (`p_store_id`) en boucle sur les boutiques accessibles : elle ne
--     dépend pas de cette surcharge ;
--   * aucun autre objet SQL, aucune RPC, aucun service, aucun hook ne l'appelle ;
--   * `rpc_dashboard_profit_chart` n'a pas de variante `uuid[]`.
--
-- Décision : la surcharge n'est pas retirée (preuve d'usage serveur non
-- établie), mais son accès client est fermé. Elle reste disponible au
-- service_role et aux appels internes sans JWT. Une correction complète
-- (consolidation par boutique, puis devise et niveau d'accès) reste requise
-- avant tout usage officiel multiboutiques.
--
-- Non modifié ici : `rpc_dashboard_kpi_metrics(uuid[])` et
-- `rpc_dashboard_top_products(uuid[])`, qui présentent des écarts comparables
-- mais sortent du périmètre de ce lot (voir rapport P7.9).

create or replace function public.rpc_dashboard_revenue_chart(
  p_store_ids uuid[],
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_granularity text default 'day',
  p_conversion_start timestamptz default null,
  p_conversion_end timestamptz default null
)
returns table(
  date_key text, revenue numeric, profit numeric, ads_cost numeric,
  purchase_cost numeric, delivery_fee numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_full boolean;
  v_role text := coalesce(auth.role(), '');
begin
  -- Fermeture d'accès : un appel porteur d'un JWT utilisateur est refusé même
  -- si un GRANT est réintroduit par erreur. Les appels internes sans JWT
  -- ('' ) et le service_role restent autorisés.
  if v_role in ('authenticated', 'anon') then
    raise exception 'KPI_MULTISTORE_SURCHARGE_DISABLED';
  end if;

  select array_agg(id order by id), bool_and(public.dashboard_legacy_access(id) = 'full')
    into v_ids, v_full
  from (select distinct unnest(p_store_ids) id) requested
  where public.dashboard_legacy_access(id) is not null;
  if coalesce(cardinality(v_ids), 0) <> coalesce((select count(distinct id) from unnest(p_store_ids) id), 0)
     or coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'DASHBOARD_NO_ACCESS';
  end if;
  return query
  select x.date_key, x.revenue,
         case when v_full then x.profit else null::numeric end,
         x.ads_cost,
         case when v_full then x.purchase_cost else null::numeric end,
         case when v_full then x.delivery_fee else null::numeric end
  from public._rbl4_impl_dashboard_revenue_chart(
    v_ids, p_start_date, p_end_date, p_granularity,
    p_conversion_start, p_conversion_end
  ) x;
end;
$$;

revoke all on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  to service_role;

revoke all on function public._rbl4_impl_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public._rbl4_impl_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz)
  to service_role;

comment on function public.rpc_dashboard_revenue_chart(uuid[], timestamptz, timestamptz, text, timestamptz, timestamptz) is
  'P7.9 : surcharge multiboutiques NON conforme au contrat C1-A. Accès client fermé (service_role uniquement) jusqu''à correction complète.';
