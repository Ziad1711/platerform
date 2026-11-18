import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/access.server'
import { acquisitionConfig, acquisitionPath } from '@/lib/acquisition/meta.server'

type Row = { id: string | null; name: string | null; spend: number | null; impressions: number | null; clicks: number | null; signups: number; paid: number; delay_days: number | null }
type Report = {
  account: { id: string; name: string; currency: string; tz: string; status: string; expires_at: string; last_ok: string | null; error: string | null; tasks: string[] } | null
  from: string; until: string; days: number; coverage: number; row_count: number; rows: Row[]
  summary: { spend: number; impressions: number; clicks: number; signups: number; attributed: number; paid: number; attributed_paid: number; delay_days: number | null }
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
  const { data, error } = await auth.supabase.rpc('rpc_admin_acquisition_report', { p_days: days, p_level: level, p_touch: touch, p_offset: (page - 1) * 50, p_end: end })
  if (error || !data) return <div role="alert" className={box}>{error?.message === 'ADMIN_INVALID' ? 'Choisissez une date de fin déjà close dans le fuseau du compte.' : 'Les données d’acquisition sont temporairement indisponibles.'} <Link href={acquisitionPath} className="underline">Réinitialiser les filtres</Link></div>
  const { account, from, until, coverage, summary: s, rows, row_count } = data as Report
  const active = Boolean(acquisitionConfig())
  const complete = coverage === days
  const money = (value: number | null) => value == null || !account ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: account.currency }).format(value)
  const ratio = (spend: number | null, count: number) => complete && spend != null && count > 0 ? money(spend / count) : '—'
  const metrics = [
    ['Dépenses Meta', money(coverage ? s.spend : null)], ['Impressions', show(coverage ? s.impressions : null)], ['Clics', show(coverage ? s.clicks : null)],
    ['Comptes gratuits à l’inscription', show(s.signups)], ['Inscriptions attribuées', show(s.attributed)],
    ['Premiers clients payants', show(s.paid)], ['Dont attribués', show(s.attributed_paid)], ['Sans premier paiement', show(s.signups - s.paid)],
    ['Inscription → premier paiement', show(s.signups ? s.paid / s.signups * 100 : null, ' %')],
    ['Coût par inscription attribuée', ratio(s.spend, s.attributed)], ['CAC attribué', ratio(s.spend, s.attributed_paid)],
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
      </div>
      <form method="post" action="/api/admin/acquisition/connect"><button type="submit" disabled={!active} className={`${control} bg-jisra-green/15 font-semibold disabled:opacity-50`}>{account ? 'Reconnecter le compte Meta Ads' : 'Connecter mon compte Meta Ads'}</button></form>
    </div>{!active && <p className="mt-3 text-sm">OAuth Meta indisponible dans cet environnement ou configuration incomplète.</p>}
      {notice && <p role="status" className="mt-3 text-sm text-jisra-green-light">{notice}</p>}
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
    <section className={box} aria-labelledby="breakdown"><h2 id="breakdown" className="text-lg font-semibold">Performances détaillées</h2>
      <p className="my-2 text-sm text-jisra-cream/75">« Non attribué » indique l’absence d’un identifiant vérifié au niveau affiché.</p>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tableau des performances publicitaires">
        <table className="w-full min-w-[880px] text-left text-sm"><thead><tr>{['Objet Meta', 'Dépenses', 'Impressions', 'Clics', 'Inscriptions', 'Payants', 'Coût / inscription', 'CAC', 'Délai moyen'].map(label => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.id ?? 'unknown'} className="border-t border-white/15"><th scope="row" className="p-2 font-medium">{row.name ?? 'Non attribué'}{row.id && <span className="block text-xs text-jisra-cream/70">{row.id}</span>}</th>
            {[money(row.spend), show(row.impressions), show(row.clicks), show(row.signups), show(row.paid), ratio(row.spend, row.signups), ratio(row.spend, row.paid), show(row.delay_days, ' j')].map((value, i) => <td key={i} className="p-2 tabular-nums">{value}</td>)}</tr>)}</tbody></table>
      </div>{!rows.length && <p className="mt-4">Aucune donnée sur cette page.</p>}
      <div className="mt-4 flex flex-wrap gap-3">{page > 1 && <Link className="underline" href={pagination(page - 1)}>Page précédente</Link>}{page * 50 < row_count && <Link className="underline" href={pagination(page + 1)}>Page suivante</Link>}</div>
    </section>
  </div>
}