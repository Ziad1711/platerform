-- Dashboard KPI V5 — sous-lot B1.
-- Lecture minimale des révisions (compteur de publication) pour le polling.
-- Contrat strictement aligné sur rpc_dashboard_kpi_reader :
--   * identité imposée par auth.uid() ;
--   * périmètre filtré par public.dashboard_kpi_access_level() <> 'none' ;
--   * NULL = toutes les boutiques autorisées ;
--   * révision = coalesce(publish_counter, 0)::text (aucun arrondi) ;
--   * aucun agrégat, aucun montant, aucune écriture.
-- Additive uniquement : aucune table, RLS, trigger ni fonction existante modifiée.
-- Version enregistrée en Production : 20261026233340 (nom : dashboard_kpi_revisions).
create function public.rpc_dashboard_kpi_revisions(
  p_store_ids uuid[] default null::uuid[]
)
returns table (
  store_id uuid,
  publish_counter text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'KPI_UNAUTHENTICATED';
  end if;

  return query
    select s.id,
           coalesce(st.publish_counter, 0::bigint)::text
      from public.stores s
      left join public.dashboard_kpi_store_state st
        on st.store_id = s.id
     where (p_store_ids is null or s.id = any(p_store_ids))
       and public.dashboard_kpi_access_level(s.id) <> 'none'
     order by s.id;

  if not found then
    raise exception 'KPI_NO_ACCESS';
  end if;
end;
$function$;

revoke all on function public.rpc_dashboard_kpi_revisions(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.rpc_dashboard_kpi_revisions(uuid[])
  to authenticated, service_role;
