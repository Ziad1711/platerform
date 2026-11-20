import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/access.server'
import { acquisitionConfig, acquisitionPath } from '@/lib/acquisition/meta.server'

type Row = { id: string | null; name: string | null; spend: number | null; spend_mad: number | null; impressions: number | null; clicks: number | null; signups: number; paid: number; delay_days: number | null }
type Rate = { day: string; rate: string; updated_at: string }
type Report = {
  account: { id: string; name: string; currency: string; tz: string; status: string; expires_at: string; last_ok: string | null; next_run: string | null; error: string | null; tasks: string[] } | null
  from: string; until: string; days: number; coverage: number; row_count: number; rows: Row[]
  daily: { day: string; usd: number | null; mad: number | null; rate_day: string | null; rate: string | null }[]
  summary: { spend: number; spend_mad: number | null; impressions: number; clicks: number; signups: number; attributed: number; paid: number; attributed_paid: number; paid_in_period: number; revenue_mad: number; non_mad_receipts: number; delay_days: number | null }
}
const box = 'rounded-2xl border border-white/15 bg-white/[0.03] p-4 sm:p-6'
const control = 'min-h-11 rounded-xl border border-white/20 bg-jisra-ink px-3 focus-visible:outline focus-visible:outline-jisra-green'
const number = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
const stamp = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
const show = (value: number | null, suffix = '') => value == null ? '—' : `${number.format(value)}${suffix}`
const notices: Record<string, string> = {
  connected: 'Compte vérifié. La synchronisation initiale est en attente du planificateur.',
  invalid: 'La session de connexion a expiré ou ne correspond pas. Relancez la connexion après vérification TOTP.',
  denied: 'Autorisation Meta annulée ou refusée.',
  permission: 'Meta n’autorise pas la lecture de ce compte. Vérifiez ads_read et vos droits sur le compte Jisra.',
  failed: 'Connexion Meta non finalisée. Vérifiez la configuration de l’application Meta puis réessayez.',
}
const statuses: Record<string, string> = { pending: 'En attente', running: 'En cours', ok: 'Dernier lot réussi', retry: 'Nouvelle tentative programmée', reconnect: 'Reconnexion requise' }

export default async function AcquisitionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams
  const days = query.days === '7' ? 7 : query.days === '90' ? 90 : 30
  const level = query.level === 'adset' || query.level === 'ad' ? query.level : 'campaign'
  const touch = query.touch === 'last' ? 'last' : 'first'
  const end = typeof query.end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.end) &&
    Number.isFinite(Date.parse(query.end)) && new Date(query.end).toISOString().slice(0, 10) === query.end && query.end >= '2000-01-01' ? query.end : null
  const page = typeof query.page === 'string' && /^\d{1,4}$/.test(query.page) ? Math.min(2000, Math.max(1, Number(query.page))) : 1
  let auth
  try { auth = await requireAdmin('acquisition.manage') }
  catch { return <p role="alert" className={box}>Accès réservé au propriétaire de la plateforme avec vérification TOTP récente.</p> }
  const before = typeof query.ratesBefore === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(query.ratesBefore) ? query.ratesBefore : null
  const [{ data, error }, { data: rates }] = await Promise.all([
    auth.supabase.rpc('rpc_admin_acquisition_report', { p_days: days, p_level: level, p_touch: touch, p_offset: (page - 1) * 50, p_end: end }),
    auth.supabase.rpc('rpc_admin_acquisition_fx', { p_before: before }),
  ])
  if (error || !data) return <div role="alert" className={box}>{error?.message === 'ADMIN_INVALID' ? 'Choisissez une date de fin déjà close dans le fuseau du compte.' : 'Les données d’acquisition sont temporairement indisponibles.'} <Link href={acquisitionPath} className="underline">Réinitialiser les filtres</Link></div>
  const { account, from, until, coverage, summary: s, rows, row_count, daily } = data as Report
  const fx = rates as { current: Rate | null; history: Rate[] } | null
  const active = Boolean(acquisitionConfig())
  const complete = coverage === days
  const money = (value: number | null) => value == null || !account ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: account.currency }).format(value)
  const mad = (value: number | null) => value == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD' }).format(value)
  const conversion = (value: number | null) => value == null ? 'Conversion indisponible' : mad(value)
  const ratio = (spend: number | null, count: number, format = money) => complete && spend != null && count > 0 ? format(spend / count) : '—'
  const both = (spend: number | null, spendMad: number | null, count: number) => `${ratio(spend, count)} / ${ratio(spendMad, count, mad)}`
  const metrics = [
    [`Dépenses Meta (${account?.currency ?? 'USD'})`, money(coverage ? s.spend : null)], ['Dépenses Meta (MAD)', coverage ? conversion(s.spend_mad) : '—'],
    ['Impressions', show(coverage ? s.impressions : null)], ['Clics', show(coverage ? s.clicks : null)],
    ['CPC', both(s.spend, s.spend_mad, s.clicks)], ['CPM', both(s.spend, s.spend_mad, s.impressions / 1000)],
    ['Comptes gratuits à l’inscription', show(s.signups)], ['Inscriptions attribuées', show(s.attributed)],
    ['Premiers clients payants', show(s.paid)], ['Dont attribués', show(s.attributed_paid)], ['Sans premier paiement', show(s.signups - s.paid)],
    ['Conversion de la cohorte attribuée', show(s.attributed ? s.attributed_paid / s.attributed * 100 : null, ' %')],
    ['Premiers paiements attribués reçus dans la période', show(s.paid_in_period)],
    ['Recettes MAD des premiers paiements attribués dans la période', mad(s.revenue_mad)],
    ['Coût par inscription attribuée', both(s.spend, s.spend_mad, s.attributed)], ['CAC de la cohorte attribuée', both(s.spend, s.spend_mad, s.attributed_paid)],
    ['Délai moyen avant paiement', show(s.delay_days, ' j')],
  ]
  const pagination = (target: number) => `${acquisitionPath}?${new URLSearchParams({ days: String(days), level, touch, page: String(target), ...(end ? { end } : {}) })}`
  const notice = typeof query.oauth === 'string' && Object.hasOwn(notices, query.oauth) ? notices[query.oauth] : null
  return <div className="space-y-6">
    <header><p className="text-sm text-jisra-green-light">Marketing</p><h1 className="text-3xl font-bold">Acquisition Meta Ads</h1>
      <p className="mt-2 text-jisra-cream/70">Dépenses Meta et conversions vérifiées par Jisra. Les résultats ne sont pas les conversions de Meta Ads Manager.</p></header>
    <section className={box} aria-labelledby="meta-account"><div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><h2 id="meta-account" className="text-lg font-semibold">Compte publicitaire Jisra</h2>
        <p className="break-words">{account ? `${account.name} · ${account.id} · ${account.currency} · ${account.tz}` : 'Aucun compte connecté'}</p>
        {account && <p className="text-sm text-jisra-cream/75">{statuses[account.status] ?? account.status}{account.error ? ` (${account.error})` : ''} · Dernier succès : {account.last_ok ? `${stamp.format(new Date(account.last_ok))} UTC` : '—'} · Expiration : {stamp.format(new Date(account.expires_at))} UTC</p>}
        {account && <p className="text-sm text-jisra-cream/75">Tâches Meta : {account.tasks.join(', ') || 'non communiquées'} · lecture Insights vérifiée à la connexion.</p>}
        {account?.next_run && <p className="text-sm text-jisra-cream/75">Prochain lot éligible : {stamp.format(new Date(account.next_run))} UTC (au prochain passage du planificateur).</p>}
      </div>
      <form method="post" action="/api/admin/acquisition/connect"><button type="submit" disabled={!active} className={`${control} bg-jisra-green/15 font-semibold disabled:opacity-50`}>{account ? 'Reconnecter le compte Meta Ads' : 'Connecter mon compte Meta Ads'}</button></form>
    </div>{!active && <p className="mt-3 text-sm">OAuth Meta indisponible dans cet environnement ou configuration incomplète.</p>}
      {notice && !(query.oauth === 'connected' && account?.last_ok) && <p role="status" className="mt-3 text-sm text-jisra-green-light">{notice}</p>}
    </section>
    <section className={`${box} space-y-3`} aria-labelledby="fx-title">
      <h2 id="fx-title" className="text-lg font-semibold">Taux USD → MAD</h2>
      <p>{fx?.current ? `1 USD = ${fx.current.rate} MAD depuis le ${fx.current.day} · Manuel · Modifié le ${stamp.format(new Date(fx.current.updated_at))} UTC` : fx ? 'Aucun taux applicable aujourd’hui.' : 'Historique indisponible.'}</p>
      <p className="text-sm text-jisra-cream/75">Chaque jour utilise le dernier taux applicable à sa date. Corriger un taux recalcule les montants MAD jusqu’au taux suivant, sans modifier les dépenses USD.</p>
      <form method="post" action="/api/admin/acquisition/rates" className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-sm">Date d’effet<input type="date" name="day" required min="2000-01-01" max="2099-12-31" className={control} /></label>
        <label className="grid gap-1 text-sm">MAD pour 1 USD<input name="rate" required inputMode="decimal" maxLength={12} placeholder="Ex. 10,50" className={control} /></label>
        <button type="submit" className={control}>Enregistrer ou corriger le taux</button>
      </form>
      {query.fx === 'saved' && <p role="status">Taux enregistré.</p>}
      {query.fx === 'invalid' && <p role="alert">Date ou taux invalide. Saisissez un taux positif inférieur à 1 000 (8 décimales maximum).</p>}
      {query.fx === 'unavailable' && <p role="alert">Impossible d’enregistrer le taux pour le moment.</p>}
      <details open={Boolean(before)}><summary>Historique des taux manuels</summary>
        {fx?.history.length ? <ul className="my-2 space-y-1 text-sm">{fx.history.slice(0, 30).map(r => <li key={r.day}>{r.day} — {r.rate} MAD pour 1 USD · Modifié le {stamp.format(new Date(r.updated_at))} UTC</li>)}</ul> : <p>Aucun taux sur cette page.</p>}
        {fx && fx.history.length > 30 && <Link className="underline" href={`${acquisitionPath}?ratesBefore=${fx.history[29].day}`}>Taux plus anciens</Link>}
        {before && <Link className="ml-3 underline" href={acquisitionPath}>Taux récents</Link>}
      </details>
    </section>
    <form className={`${box} flex flex-wrap items-end gap-4`} action={acquisitionPath} method="get">
      <label className="grid gap-1 text-sm">Période<select name="days" defaultValue={days} className={control}>{[7, 30, 90].map(d => <option key={d} value={d}>{d} jours clos</option>)}</select></label>
      <label className="grid gap-1 text-sm">Date de fin (facultative)<input type="date" name="end" min="2000-01-01" defaultValue={end ?? ''} className={control} /></label>
      <label className="grid gap-1 text-sm">Ventilation<select name="level" defaultValue={level} className={control}><option value="campaign">Campagnes</option><option value="adset">Ensembles</option><option value="ad">Publicités</option></select></label>
      <label className="grid gap-1 text-sm">Attribution<select name="touch" defaultValue={touch} className={control}><option value="first">Premier contact Meta</option><option value="last">Dernier contact Meta</option></select></label>
      <button type="submit" className={control}>Appliquer</button>
    </form>
    <p role="status" className="text-sm text-jisra-cream/75">Du {from} au {until} ({account?.tz ?? 'UTC'}). Couverture Meta : {coverage}/{days} jours. {complete ? '' : 'Les chiffres Meta disponibles sont partiels ; les coûts unitaires sont masqués.'} La cohorte est définie par la date d’inscription ; un paiement ultérieur peut l’enrichir.</p>
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <div className={box} key={label}><dt className="text-sm text-jisra-cream/75">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd></div>)}</dl>
    {s.non_mad_receipts > 0 && <p className="text-sm">{s.non_mad_receipts} premier(s) paiement(s) hors MAD exclu(s) des recettes MAD.</p>}
    {coverage > 0 && s.spend === 0 && <p role="status">Aucune dépense Meta sur les jours synchronisés de cette période.</p>}
    {account?.currency === 'USD' && <details className={box}><summary>Dépenses et taux par jour</summary>
      <div className="overflow-x-auto"><table className="mt-3 w-full min-w-[480px] text-left text-sm"><thead><tr>{['Jour Meta', 'USD', 'MAD', 'Taux appliqué'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{daily.map(d => <tr key={d.day} className="border-t border-white/15"><th scope="row">{d.day}</th><td>{d.usd == null ? 'Non synchronisé' : money(d.usd)}</td><td>{d.usd == null ? '—' : conversion(d.mad)}</td><td>{d.rate_day ? `${d.rate} (depuis le ${d.rate_day})` : 'Aucun taux'}</td></tr>)}</tbody>
      </table></div>
    </details>}
    <section className={box} aria-labelledby="breakdown"><h2 id="breakdown" className="text-lg font-semibold">Performances détaillées</h2>
      <p className="my-2 text-sm text-jisra-cream/75">« Non attribué » indique l’absence d’un identifiant vérifié au niveau affiché.</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tableau des performances publicitaires">
        <table className="min-w-[880px] w-full text-left"><thead><tr>{['Objet Meta', 'Dépenses originales', 'Dépenses MAD', 'Impressions', 'Clics', 'Inscriptions', 'Payants', 'Coût / inscription', 'CAC', 'Délai moyen'].map(label => <th scope="col" key={label} className="p-2 text-sm">{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.id ?? 'unknown'} className="border-t border-white/15"><th scope="row" className="p-2 font-medium">{row.name ?? 'Non attribué'}{row.id && <span className="block text-xs text-jisra-cream/70">{row.id}</span>}</th>
            {[money(coverage ? row.spend : null), coverage && row.id ? conversion(row.spend_mad) : '—', show(coverage ? row.impressions : null), show(coverage ? row.clicks : null), show(row.signups), show(row.paid), both(row.spend, row.spend_mad, row.signups), both(row.spend, row.spend_mad, row.paid), show(row.delay_days, ' j')].map((value, i) => <td key={i} className="p-2 tabular-nums">{value}</td>)}</tr>)}</tbody></table>
      </div>{!rows.length && <p className="mt-4">Aucune donnée sur cette page.</p>}
      <div className="mt-4 flex flex-wrap gap-3">{page > 1 && <Link className="underline" href={pagination(page - 1)}>Page précédente</Link>}{page * 50 < row_count && <Link className="underline" href={pagination(page + 1)}>Page suivante</Link>}</div>
    </section>
  </div>
}