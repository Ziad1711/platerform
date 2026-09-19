begin;

-- Le trigger legacy repartissait les depenses sur toutes les ventes livrees (au prorata du CA),
-- alors que la regle metier est : uniquement les ventes source = 'ads', a parts egales.
-- On aligne donc le trigger legacy sur la fonction canonique.
create or replace function public.trigger_allocate_ad_spend()
returns trigger
language plpgsql
as $$
begin
  perform public.allocate_ads_cost_for_day(new.store_id, new.spend_date::date);
  return new;
end;
$$;

commit;
