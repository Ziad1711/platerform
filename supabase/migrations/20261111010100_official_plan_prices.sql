-- Données officielles. Aucun prix dans les composants ou l'API.
-- N'altère ni plans.price, ni les abonnements historiques.
begin;
set local lock_timeout='5s';
do $$ begin
  if (select count(*) from public.plans where code in ('free','pro','ultimate'))<>3 then
    raise exception 'REQUIRED_PLANS_MISSING: provision synthetic Q4 fixtures separately';
  end if;
end $$;
insert into public.plan_prices(plan_id,billing_period,duration_months,amount_minor,currency,version)
select p.id,t.period,t.months,t.amount,'MAD',1 from (values
  ('free','monthly',1,0::bigint),('free','yearly',12,0::bigint),
  ('pro','monthly',1,39000::bigint),('pro','yearly',12,360000::bigint),
  ('ultimate','monthly',1,69000::bigint),('ultimate','yearly',12,720000::bigint)
) t(code,period,months,amount) join public.plans p on p.code=t.code;
commit;