begin;

-- Un changement de source (organic -> ads) doit recalculer la repartition publicitaire du jour.
create or replace function public.trigger_allocate_ads_from_orders()
returns trigger
language plpgsql
as $function$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then
      return old;
    else
      return new;
    end if;
  end if;

  if tg_op = 'DELETE' then
    perform public.allocate_ads_cost_for_day(old.store_id, old.order_date::date);
    return old;

  elsif tg_op = 'INSERT' then
    perform public.allocate_ads_cost_for_day(new.store_id, new.order_date::date);
    return new;

  else
    if (new.store_id is distinct from old.store_id)
       or (new.order_date::date is distinct from old.order_date::date) then
      perform public.allocate_ads_cost_for_day(old.store_id, old.order_date::date);
      perform public.allocate_ads_cost_for_day(new.store_id, new.order_date::date);
      return new;
    end if;

    if (new.status is distinct from old.status) then
      perform public.allocate_ads_cost_for_day(new.store_id, new.order_date::date);
      return new;
    end if;

    if (new.source is distinct from old.source) then
      perform public.allocate_ads_cost_for_day(new.store_id, new.order_date::date);
      return new;
    end if;

    return new;
  end if;
end;
$function$;

commit;
