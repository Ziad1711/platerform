begin;

-- L'apprentissage des alias de villes doit survivre à la suppression d'une vente :
-- learned_from_order_id devient NULL et l'alias reste utilisable.
do $$
declare
  v_table text;
  v_constraint text;
  v_delete_rule text;
  v_tables text[] := array[
    'rapid_delivery_city_aliases',
    'ozone_delivery_city_aliases',
    'forcelog_city_aliases',
    'ameex_city_aliases',
    'digylog_city_aliases',
    'maroc_go_delivery_city_aliases'
  ];
begin
  foreach v_table in array v_tables loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name = 'learned_from_order_id'
    ) then
      continue;
    end if;

    select c.conname, c.confdeltype::text
    into v_constraint, v_delete_rule
    from pg_constraint c
    where c.conrelid = format('public.%I', v_table)::regclass
      and c.contype = 'f'
      and pg_get_constraintdef(c.oid) ilike '%learned_from_order_id%'
    limit 1;

    if v_constraint is null then
      continue;
    end if;

    if v_delete_rule <> 'n' then
      execute format('alter table public.%I drop constraint %I', v_table, v_constraint);
      execute format(
        'alter table public.%I add constraint %I foreign key (learned_from_order_id) references public.orders(id) on delete set null',
        v_table,
        v_constraint
      );
    end if;
  end loop;
end
$$;

commit;
