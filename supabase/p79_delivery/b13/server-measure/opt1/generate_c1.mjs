// Genere c1-optimized.sql depuis la migration C0 versionnee.
// CRLF normalise AVANT analyse ; remplacement borne a la branche `orders`.
import fs from 'node:fs'
const SRC = 'supabase/migrations/20261018232500_b13_final_state.sql'
const OUT = 'supabase/p79_delivery/b13/server-measure/opt1/c1-optimized.sql'
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')
const a0 = src.indexOf('create or replace function public.dashboard_kpi_invalidate_insert_stmt')
const b0 = src.indexOf('create or replace function public.dashboard_kpi_mark_order_insert')
if (a0 < 0 || b0 < 0 || b0 < a0) throw new Error('FUNC_MARKERS_MISSING')
const block = src.slice(a0, b0)
const a = block.indexOf('insert into public.dashboard_kpi_invalidation')
const b = block.indexOf("  elsif tg_table_name = 'order_items'")
if (a < 0 || b < 0 || b < a) throw new Error('BRANCH_MARKERS_MISSING')
const seg = block.slice(a, b)
if ((seg.match(/union all/g) || []).length !== 1 || (seg.match(/orders:INSERT:stmt/g) || []).length !== 2) {
  throw new Error('NOT_ORDERS_BRANCH')
}
const opt = [
  'insert into public.dashboard_kpi_invalidation (store_id, business_date, reason, note_tx)',
  "    select o.store_id, dd.d, 'orders:INSERT:stmt', v_tx",
  '    from (',
  '      select o.store_id,',
  "             (o.order_date at time zone coalesce(st.tz, 'Africa/Casablanca'))::date as d1,",
  "             (coalesce(o.delivered_at, o.order_date) at time zone coalesce(st.tz, 'Africa/Casablanca'))::date as d2",
  '        from new_rows o',
  '        left join public.dashboard_kpi_store_state st on st.store_id = o.store_id',
  '       where o.store_id is not null',
  '    ) o',
  '    cross join lateral (values (o.d1, 1), (o.d2, 2)) as dd(d, k)',
  '    where dd.d is not null',
  '      and (dd.k = 1 or o.d2 is distinct from o.d1)',
  '    on conflict do nothing;',
  '  '
].join('\n')
const c1 = block.slice(0, a) + opt + block.slice(b) +
  '\nrevoke all on function public.dashboard_kpi_invalidate_insert_stmt() from public, anon, authenticated;\n' +
  'grant execute on function public.dashboard_kpi_invalidate_insert_stmt() to service_role;\n'
const checks = {
  differs: c1 !== block,
  order_items_reasons: (c1.match(/order_items:INSERT:stmt/g) || []).length,
  ad_spend_reasons: (c1.match(/ad_spend_daily:INSERT:stmt/g) || []).length,
  orders_reasons: (c1.match(/orders:INSERT:stmt/g) || []).length,
  secdef: c1.includes('security definer'),
  search_path: c1.includes("set search_path to 'public', 'pg_temp'"),
}
const bad = []
if (!checks.differs) bad.push('IDENTIQUE_C0')
if (checks.order_items_reasons !== 2) bad.push('ORDER_ITEMS_CHANGED')
if (checks.ad_spend_reasons !== 1) bad.push('AD_SPEND_CHANGED')
if (checks.orders_reasons !== 1) bad.push('ORDERS_REASON_COUNT')
if (!checks.secdef || !checks.search_path) bad.push('PROPERTIES_LOST')
if (bad.length) throw new Error('C1_INVALID: ' + bad.join(','))
fs.writeFileSync(OUT, c1)
console.log(JSON.stringify(checks))
