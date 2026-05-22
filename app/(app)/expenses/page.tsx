'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import StoreSelector from '@/components/dashboard/store-selector'
import { JisraMark } from '@/components/logo'
import { Plus, RefreshCw, Search } from 'lucide-react'

type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'yearly'
type CategoryPresetKey = 'salary' | 'rent' | 'hosting' | 'marketing' | 'logistics' | 'other'

const getNowLocalDateTimeValue = () => {
  const now = new Date()
  const tzOffset = now.getTimezoneOffset() * 60000
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 16)
}

const toIso = (value: string) => new Date(value).toISOString()

const WEEKDAYS = [
  { value: '0', label: 'Dimanche' },
  { value: '1', label: 'Lundi' },
  { value: '2', label: 'Mardi' },
  { value: '3', label: 'Mercredi' },
  { value: '4', label: 'Jeudi' },
  { value: '5', label: 'Vendredi' },
  { value: '6', label: 'Samedi' },
]

const CATEGORY_PRESETS: Array<{ key: CategoryPresetKey; name: string; type: string }> = [
  { key: 'salary', name: 'Salaire', type: 'salary' },
  { key: 'rent', name: 'Loyer', type: 'rent' },
  { key: 'hosting', name: 'Hosting', type: 'tool' },
  { key: 'marketing', name: 'Marketing', type: 'ads' },
  { key: 'logistics', name: 'Logistique', type: 'delivery_extra' },
  { key: 'other', name: 'Autre', type: 'other' },
]

export default function DepensesPage() {
  const PAGE_SIZE = 10
  const { currentStoreId, accessibleStoreIds, accessibleStores: stores } = useStore()
  const supabase = createClient()
  const queryClient = useQueryClient()

  const [selectedInputStoreId, setSelectedInputStoreId] = useState('')
  const [isAddExpenseModalOpen, setIsAddExpenseModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  const [selectedCategoryKey, setSelectedCategoryKey] = useState<CategoryPresetKey>('rent')
  const [expenseNote, setExpenseNote] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('0')
  const [expenseDate, setExpenseDate] = useState(getNowLocalDateTimeValue())
  const [isRecurring, setIsRecurring] = useState(false)

  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('monthly')
  const [recurrenceWeekday, setRecurrenceWeekday] = useState('1')
  const [recurrenceDay, setRecurrenceDay] = useState('1')
  const [recurrenceMonth, setRecurrenceMonth] = useState('1')
  const [recurringEndsAt, setRecurringEndsAt] = useState('')

  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (currentStoreId) {
      setSelectedInputStoreId(currentStoreId)
      return
    }

    if (!selectedInputStoreId && (stores as any[]).length > 0) {
      setSelectedInputStoreId((stores as any[])[0].id)
    }
  }, [currentStoreId, selectedInputStoreId, stores])

  useEffect(() => {
    setCurrentPage(1)
  }, [currentStoreId, search])

  const { data: recurringTemplates = [] } = useQuery({
    queryKey: ['expense-recurring-templates', currentStoreId],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return []
      }

      const targetStoreIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

      for (const storeId of targetStoreIds) {
        const { error: recurringGenerationError } = await supabase.rpc('generate_recurring_expenses', {
          p_store_id: storeId,
          p_until: new Date().toISOString(),
        })

        if (recurringGenerationError) throw recurringGenerationError
      }

      const { data, error } = await supabase
        .from('expense_recurring_templates')
        .select('id, store_id, name, amount, recurrence_type, recurrence_weekday, recurrence_day, recurrence_month, next_run_at, is_active, note, expense_categories(name), stores(name)')
        .order('created_at', { ascending: false })

      const filteredData = currentStoreId
        ? (data || []).filter((row: any) => row.store_id === currentStoreId)
        : (data || []).filter((row: any) => accessibleStoreIds.includes(String(row.store_id || '')))

      if (error) throw error
      return filteredData
    },
  })

  const { data: expenses, isLoading: isExpensesLoading } = useQuery({
    queryKey: ['expenses-list', currentStoreId, search, currentPage],
    queryFn: async () => {
      if (!currentStoreId && accessibleStoreIds.length === 0) {
        return { data: [], count: 0 }
      }

      const targetStoreIds = currentStoreId ? [currentStoreId] : accessibleStoreIds

      for (const storeId of targetStoreIds) {
        const { error: recurringGenerationError } = await supabase.rpc('generate_recurring_expenses', {
          p_store_id: storeId,
          p_until: new Date().toISOString(),
        })

        if (recurringGenerationError) throw recurringGenerationError
      }

      let query = supabase
        .from('expenses')
        .select('id, store_id, amount, expense_date, note, expense_type, status, expense_categories(name), stores(name)', { count: 'exact' })
        .order('expense_date', { ascending: false })
        .range((currentPage - 1) * PAGE_SIZE, (currentPage * PAGE_SIZE) - 1)

      if (search.trim()) {
        query = query.or(`note.ilike.%${search}%,expense_type.ilike.%${search}%`)
      }

      if (currentStoreId) {
        query = query.eq('store_id', currentStoreId)
      } else {
        query = query.in('store_id', accessibleStoreIds)
      }

      const { data, error, count } = await query

      if (error) throw error
      return {
        data: data || [],
        count: count || 0,
      }
    },
  })

  const invalidateExpensesData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['expenses-list'] }),
      queryClient.invalidateQueries({ queryKey: ['expense-recurring-templates'] }),
    ])
  }

  const getOrCreateCategory = async (storeId: string, categoryKey: CategoryPresetKey) => {
    if (!storeId) throw new Error('Sélectionnez un store.')

    const categoryPreset = CATEGORY_PRESETS.find((c) => c.key === categoryKey)
    if (!categoryPreset) throw new Error('Catégorie invalide.')

    const { data: existingCategory, error: existingCategoryError } = await supabase
      .from('expense_categories')
      .select('id')
      .eq('store_id', storeId)
      .eq('name', categoryPreset.name)
      .maybeSingle()

    if (existingCategoryError) throw existingCategoryError
    if (existingCategory?.id) return existingCategory.id

    const { data: insertedCategory, error: insertCategoryError } = await supabase
      .from('expense_categories')
      .insert({
        store_id: storeId,
        name: categoryPreset.name,
        type: categoryPreset.type,
      })
      .select('id')
      .single()

    if (insertCategoryError) throw insertCategoryError
    return insertedCategory.id as string
  }

  const createExpenseMutation = useMutation({
    mutationFn: async () => {
      const targetStoreId = currentStoreId || selectedInputStoreId
      if (!targetStoreId) throw new Error('Sélectionnez un store.')
      if (!expenseNote.trim()) throw new Error('Note obligatoire.')
      if (Number(expenseAmount || 0) <= 0) throw new Error('Montant invalide.')

      const categoryId = await getOrCreateCategory(targetStoreId, selectedCategoryKey)
      const selectedCategoryLabel = CATEGORY_PRESETS.find((c) => c.key === selectedCategoryKey)?.name || 'Autre'

      if (!isRecurring) {
        const { error } = await supabase
          .from('expenses')
          .insert({
            store_id: targetStoreId,
            category_id: categoryId,
            expense_date: toIso(expenseDate),
            amount: Number(expenseAmount || 0),
            note: expenseNote.trim(),
            expense_type: 'manual',
            status: 'active',
            source_type: 'manual',
          })

        if (error) throw error
        return
      }

      const payload: Record<string, any> = {
        store_id: targetStoreId,
        category_id: categoryId,
        name: selectedCategoryLabel,
        amount: Number(expenseAmount || 0),
        recurrence_type: recurrenceType,
        recurrence_weekday: null,
        recurrence_day: null,
        recurrence_month: null,
        starts_at: toIso(expenseDate),
        ends_at: recurringEndsAt ? toIso(recurringEndsAt) : null,
        next_run_at: toIso(expenseDate),
        note: expenseNote.trim(),
        is_active: true,
      }

      if (recurrenceType === 'weekly') {
        payload.recurrence_weekday = Number(recurrenceWeekday)
      }

      if (recurrenceType === 'monthly') {
        payload.recurrence_day = Number(recurrenceDay)
      }

      if (recurrenceType === 'yearly') {
        payload.recurrence_day = Number(recurrenceDay)
        payload.recurrence_month = Number(recurrenceMonth)
      }

      const { error } = await supabase
        .from('expense_recurring_templates')
        .insert(payload)

      if (error) throw error
    },
    onSuccess: async () => {
      setSelectedCategoryKey('rent')
      setExpenseNote('')
      setExpenseAmount('0')
      setExpenseDate(getNowLocalDateTimeValue())
      setIsRecurring(false)
      setRecurrenceType('monthly')
      setRecurrenceWeekday('1')
      setRecurrenceDay('1')
      setRecurrenceMonth('1')
      setRecurringEndsAt('')
      setIsAddExpenseModalOpen(false)
      setErrorMessage('')
      await invalidateExpensesData()
    },
    onError: (error: any) => {
      setErrorMessage(error?.message || 'Erreur enregistrement charge')
    },
  })

  const toggleRecurringMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('expense_recurring_templates')
        .update({ is_active: !is_active })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: invalidateExpensesData,
    onError: (error: any) => setErrorMessage(error?.message || 'Erreur mise à jour récurrente'),
  })

  const totalExpenses = useMemo(
    () => ((expenses?.data || []) as any[]).reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0),
    [expenses]
  )

  const totalExpensesCount = expenses?.count || 0
  const totalPages = Math.max(1, Math.ceil(totalExpensesCount / PAGE_SIZE))

  if ((stores as any[]).length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Aucun store trouvé.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center sm:items-start gap-1">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Dépenses
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Suivi des charges et dépenses
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl shadow p-5">
          <div className="text-sm text-muted-foreground">Total charges (page en cours)</div>
          <div className="text-2xl font-bold text-foreground mt-1">{formatCurrency(totalExpenses)}</div>
        </div>
        <div className="bg-card rounded-xl shadow p-5">
          <div className="text-sm text-muted-foreground">Charges récurrentes actives</div>
          <div className="text-2xl font-bold text-foreground mt-1">
            {(recurringTemplates as any[]).filter((r: any) => r.is_active).length}
          </div>
        </div>
        <div className="bg-card rounded-xl shadow p-5">
          <div className="text-sm text-muted-foreground">Charges créées</div>
          <div className="text-2xl font-bold text-foreground mt-1">{totalExpensesCount}</div>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
          <StoreSelector />

          <div className="flex-1 relative min-w-[220px]">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher par note ou type..."
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-primary bg-card text-foreground"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setIsAddExpenseModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-2 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Ajouter une charge
          </button>
        </div>
      </div>

      {isAddExpenseModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-5xl rounded-xl bg-card shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">Ajouter une charge</h3>
              <button
                type="button"
                onClick={() => setIsAddExpenseModalOpen(false)}
                className="border rounded-lg px-3 py-1.5 text-sm"
              >
                Fermer
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {!currentStoreId ? (
                <div>
                  <label className="block text-sm text-foreground mb-1">Store</label>
                  <select
                    value={selectedInputStoreId}
                    onChange={(e) => setSelectedInputStoreId(e.target.value)}
                    className="border rounded-lg px-3 py-2 w-full"
                  >
                    {(stores as any[]).map((store: any) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label className="block text-sm text-foreground mb-1">Catégorie</label>
                <select
                  value={selectedCategoryKey}
                  onChange={(e) => setSelectedCategoryKey(e.target.value as CategoryPresetKey)}
                  className="border rounded-lg px-3 py-2 w-full"
                >
                  {CATEGORY_PRESETS.map((category) => (
                    <option key={category.key} value={category.key}>{category.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">Note</label>
                <input
                  value={expenseNote}
                  onChange={(e) => setExpenseNote(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="Ex: Salaire pour Youssef"
                />
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">Montant (MAD)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="Ex: 1200"
                />
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">
                  {isRecurring ? 'Date de début' : 'Date de la charge'}
                </label>
                <input
                  type="datetime-local"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-foreground mb-1">Type</label>
                <label className="flex items-center gap-2 text-sm border rounded-lg px-3 py-2 h-[42px]">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                  />
                  Charge récurrente
                </label>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Si "Charge récurrente" est activée, la date devient la première exécution automatique.
            </p>

            {selectedCategoryKey === 'marketing' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Ne mettez pas ici les charges Ads (Facebook/Google/TikTok Ads), elles sont calculées séparément dans
                {' '}
                <a href="/advertising" className="underline font-medium">
                  dashboard/publicite
                </a>
                .
                <br />
                Ici, ajoutez seulement les autres charges marketing : collaborations, achats de comptes, créatifs, etc.
              </div>
            ) : null}
            {selectedCategoryKey === 'logistics' ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                Ne mettez pas ici les frais de livraison liés aux commandes, ils sont gérés séparément dans
                {' '}
                <a href="/delivery" className="underline font-medium">
                  dashboard/livraison
                </a>
                .
                <br />
                Ici, ajoutez seulement les autres charges logistiques : emballage, stockage externe, manutention, etc.
              </div>
            ) : null}

            {isRecurring ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-sm text-foreground mb-1">Période</label>
                  <select
                    value={recurrenceType}
                    onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
                    className="border rounded-lg px-3 py-2 w-full"
                  >
                    <option value="daily">Chaque jour</option>
                    <option value="weekly">Chaque semaine</option>
                    <option value="monthly">Chaque mois</option>
                    <option value="yearly">Chaque année</option>
                  </select>
                </div>

                {recurrenceType === 'weekly' ? (
                  <div>
                    <label className="block text-sm text-foreground mb-1">Jour de la semaine</label>
                    <select
                      value={recurrenceWeekday}
                      onChange={(e) => setRecurrenceWeekday(e.target.value)}
                      className="border rounded-lg px-3 py-2 w-full"
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {recurrenceType === 'monthly' || recurrenceType === 'yearly' ? (
                  <div>
                    <label className="block text-sm text-foreground mb-1">Jour du mois</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={recurrenceDay}
                      onChange={(e) => setRecurrenceDay(e.target.value)}
                      className="border rounded-lg px-3 py-2 w-full"
                      placeholder="Ex: 1, 15, 30"
                    />
                  </div>
                ) : null}

                {recurrenceType === 'yearly' ? (
                  <div>
                    <label className="block text-sm text-foreground mb-1">Mois</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={recurrenceMonth}
                      onChange={(e) => setRecurrenceMonth(e.target.value)}
                      className="border rounded-lg px-3 py-2 w-full"
                      placeholder="Ex: 1 = Janvier"
                    />
                  </div>
                ) : null}

                <div>
                  <label className="block text-sm text-foreground mb-1">Date de fin (optionnel)</label>
                  <input
                    type="datetime-local"
                    value={recurringEndsAt}
                    onChange={(e) => setRecurringEndsAt(e.target.value)}
                    className="border rounded-lg px-3 py-2 w-full"
                  />
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddExpenseModalOpen(false)}
                className="border rounded-lg px-4 py-2"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => createExpenseMutation.mutate()}
                disabled={createExpenseMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-white rounded-lg px-4 py-2 disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="bg-card rounded-xl shadow overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Historique des dépenses</h3>
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['expenses-list'] })}
            className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border"
          >
            <RefreshCw className="w-4 h-4" /> Actualiser
          </button>
        </div>
        <div className="overflow-x-auto">
          {isExpensesLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Chargement...</div>
          ) : (
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-secondary">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
                  {!currentStoreId ? (
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Store</th>
                  ) : null}
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Catégorie</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Montant</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Note</th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {((expenses?.data || []) as any[]).map((expense: any) => (
                  <tr key={expense.id}>
                    <td className="px-4 py-3 text-sm text-foreground">{formatDateTime(expense.expense_date)}</td>
                    {!currentStoreId ? (
                      <td className="px-4 py-3 text-sm text-foreground">{expense.stores?.name || '-'}</td>
                    ) : null}
                    <td className="px-4 py-3 text-sm text-foreground">{expense.expense_categories?.name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{expense.expense_type}</td>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{formatCurrency(Number(expense.amount || 0))}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{expense.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalExpensesCount > 0 ? (
          <div className="border-t border-border px-4 py-3 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Page {currentPage} / {totalPages} • {totalExpensesCount} charges
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-md border border-border text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Précédent
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="px-3 py-1.5 rounded-md border border-border text-sm text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Suivant
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="bg-card rounded-xl shadow p-5 space-y-4">
        <h3 className="text-base font-semibold text-foreground">Charges récurrentes</h3>

        <div className="space-y-2">
          {(recurringTemplates as any[]).map((tpl: any) => (
            <div key={tpl.id} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">
                  {tpl.expense_categories?.name || tpl.name} - {formatCurrency(Number(tpl.amount || 0))}
                </div>
                <div className="text-xs text-muted-foreground">
                  {tpl.note ? `${tpl.note} • ` : ''}{tpl.recurrence_type} • Prochaine exécution: {formatDateTime(tpl.next_run_at)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleRecurringMutation.mutate({ id: tpl.id, is_active: !!tpl.is_active })}
                className={`px-3 py-1.5 rounded-md text-sm ${tpl.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}
              >
                {tpl.is_active ? 'Désactiver auto' : 'Activer auto'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {errorMessage ? (
        <div className="text-sm text-red-600">{errorMessage}</div>
      ) : null}
    </div>
  )
}
