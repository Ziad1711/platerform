-- B13 — marque la commande avant les triggers métier.
-- Le drapeau est posé avant les AFTER métier qui mettent la commande à jour
-- (allocation publicitaire, automatisations). Ces updates ne réinvalident donc
-- pas une journée déjà invalidée par l'INSERT statement.

create or replace function public.dashboard_kpi_mark_order_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  perform set_config(
    'app.kpi_inv_order_' || replace(new.id::text, '-', '_'), '1', true);
  return new;
end;
$function$;

revoke all on function public.dashboard_kpi_mark_order_insert() from public, anon, authenticated;

drop trigger if exists trg_kpi_mark_order_insert on public.orders;
create trigger trg_kpi_mark_order_insert
  before insert on public.orders
  for each row execute function public.dashboard_kpi_mark_order_insert();
