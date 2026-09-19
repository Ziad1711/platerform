'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { usePermissions } from '@/lib/auth/use-permissions'

type Row = {
  id: string
  spend_date: string
  spend: number
  spend_converted: number
  spend_currency: string | null
  currency_convert: string | null
}

function todayCasablanca() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function saveError(code: string) {
  if (code === 'AUTOMATIC_SPEND_EXISTS') return 'Des dépenses Meta existent déjà pour cette date. La saisie manuelle est bloquée pour éviter un double comptage.'
  if (code === 'FUTURE_SPEND_DATE') return 'Une date future n’est pas autorisée.'
  return 'Vérifiez la date et le montant puis réessayez.'
}

export default function ManualDailySpend({ storeId }: { storeId: string | null }) {
  const queryClient = useQueryClient()
  const { can } = usePermissions(storeId)
  const canManage = can('advertising.manage')
  const [date, setDate] = useState(todayCasablanca())
  const [amount, setAmount] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ['manual-ad-spend', storeId],
    enabled: !!storeId,
    queryFn: async () => {
      const params = new URLSearchParams({ storeId: storeId! })
      const response = await fetch(`/api/ads/manual-spend?${params}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'FETCH_FAILED')
      return payload.entries || []
    },
  })

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.spend_converted || 0), 0), [rows])
  const reset = () => { setEditingId(null); setDate(todayCasablanca()); setAmount('') }
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['manual-ad-spend', storeId] }),
    queryClient.invalidateQueries({ queryKey: ['ads-metrics', storeId] }),
  ])

  const save = async () => {
    if (!storeId || Number(amount) <= 0) return toast.error('Saisissez un montant supérieur à zéro.')
    setSaving(true)
    try {
      const response = await fetch('/api/ads/manual-spend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, spendDate: date, amount: Number(amount) }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'SAVE_FAILED')
      toast.success(payload.updated ? 'Dépense mise à jour' : 'Dépense ajoutée')
      reset()
      await refresh()
    } catch (error) {
      toast.error(saveError(error instanceof Error ? error.message : ''))
    } finally { setSaving(false) }
  }

  const remove = async (row: Row) => {
    if (!storeId || !window.confirm(`Supprimer la dépense du ${formatDate(row.spend_date)} ?`)) return
    setDeletingId(row.id)
    try {
      const params = new URLSearchParams({ storeId, id: row.id })
      const response = await fetch(`/api/ads/manual-spend?${params}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('DELETE_FAILED')
      toast.success('Dépense supprimée')
      if (editingId === row.id) reset()
      await refresh()
    } catch { toast.error('Impossible de supprimer cette dépense.') }
    finally { setDeletingId(null) }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-[#1fa971]" /><h2 className="text-lg font-semibold">Dépenses quotidiennes manuelles</h2></div>
          <p className="mt-1 text-sm text-muted-foreground">Une dépense par jour, automatiquement répartie sur les commandes publicitaires livrées.</p>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-right dark:bg-emerald-950/30">
          <p className="text-xs text-emerald-700 dark:text-emerald-300">Total des saisies affichées</p>
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">{formatCurrency(total)}</p>
        </div>
      </div>

      {canManage ? (
      <div className="mt-5 grid gap-3 rounded-xl border bg-gray-50 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end dark:border-gray-700 dark:bg-gray-900/40">
        <label className="text-sm font-medium">Date<input type="date" max={todayCasablanca()} value={date} disabled={Boolean(editingId)} onChange={(e) => setDate(e.target.value)} className="mt-1 h-11 w-full rounded-lg border bg-white px-3 dark:border-gray-600 dark:bg-gray-800" /></label>
        <label className="text-sm font-medium">Montant dépensé<input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex. 350.00" className="mt-1 h-11 w-full rounded-lg border bg-white px-3 dark:border-gray-600 dark:bg-gray-800" /></label>
        <div className="flex gap-2">
          <button type="button" onClick={() => void save()} disabled={!storeId || saving || !date || !amount} className="inline-flex h-11 min-w-[130px] items-center justify-center gap-2 rounded-lg bg-[#1fa971] px-4 text-sm font-medium text-white hover:bg-[#198f60] disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{editingId ? 'Mettre à jour' : 'Ajouter'}
          </button>
          {editingId ? <button type="button" aria-label="Annuler" onClick={reset} className="h-11 w-11 rounded-lg border"><X className="mx-auto h-4 w-4" /></button> : null}
        </div>
      </div>
      ) : (
        <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-muted-foreground dark:border-gray-700 dark:bg-gray-900/40">
          Vous disposez d’un accès en lecture seule aux dépenses publicitaires.
        </div>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[580px] text-sm">
          <thead><tr className="border-b text-xs uppercase tracking-wide text-gray-500"><th className="px-3 py-3 text-left">Date</th><th className="px-3 py-3 text-right">Montant</th><th className="px-3 py-3 text-left">Devise</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={4} className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            : rows.length === 0 ? <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">Aucune dépense manuelle sur cette période.</td></tr>
            : rows.map((row) => <tr key={row.id} className="border-b dark:border-gray-700">
              <td className="px-3 py-3 font-medium">{formatDate(row.spend_date)}</td>
              <td className="px-3 py-3 text-right font-semibold">{formatCurrency(Number(row.spend_converted || row.spend), row.currency_convert || row.spend_currency || 'MAD')}</td>
              <td className="px-3 py-3 text-muted-foreground">{row.currency_convert || row.spend_currency || 'MAD'}</td>
              <td className="px-3 py-3"><div className="flex justify-end gap-2">
                <button type="button" aria-label="Modifier" disabled={!canManage} onClick={() => { setEditingId(row.id); setDate(row.spend_date.slice(0, 10)); setAmount(String(row.spend)) }} className="h-9 w-9 rounded-lg border"><Pencil className="mx-auto h-4 w-4" /></button>
                <button type="button" aria-label="Supprimer" disabled={!canManage || deletingId === row.id} onClick={() => void remove(row)} className="h-9 w-9 rounded-lg border border-red-200 text-red-600">{deletingId === row.id ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : <Trash2 className="mx-auto h-4 w-4" />}</button>
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
