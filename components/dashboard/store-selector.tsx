'use client'

import { useStore } from '@/lib/store-context'
import { createClient } from '@/lib/supabase/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Store, AlertCircle, Loader2, Sparkles, Globe2, Building2, Plus, X, Settings } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState, useEffect } from 'react'

const categories = [
  'Mode & vêtements',
  'Beauté & cosmétiques',
  'Électronique',
  'Maison & déco',
  'Santé & bien-être',
  'Sport & fitness',
  'Alimentation',
  'Bébé & enfants',
  'Bijoux & accessoires',
  'Auto & moto',
  'Autre',
]

const timezones = [
  'Africa/Casablanca',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/London',
  'America/New_York',
  'Asia/Dubai',
]

export default function StoreSelector() {
  const { currentStoreId, setCurrentStoreId, accessibleStores: stores, isStoresLoading } = useStore()
  const [isOpen, setIsOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [hasAutoSelectedDefault, setHasAutoSelectedDefault] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [form, setForm] = useState({
    category: categories[0],
    storeName: '',
    logoUrl: '',
    website: '',
    country: 'MA',
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
  })
  const supabase = useMemo(() => createClient(), [])
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true

    const loadGeoDefaults = async () => {
      try {
        const geoResponse = await fetch('/api/geo', { cache: 'no-store' }).catch(() => null)
        if (!geoResponse?.ok || !active) return

        const geo = await geoResponse.json()
        if (!active) return

        setForm((prev) => ({
          ...prev,
          country: geo?.country || prev.country,
          timezone: geo?.timezone || prev.timezone,
          currency: geo?.currency || prev.currency,
        }))
      } catch {
        // ignore geo defaults failure
      }
    }

    void loadGeoDefaults()
    return () => {
      active = false
    }
  }, [])

  const currentStore = stores?.find(store => store.id === currentStoreId)

  const createStoreMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: form.category,
          storeName: form.storeName,
          logoUrl: form.logoUrl,
          website: form.website,
          country: form.country,
          timezone: form.timezone,
          currency: form.currency.toUpperCase(),
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'STORE_CREATE_FAILED')
      }

      return payload.store as { id: string; name: string }
    },
    onSuccess: async (store) => {
      await queryClient.invalidateQueries({ queryKey: ['accessible-stores'] })
      setCurrentStoreId(store.id)
      setIsCreateOpen(false)
      setCreateError(null)
      setForm((prev) => ({
        ...prev,
        category: categories[0],
        storeName: '',
        logoUrl: '',
        website: '',
      }))
    },
    onError: (error) => {
      setCreateError(error instanceof Error ? error.message : 'Une erreur est survenue')
    },
  })

  useEffect(() => {
    if (!hasAutoSelectedDefault && !currentStoreId && stores && stores.length > 0) {
      setCurrentStoreId(stores[0].id)
      setHasAutoSelectedDefault(true)
    }
  }, [currentStoreId, hasAutoSelectedDefault, setCurrentStoreId, stores])

  const handleChange = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleCreateStore = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setCreateError(null)

    if (!form.storeName.trim()) {
      setCreateError('Le nom du store est requis')
      return
    }

    if (form.currency.trim().length !== 3) {
      setCreateError('La devise doit contenir 3 lettres')
      return
    }

    await createStoreMutation.mutateAsync()
  }

  const handleLogoUpload = async (file: File | null) => {
    if (!file) return

    setUploadingLogo(true)
    setCreateError(null)

    try {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user
      if (!user) throw new Error('Utilisateur non authentifié')

      const extension = file.name.split('.').pop() || 'png'
      const safeName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from('store-logos')
        .upload(safeName, file, { upsert: false })

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('store-logos').getPublicUrl(safeName)
      setForm((prev) => ({ ...prev, logoUrl: data.publicUrl }))
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Upload logo impossible')
    } finally {
      setUploadingLogo(false)
    }
  }

  const openCreateModal = () => {
    setIsOpen(false)
    setCreateError(null)
    setIsCreateOpen(true)
  }

  if (isStoresLoading) {
    return (
      <div className="flex items-center space-x-2 px-4 py-2 bg-card rounded-lg border border-border">
        <div className="animate-pulse h-4 w-24 bg-secondary rounded"></div>
      </div>
    )
  }

  if (!stores || stores.length === 0) {
    return (
      <div className="flex items-center space-x-2 px-4 py-2 bg-card rounded-lg border border-border text-muted-foreground">
        <Store className="w-4 h-4" />
        <span>Aucun store</span>
      </div>
    )
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center space-x-2 px-4 py-2 bg-card rounded-lg border border-border hover:bg-secondary transition-colors text-foreground"
        >
          <div className="w-5 h-5 rounded-md border overflow-hidden bg-secondary flex items-center justify-center text-[9px] text-muted-foreground shrink-0">
            {currentStore?.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentStore.logo_url} alt={currentStore.name || 'Logo store'} className="w-full h-full object-cover" />
            ) : (
              <Store className="w-3.5 h-3.5" />
            )}
          </div>
          <span className="font-medium">
            {currentStore ? currentStore.name : 'Tous les stores'}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsOpen(false)}
            />
            <div className="absolute top-full left-0 mt-1 w-72 bg-card rounded-lg shadow-lg border border-border z-20">
              <div className="p-2">
                <div className="text-xs font-semibold text-muted-foreground px-2 py-1">
                  Vos stores
                </div>
                <button
                  onClick={() => {
                    setCurrentStoreId(null)
                    setIsOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    currentStoreId === null
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-secondary'
                  }`}
                >
                  <div className="font-medium flex items-center gap-2">
                    <Store className="w-4 h-4" />
                    Tous les stores
                  </div>
                </button>
                {stores.map((store) => (
                  <button
                    key={store.id}
                    onClick={() => {
                      setCurrentStoreId(store.id)
                      setIsOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      currentStoreId === store.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-secondary'
                    }`}
                  >
                    <div className="font-medium text-foreground flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md border overflow-hidden bg-secondary flex items-center justify-center text-[9px] text-muted-foreground shrink-0">
                        {store.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={store.logo_url} alt={store.name || 'Logo store'} className="w-full h-full object-cover" />
                        ) : (
                          <Store className="w-3.5 h-3.5" />
                        )}
                      </div>
                      <span className="truncate">{store.name}</span>
                    </div>
                  </button>
                ))}

                <div className="my-2 h-px bg-border" />

                <button
                  onClick={openCreateModal}
                  className="w-full rounded-md border border-dashed border-primary/30 bg-primary/5 px-3 py-2 text-left text-sm text-primary transition hover:bg-primary/10"
                >
                  <div className="flex items-center gap-2 font-medium">
                    <Plus className="w-4 h-4" />
                    Ajouter un store
                  </div>
                </button>

                <div className="my-2 h-px bg-border" />

                <Link
                  href="/settings#stores"
                  onClick={() => setIsOpen(false)}
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-secondary flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Gérer les stores
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      {isCreateOpen ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => !createStoreMutation.isPending && setIsCreateOpen(false)} />

          <div className="relative w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/10 bg-[#101613] shadow-[0_30px_120px_rgba(0,0,0,0.45)]">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              disabled={createStoreMutation.isPending}
              className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
              <div className="border-b border-white/10 bg-white/[0.03] p-6 lg:border-b-0 lg:border-r lg:p-8">
                <div className="inline-flex items-center gap-2 rounded-full border border-jisra-green/20 bg-jisra-green/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-jisra-green-light">
                  <Sparkles className="h-3.5 w-3.5" />
                  nouveau store
                </div>
                <h2 className="mt-5 text-2xl font-bold text-white">Ajoutez un nouveau store</h2>
                <p className="mt-3 text-sm leading-6 text-jisra-cream/85">
                  Configurez rapidement un nouveau store avec les informations essentielles pour démarrer.
                </p>

                <div className="mt-8 space-y-4">
                  {[
                    { icon: Building2, title: 'Identité business', text: 'Nom, activité et website pour bien identifier le store.' },
                    { icon: Store, title: 'Store prêt à utiliser', text: 'Le nouveau store sera ajouté à votre sélecteur immédiatement.' },
                    { icon: Globe2, title: 'Paramètres locaux', text: 'Pays, fuseau horaire et devise pour garder des données cohérentes.' },
                  ].map((item) => {
                    const Icon = item.icon
                    return (
                      <div key={item.title} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl border border-jisra-green/20 bg-jisra-green/10 p-2 text-jisra-green-light">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-jisra-cream">{item.title}</p>
                            <p className="mt-1 text-sm text-jisra-cream/55">{item.text}</p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <form onSubmit={handleCreateStore} className="p-6 sm:p-8">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Nom du store" value={form.storeName} onChange={(v) => handleChange('storeName', v)} placeholder="Nouveau store" />
                  <SelectField label="Domaine d'activité" value={form.category} onChange={(v) => handleChange('category', v)} options={categories} />
                  <Field label="Website" value={form.website} onChange={(v) => handleChange('website', v)} placeholder="https://votresite.com" required={false} />
                  <Field label="Pays" value={form.country} onChange={(v) => handleChange('country', v.toUpperCase())} placeholder="MA" />
                  <SelectField label="Time zone" value={form.timezone} onChange={(v) => handleChange('timezone', v)} options={timezones} />
                  <Field label="Devise" value={form.currency} onChange={(v) => handleChange('currency', v.toUpperCase())} placeholder="MAD" />
                  <LogoUploadField
                    uploading={uploadingLogo}
                    logoUrl={form.logoUrl}
                    onFileChange={handleLogoUpload}
                  />
                </div>

                {createError ? <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{createError}</div> : null}

                <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
                  <p className="text-xs leading-5 text-jisra-cream/45">
                    Le store sera ajouté à votre espace et sélectionné automatiquement après création.
                  </p>
                  <button
                    type="submit"
                    disabled={createStoreMutation.isPending || uploadingLogo}
                    className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-xl bg-jisra-green px-5 py-3 text-sm font-semibold text-white transition hover:bg-jisra-green-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {createStoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    <span>{createStoreMutation.isPending ? 'Création...' : 'Créer le store'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

function LogoUploadField({
  uploading,
  logoUrl,
  onFileChange,
}: {
  uploading: boolean
  logoUrl: string
  onFileChange: (file: File | null) => Promise<void>
}) {
  return (
    <label className="space-y-1.5 text-sm text-jisra-cream/95 sm:col-span-2">
      <span>Logo</span>
      <div className="rounded-xl border border-white/15 bg-white/[0.06] p-3">
        <div className="relative flex h-24 w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/20 bg-black/20">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo store" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}

          <input
            type="file"
            accept="image/*"
            onChange={(e) => void onFileChange(e.target.files?.[0] || null)}
            className="absolute inset-0 z-10 cursor-pointer opacity-0"
          />

          <div className="relative z-0 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          </div>
        </div>
      </div>
    </label>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = true,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  required?: boolean
}) {
  return (
    <label className="space-y-1.5 text-sm text-jisra-cream/95">
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm text-white placeholder:text-jisra-cream/45 outline-none transition focus:border-jisra-green/40 focus:ring-1 focus:ring-jisra-green/30"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <label className="space-y-1.5 text-sm text-jisra-cream/95">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm text-white outline-none transition focus:border-jisra-green/40 focus:ring-1 focus:ring-jisra-green/30"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#101613] text-jisra-cream">
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}
