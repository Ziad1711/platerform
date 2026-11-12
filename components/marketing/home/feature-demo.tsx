'use client'

import { useEffect, useRef, useState } from 'react'
import { Calendar, Check, ChevronDown, Globe2, Hand, LayoutDashboard, MousePointer2, Pause, Play, ShoppingCart, Sparkles, Store, Truck, TrendingUp, Warehouse } from 'lucide-react'
import { JisraMark } from '@/components/logo'
import { Badge } from '@/components/ui/badge'
import styles from './feature-demo.module.css'

const scenes = [
  { title: 'Ventes & commandes', icon: ShoppingCart, caption: ['Une commande est passée sur YouCan', 'Elle arrive automatiquement dans Jisra', 'La commande est prête à être traitée'] },
  { title: 'Dashboard', icon: Store, caption: ['Choisir une boutique', 'Passer à la vue consolidée', 'Retrouver les chiffres de tous les stores'] },
  { title: 'Assistant IA', icon: Sparkles, caption: ['Poser une question business', 'Lire les indicateurs de la période', 'Retrouver une réponse chiffrée'] },
  { title: 'Livraison', icon: Truck, caption: ['Sélectionner les colis confirmés', 'Créer un bon de ramassage', 'Retrouver le bon et ses colis'] },
  { title: 'Dashboard', icon: TrendingUp, caption: ['Consulter les indicateurs marketing', 'Suivre les courbes quotidiennes CPL et CPA', 'Lire le coût par lead et par achat de chaque jour'] },
  { title: 'Stock', icon: Warehouse, caption: ['Consulter le stock par variante', 'Ajouter une entrée de stock', 'Retrouver le mouvement enregistré'] },
  { title: 'Dashboard', icon: LayoutDashboard, caption: ['Consulter les chiffres du jour', 'Choisir une période de suivi', 'Lire les ventes, les charges et le profit sur la période'] },
]

function Status({ children }: { children: React.ReactNode }) {
  return <Badge className={styles.status}>{children}</Badge>
}

// Presentational excerpts of the application, deliberately isolated from its
// authenticated providers and mutations. Every value below is fictional.
// Series and colors mirror revenue-chart.tsx and ads-cost-chart.tsx.
const businessSeries = [
  { key: 'revenue', label: 'CA', color: '#2563eb' },
  { key: 'profit', label: 'Profit', color: '#059669' },
  { key: 'ads', label: 'Pub', color: '#9333ea' },
  { key: 'purchase', label: 'Achat', color: '#ea580c' },
] as const
const marketingSeries = [
  { key: 'cpl', label: 'CPL', color: '#2563eb' },
  { key: 'cpa', label: 'CPA', color: '#16a34a' },
] as const
const demoDays = Array.from({ length: 30 }, (_, index) => {
  const orders = [40, 48, 44, 52, 42, 50, 46, 54, 48, 44, 52, 46, 50, 42, 48, 56, 50, 46, 54, 48, 52, 44, 50, 46, 54, 48, 52, 44, 50, 46][index]
  const delivered = orders / 2
  const revenue = delivered * 200
  const purchase = delivered * 70
  const cpl = [3.8, 4.2, 3.6, 4.4, 4.1, 3.7, 4.3, 3.9, 4.2, 3.8, 4.5, 4.0, 3.6, 4.1, 3.9, 4.3, 3.7, 4.2, 3.8, 4.4, 4.0, 3.6, 4.1, 3.9, 4.3, 3.7, 4.2, 3.8, 4.1, 4.0][index]
  const ads = orders * cpl
  return { date: `${String(index + 1).padStart(2, '0')}/06`, orders, delivered, revenue, purchase, ads, charges: delivered * 100, profit: revenue - delivered * 100 - ads, cpl: ads / orders, cpa: ads / delivered }
})

// Ads has its own fictional campaign: do not alter the approved Dashboard data.
const marketingDays = demoDays.map((day, index) => {
  const cpl = [34, 40, 46, 38, 29, 33, 42, 37, 28, 35, 44, 49, 41, 32, 27, 36, 43, 39, 30, 34, 47, 42, 35, 28, 32, 40, 48, 44, 36, 31][index]
  const targetCpa = [72, 62, 53, 58, 70, 81, 66, 52, 59, 73, 85, 68, 56, 47, 63, 78, 69, 55, 61, 76, 64, 49, 58, 74, 84, 67, 54, 60, 77, 65][index]
  const ads = day.orders * cpl
  const delivered = Math.round(ads / targetCpa)
  return { ...day, ads, delivered, revenue: delivered * 200, cpl, cpa: ads / delivered }
})

function DemoChart({ marketing = false, month = false, step }: { marketing?: boolean; month?: boolean; step: number }) {
  const [hoveredDay, setHoveredDay] = useState<number | null>(null)
  const [hidden, setHidden] = useState<string[]>([])
  const source = marketing ? marketingDays : demoDays
  const data = month ? source : source.slice(0, 7)
  const series = marketing ? marketingSeries : businessSeries
  const max = marketing ? 100 : 6000
  const active = Math.min(hoveredDay ?? (step === 2 ? 4 : 2), data.length - 1)
  const x = (index: number) => 38 + index * 550 / (data.length - 1)
  const y = (value: number) => 154 - value / max * 140
  const format = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: marketing ? 2 : 0 })
  return <div className={`${styles.dailyChart} ${marketing ? styles.marketingChart : ''}`}>
    <div className={styles.chartHeader}><b>{marketing ? 'Coûts Ads moyens (CPL / CPA)' : 'Performance du business'}</b><div className={styles.legend}>{series.map(item => <button type="button" key={item.key} aria-pressed={!hidden.includes(item.key)} onClick={() => setHidden(previous => previous.includes(item.key) ? previous.filter(key => key !== item.key) : previous.length < series.length - 1 ? [...previous, item.key] : previous)}><i style={{ background: item.color }} />{item.label}</button>)}</div></div>
    {!marketing && <p className={styles.chartSubtitle}>Selon la période sélectionnée</p>}
    <svg className={styles.dailySvg} viewBox="0 0 600 180" preserveAspectRatio={marketing ? 'none' : 'xMidYMid meet'} role="img" aria-label={marketing ? 'Évolution quotidienne du CPL et du CPA en MAD' : 'Évolution quotidienne du CA, du profit, de la publicité et du coût d’achat en MAD'} onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); setHoveredDay(Math.max(0, Math.min(data.length - 1, Math.round(((event.clientX - bounds.left) / bounds.width * 600 - 38) / 550 * (data.length - 1))))) }} onPointerLeave={() => setHoveredDay(null)}>
      {[0, 1, 2, 3, 4].map(tick => <g key={tick}><line x1="38" x2="588" y1={y(max * tick / 4)} y2={y(max * tick / 4)} stroke="#e5ece7" strokeDasharray="3 4" /><text x="30" y={y(max * tick / 4) + 3} textAnchor="end">{max * tick / 4}</text></g>)}
      {series.filter(item => !hidden.includes(item.key)).map(item => <polyline key={item.key} fill="none" stroke={item.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" points={data.map((day, index) => `${x(index)},${y(day[item.key])}`).join(' ')} />)}
      <line x1={x(active)} x2={x(active)} y1="8" y2="154" stroke="#94a89b" strokeDasharray="3 3" />
      {series.filter(item => !hidden.includes(item.key)).map(item => <circle key={item.key} cx={x(active)} cy={y(data[active][item.key])} r="3.5" fill={item.color} stroke="white" strokeWidth="1.5" />)}
      {data.map((day, index) => (!month || index % 5 === 0 || index === data.length - 1) && <text key={day.date} x={x(index)} y="174" textAnchor="middle">{day.date}</text>)}
    </svg>
    <div className={styles.dayValues}><b>{data[active].date}</b>{series.filter(item => !hidden.includes(item.key)).map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label} <strong>{format(data[active][item.key])} MAD</strong></span>)}</div>
  </div>
}

function DashboardScene({ step }: { step: number }) {
  const [chosenPeriod, setChosenPeriod] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const [customStart, setCustomStart] = useState('2026-06-01')
  const [customEnd, setCustomEnd] = useState('2026-06-07')
  const period = chosenPeriod ?? (step === 2 ? 'week' : 'today')
  const open = manualOpen ?? (step === 1 && chosenPeriod === null)
  // Fixed fictional calendar: every selection stays isolated from live data.
  const periodLengths: Record<string, number> = { today: 1, yesterday: 1, week: 7, month: 30, last_month: 31, quarter: 91, year: 181, last_year: 365, all: 546 }
  const customLength = Math.max(1, Math.min(546, Math.floor((Date.parse(customEnd) - Date.parse(customStart)) / 86400000) + 1 || 1))
  const dayCount = period === 'custom' ? customLength : periodLengths[period]
  const days = Array.from({ length: dayCount }, (_, index) => demoDays[(index + (period === 'yesterday' ? 5 : 0)) % demoDays.length])
  const total = (key: 'orders' | 'delivered' | 'revenue' | 'charges' | 'ads' | 'profit') => days.reduce((sum, day) => sum + day[key], 0)
  const money = (value: number) => `${value.toLocaleString('fr-FR')} MAD`
  const periods = [
    { id: 'today', label: "Aujourd'hui" }, { id: 'yesterday', label: 'Hier' },
    { id: 'week', label: 'Cette semaine' }, { id: 'month', label: 'Ce mois' },
    { id: 'last_month', label: 'Mois dernier' }, { id: 'quarter', label: 'Ce trimestre' },
    { id: 'year', label: 'Cette année' }, { id: 'last_year', label: 'Année dernière' },
    { id: 'all', label: 'Toujours' }, { id: 'custom', label: 'Période personnalisée' },
  ]
  const kpis = [
    { label: 'Commandes', value: String(total('orders')), color: '#3b82f6' },
    { label: 'Commandes livrées', value: String(total('delivered')), color: '#10b981' },
    { label: 'Chiffre d’affaires', value: money(total('revenue')), color: '#22c55e' },
    { label: 'Charges', value: money(total('charges')), color: '#eab308' },
    { label: 'Coût publicité', value: money(total('ads')), color: '#a855f7' },
    { label: 'Profit (partiel)', value: money(total('profit')), color: '#10b981' },
  ]
  return <div className={styles.dashboard}>
    <div className={styles.dashboardToolbar}><span><Store size={13} /> Maison Démo</span><div className={styles.periodControl}><button type="button" className={styles.periodButton} aria-label="Choisir la période du Dashboard" aria-expanded={open} onClick={() => setManualOpen(!open)} onKeyDown={event => { if (event.key === 'Escape') setManualOpen(false) }}><Calendar size={13} />{periods.find(item => item.id === period)?.label}<ChevronDown size={13} /></button>{open && <div className={styles.periodMenu}>{periods.map(item => <button type="button" key={item.id} className={item.id === period ? styles.selected : ''} onClick={() => { setChosenPeriod(item.id); setManualOpen(false) }}>{item.label}{item.id === period && <Check size={12} />}</button>)}</div>}{chosenPeriod === null && step < 2 && <MousePointer2 key={step} className={`${styles.periodCursor} ${step === 1 ? styles.optionCursor : ''}`} size={23} fill="#1f2a23" aria-hidden="true" />}</div></div>
    <div className={styles.dashboardKpis}>{kpis.map(kpi => <div key={kpi.label}><span className={styles.kpiDot} style={{ background: kpi.color }} /><small>{kpi.label}</small><strong>{kpi.value}</strong></div>)}</div>
    {period === 'custom' && <div className={styles.customDates}><label>Date début<input type="date" value={customStart} max={customEnd} onChange={event => setCustomStart(event.target.value)} /></label><label>Date fin<input type="date" value={customEnd} min={customStart} onChange={event => setCustomEnd(event.target.value)} /></label></div>}
    <DemoChart month={dayCount > 7} step={step} />
  </div>
}

function AdsScene({ step }: { step: number }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const period = selected ?? (step === 2 ? 'month' : 'week')
  const open = manualOpen ?? (step === 1 && selected === null)
  const days = period === 'week' ? marketingDays.slice(0, 7) : marketingDays
  const spend = days.reduce((sum, day) => sum + day.ads, 0)
  const orders = days.reduce((sum, day) => sum + day.orders, 0)
  const delivered = days.reduce((sum, day) => sum + day.delivered, 0)
  const revenue = days.reduce((sum, day) => sum + day.revenue, 0)
  const format = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  return <>
    <div className={styles.toolbar}><span>Indicateurs marketing</span><div className={styles.adsPeriodControl} data-phase={selected === null ? step : 'manual'}><button type="button" className={styles.period} aria-label="Choisir la période Ads" aria-expanded={open} onClick={() => setManualOpen(!open)} onKeyDown={event => { if (event.key === 'Escape') setManualOpen(false) }}><Calendar size={11} />{period === 'week' ? 'Cette semaine' : 'Ce mois'}<ChevronDown size={11} /></button>{open && <div className={styles.adsPeriodMenu}>{[{ id: 'week', label: 'Cette semaine' }, { id: 'month', label: 'Ce mois' }].map(item => <button type="button" key={item.id} className={period === item.id ? styles.selected : ''} onClick={() => { setSelected(item.id); setManualOpen(false) }}>{item.label}{period === item.id && <Check size={10} />}</button>)}</div>}{selected === null && step < 2 && <MousePointer2 key={step} className={styles.adsCursor} size={20} fill="#1f2a23" aria-hidden="true" />}</div></div>
    <div className={`${styles.metrics} ${styles.adsMetrics}`}><div><small>Dépense publicitaire</small><b>{format(spend)} <small>MAD</small></b></div><div><small>CPL moyen (Coût par lead)</small><b>{format(spend / orders)} <small>MAD</small></b></div><div><small>CPA moyen (Coût par achat)</small><b>{format(spend / delivered)} <small>MAD</small></b></div><div><small>ROAS</small><b>{format(revenue / spend)}<small>x</small></b></div></div>
    <DemoChart marketing month={period === 'month'} step={step} />
  </>
}

function Scene({ index, step, onDeliveryCreate }: { index: number; step: number; onDeliveryCreate: () => void }) {
  if (index === 6) return <DashboardScene step={step} />
  if (index === 0) return <>
    <div className={styles.toolbar}><span>{step === 0 ? 2 : 3} commandes</span><span className={styles.connection}><span className={styles.dot} /> YouCan connecté</span></div>
    <div className={styles.tableHead}><span>Commande</span><span>Montant</span><span>Statut</span></div>
    {[['#DEMO-102', '249 MAD'], ['#DEMO-101', '189 MAD'], ['#DEMO-100', '320 MAD']].map(([id, amount], i) => <div key={id} className={`${styles.row} ${i === 0 && step > 0 ? styles.highlight : ''}`} style={{ opacity: i === 0 && step === 0 ? 0.3 : 1 }}><span><b>{id}</b><small>{i === 0 ? 'YouCan' : 'Saisie manuelle'}</small></span><span>{amount}</span><span className={styles.pending}>En attente</span></div>)}
    <div className={styles.notice}><Check size={13} /> {step > 0 ? 'Commande reçue automatiquement depuis YouCan' : 'Réception des commandes depuis votre boutique'}</div>
  </>
  if (index === 1) return <>
    <div className={styles.selector}><Store size={14} /><b>{step === 0 ? 'Maison Démo' : 'Tous les stores'}</b><ChevronDown size={13} /></div>
    <div className={styles.storeList}><span className={step > 0 ? styles.selected : ''}><Globe2 size={13} /> Tous les stores {step > 0 && <Check size={13} />}</span><span className={step === 0 ? styles.selected : ''}><Store size={13} /> Maison Démo</span><span><Store size={13} /> Atelier Démo</span></div>
    <div className={styles.metrics}><div><small>Commandes</small><b>{step === 0 ? '48' : '86'}</b></div><div><small>CA livré</small><b>{step === 0 ? '9 600' : '17 200'} <small>MAD</small></b></div></div>
  </>
  if (index === 2) return <>
    <div className={styles.question}>Quel est mon CA livré ce mois-ci ?</div>
    <div className={styles.answer}><span className={styles.assistant}><Sparkles size={14} /> Assistant Jisra</span>{step === 0 ? <p>Posez votre question business...</p> : <><p>Votre chiffre d’affaires livré sur la période :</p><strong>17 200 <small>MAD</small></strong><div className={styles.source}>86 commandes livrées · Ce mois-ci</div>{step === 2 && <p className={styles.answerDetail}>Soit un panier moyen livré de <b>200 MAD</b>.</p>}</>}</div>
    <div className={styles.input}>Posez votre question business... <span>↑</span></div>
  </>
  if (index === 3) return <>
    <div className={styles.toolbar}><span>Colis confirmés</span><Status>ForceLog</Status></div>
    {['DEMO-102', 'DEMO-101'].map((id, i) => <div className={styles.row} key={id}><span className={styles.checkbox}>{step > 0 && <Check size={12} />}</span><span><b>#{id}</b><small>{i === 0 ? 'Casablanca' : 'Rabat'}</small></span><Status>Confirmée</Status></div>)}
    <div className={styles.actionBar}><button type="button" disabled={step === 2} onClick={onDeliveryCreate} className={`${styles.action} ${step === 1 ? styles.clickTarget : ''}`}>{step === 2 ? <><Check size={12} /> Bon créé</> : `Créer bon de ramassage (${step > 0 ? 2 : 0})`}</button>{step === 1 && <MousePointer2 className={styles.deliveryCursor} size={22} fill="#1f2a23" />}</div>
    {step === 2 ? <div className={styles.voucher}><span className={styles.voucherCheck}><Check size={16} /></span><span><b>Bon DEMO-BR01</b><small>ForceLog · 2 colis · Créé</small></span><span className={styles.voucherLabel}>PDF</span></div> : <div className={styles.notice}>Sélectionner les colis puis créer le bon</div>}
  </>
  if (index === 4) return <AdsScene step={step} />
  return <>
    <div className={styles.toolbar}><span>Stock par variante</span><span className={styles.action}>+ Ajouter un mouvement</span></div>
    <div className={styles.product}><span className={styles.productIcon}><Warehouse size={22} /></span><div><b>T-shirt Démo</b><small>Noir / M · SKU DEMO-M</small></div><strong>{step === 2 ? '42' : '30'}<small>unités</small></strong></div>
    <div className={styles.stockForm}><span>Type de mouvement <b>Entrée <ChevronDown size={11} /></b></span><span>Quantité <b>{step === 0 ? '—' : '+ 12'}</b></span></div>
    <div className={styles.row}><span><b>Dernier mouvement</b><small>T-shirt Démo · Noir / M</small></span><Status>{step === 2 ? 'Entrée +12' : 'Entrée +30'}</Status></div>
    <div className={styles.notice}><Check size={13} />{step === 2 ? 'Mouvement enregistré · 42 unités en stock' : 'Chaque mouvement reste traçable'}</div>
  </>
}

export function FeatureDemo({ index }: { index: number }) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const [reduced, setReduced] = useState(true)
  const [paused, setPaused] = useState(false)
  const [step, setStep] = useState(2)
  const scene = scenes[index]
  const Icon = scene.icon
  const playing = visible && !reduced && !paused

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      setReduced(preference.matches)
      if (preference.matches) setStep(2)
    }
    update()
    preference.addEventListener('change', update)
    const element = ref.current
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 })
    if (element) observer.observe(element)
    return () => { observer.disconnect(); preference.removeEventListener('change', update) }
  }, [])

  useEffect(() => {
    if (!playing) return
    let timer: number
    let current = 0
    const advance = () => {
      if (!document.hidden) {
        setStep(current)
        const delay = [1800, 2200, 3000][current]
        current = (current + 1) % 3
        timer = window.setTimeout(advance, delay)
      } else {
        timer = window.setTimeout(advance, 1000)
      }
    }
    advance()
    return () => window.clearTimeout(timer)
  }, [playing])

  return <figure ref={ref} className={`${styles.demo} ${index === 6 ? styles.dashboardDemo : ''} ${index === 4 ? styles.marketingDemo : ''}`} aria-label={`Démonstration ${scene.title}. ${scene.caption[2]}. Données fictives.`}>
    <div className={styles.topline}><span><span className={styles.dot} /> APERÇU PRODUIT</span><span>DONNÉES FICTIVES</span></div>
    {(index === 3 || index === 4 || index === 6) && <p className={styles.interactionHint} data-playing={playing}><Hand size={14} aria-hidden="true" /><span>{index === 3 ? 'Essayez : cliquez pour créer le bon' : 'À vous de jouer : périodes et graphiques interactifs'}</span></p>}
    <div className={styles.window}>
      <div className={styles.windowBar}><JisraMark size={20} /><b>jisra<span>.</span></b><span className={styles.windowPath}>/ {scene.title}</span><span className={styles.avatar}>JD</span></div>
      <div className={styles.content}><div className={styles.heading}><Icon size={17} /><h4>{scene.title}</h4><span className={styles.demoPill}>Démo</span></div><div className={styles.scene}><Scene index={index} step={step} onDeliveryCreate={() => { setStep(2); setPaused(true) }} /></div></div>
      {playing && step === 1 && index !== 0 && index !== 3 && index !== 4 && index !== 6 && <MousePointer2 className={styles.cursor} size={22} fill="#1f2a23" />}
    </div>
    <figcaption className={styles.caption}><span className={styles.stepNumber}>0{step + 1}</span><span>{scene.caption[step]}</span><button type="button" onClick={() => setPaused(!paused)} disabled={reduced} aria-label={paused ? 'Lire la démonstration' : 'Mettre la démonstration en pause'}>{paused || reduced ? <Play size={13} /> : <Pause size={13} />}</button></figcaption>
    <div className={styles.progress} data-playing={playing} aria-hidden="true"><span key={String(playing)} /></div>
  </figure>
}