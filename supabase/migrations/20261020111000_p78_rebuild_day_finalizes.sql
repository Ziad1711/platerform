-- P7.8 — la publication normale finalise les métadonnées de couverture.
--
-- Seul ajout par rapport à la version P7.1 : appel de
-- dashboard_kpi_finalize_store_state après la publication, dans la même
-- transaction. Les compteurs de publication (publish_counter,
-- last_event_seq, last_rebuild_at) restent ceux calculés ici, jamais réécrits
-- par la finalisation.
--
-- Aucune autre règle n'est modifiée : verrou de partition, acquittement
-- nominatif, agrégation et gestion d'erreur sont inchangés.

create or replace function public.dashboard_kpi_rebuild_day(
  p_store_id uuid,
  p_date date,
  p_token uuid,
  p_seqs bigint[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_version int;
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_currency text;
  v_lock_key bigint;
  v_expected int := coalesce(array_length(p_seqs, 1), 0);
  v_acked int;
  v_owned int;
  v_pending int;
begin
  if v_expected = 0 then raise exception 'KPI_EMPTY_CLAIM'; end if;

  -- Le verrou a été pris par dashboard_kpi_claim dans la MÊME transaction.
  -- V4 : clé de verrou en BIGINT (hashtextextended renvoie bigint ; la V3
  -- stockait ce résultat dans un `int`, ce qui pouvait échouer au dépassement).
  v_lock_key := hashtextextended(p_store_id::text || '|' || p_date::text, 0);
  if not pg_try_advisory_xact_lock(v_lock_key) then
    raise exception 'KPI_PARTITION_NOT_LOCKED';
  end if;

  -- P7.8 : verrou de boutique pris AVANT toute écriture de
  -- dashboard_kpi_store_state. Ordre global garanti :
  --   verrou de partition -> verrou de boutique -> ligne d'état.
  -- Sans cela, un appel direct à la finalisation (boutique puis ligne)
  -- pourrait s'interbloquer avec une publication (ligne puis boutique).
  -- La fonction de finalisation reprend le même verrou : réentrant.
  perform pg_advisory_xact_lock(hashtextextended(p_store_id::text || '|finalize', 0));


  v_tz := public.dashboard_kpi_store_tz(p_store_id);
  v_start := (p_date::timestamp at time zone v_tz);
  v_end := ((p_date + 1)::timestamp at time zone v_tz);
  select s.currency into v_currency from public.stores s where s.id = p_store_id;
  select coalesce((select st.active_definition_version from public.dashboard_kpi_store_state st
                    where st.store_id = p_store_id), 1) into v_version;

  -- Les événements capturés doivent tous être encore NON traités (aucun autre
  -- worker ne peut les avoir pris : verrou exclusif de partition).
  select count(*) into v_owned
    from public.dashboard_kpi_invalidation i
   where i.store_id = p_store_id and i.business_date = p_date
     and i.processed_at is null and i.seq = any(p_seqs);
  if v_owned <> v_expected then raise exception 'KPI_LEASE_LOST'; end if;

  perform public.dashboard_kpi_aggregate_order(p_store_id, p_date, v_version, v_start, v_end, v_tz, v_currency, (select max(s) from unnest(p_seqs) s));
  perform public.dashboard_kpi_aggregate_delivery(p_store_id, p_date, v_version, v_start, v_end, v_tz, v_currency, (select max(s) from unnest(p_seqs) s));

  -- Acquittement NOMMATIF. La trace (claimed_by / claimed_at / claim_token)
  -- est CONSERVÉE pour l'observation (M08).
  update public.dashboard_kpi_invalidation i
     set processed_at = clock_timestamp(), last_error = null
   where i.store_id = p_store_id and i.business_date = p_date
     and i.processed_at is null and i.seq = any(p_seqs) and i.claim_token = p_token;
  get diagnostics v_acked = row_count;
  if v_acked <> v_expected then raise exception 'KPI_ACK_MISMATCH'; end if;

  select count(distinct (i.store_id, i.business_date))::int into v_pending
    from public.dashboard_kpi_invalidation i
   where i.store_id = p_store_id and i.processed_at is null;

  -- Publication : compteur MONOTONE incrémenté à chaque publication utile (C04)
  insert into public.dashboard_kpi_store_state as st
    (store_id, publish_counter, last_event_seq, last_rebuild_at, pending_partitions, last_error)
  values (p_store_id, 1, (select max(s) from unnest(p_seqs) s), clock_timestamp(), v_pending, null)
  on conflict (store_id) do update
    set publish_counter = st.publish_counter + 1,
        last_event_seq  = greatest(st.last_event_seq, excluded.last_event_seq),
        last_rebuild_at = clock_timestamp(),
        pending_partitions = v_pending,
        last_error = null,
        updated_at = clock_timestamp();

  -- P7.8 : métadonnées dérivées (couverture, jours calculés/sales, état).
  -- N'écrit jamais publish_counter, last_event_seq ni last_rebuild_at.
  perform public.dashboard_kpi_finalize_store_state(p_store_id);
end;
$function$;

revoke all on function public.dashboard_kpi_rebuild_day(uuid, date, uuid, bigint[])
  from public, anon, authenticated;
grant execute on function public.dashboard_kpi_rebuild_day(uuid, date, uuid, bigint[])
  to service_role;
