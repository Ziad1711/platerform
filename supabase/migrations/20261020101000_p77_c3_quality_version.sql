-- P7.7 / C3-A (1/4) : version de qualité et état de compatibilité.
--
-- Contexte : la réconciliation « lignes vs total » comparait le revenu des lignes
-- au total encaissé, qui inclut les frais de livraison facturés au client, les
-- remises et l'arrondi. Toutes les commandes livrées étaient donc marquées à tort.
--
-- Ce lot introduit une version de qualité explicite :
--   quality_version = 1 : partitions calculées avec l'ancienne réconciliation (historique) ;
--   quality_version = 2 : partitions recalculées avec la réconciliation corrigée.
--
-- Les montants financiers ne changent pas. Seuls les indicateurs de qualité
-- (line_vs_total_mismatch, data_issues_count) sont concernés.
--
-- IMPORTANT : les partitions existantes restent en version 1 jusqu'à une
-- reconstruction ciblée autorisée. Aucun backfill n'est exécuté par cette migration.
--
-- Impact vérification P7.1 : `dashboard_daily_metrics` passe de 33 à 34 colonnes.
-- Le script 90_verify.sql du paquet P7.1 (pré-P7.7) doit être exécuté avant ce lot,
-- ou avec l'attendu de colonnes mis à jour explicitement. Le paquet historique
-- n'est pas modifié.

alter table public.dashboard_daily_metrics
  add column if not exists quality_version smallint not null default 1;

comment on column public.dashboard_daily_metrics.quality_version is
  'Version du contrôle qualité : 1 = réconciliation historique (lignes vs total encaissé), 2 = réconciliation corrigée (sous-total et total reconstitué).';

create or replace function public.rpc_dashboard_kpi_quality_status(
  p_store_ids uuid[],
  p_from date,
  p_to date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with requested as (
    select distinct unnest(p_store_ids) as store_id
  ),
  scoped as (
    select m.store_id, m.business_date, m.axis, m.quality_version,
           m.line_vs_total_mismatch, m.data_issues_count, m.orders_without_lines
      from public.dashboard_daily_metrics m
      join requested r on r.store_id = m.store_id
     where m.business_date >= p_from
       and m.business_date < p_to
       and exists (
         select 1
           from public.store_members sm
          where sm.store_id = m.store_id
            and sm.user_id = auth.uid()
            and sm.status = 'active'
       )
  )
  select jsonb_build_object(
    'days_total',        (select count(distinct (store_id, business_date)) from scoped),
    'days_quality_v1',   (select count(distinct (store_id, business_date))
                            from scoped where quality_version < 2),
    'days_quality_v2',   (select count(distinct (store_id, business_date))
                            from scoped where quality_version >= 2),
    'mismatch_orders',   coalesce((select sum(line_vs_total_mismatch)
                                     from scoped where axis = 'order'), 0),
    'data_issues_orders', coalesce((select sum(data_issues_count)
                                      from scoped where axis = 'order'), 0),
    'orders_without_lines', coalesce((select sum(orders_without_lines)
                                        from scoped where axis = 'order'), 0)
  );
$function$;

revoke all on function public.rpc_dashboard_kpi_quality_status(uuid[], date, date)
  from public, anon;
grant execute on function public.rpc_dashboard_kpi_quality_status(uuid[], date, date)
  to authenticated, service_role;
