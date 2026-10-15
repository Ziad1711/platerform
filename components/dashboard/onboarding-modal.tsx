'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles, Store, Globe2, Building2, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useStore } from '@/lib/store-context'
import { describeQuotaError } from '@/lib/billing/quota'

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

export default function OnboardingModal() {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const { userId, authReady, accessibleStores, isStoresLoading, storesError } = useStore()
  // Les magasins viennent du contexte (bootstrap serveur, puis revalidation) :
  // aucune redétection n'est relancée ici.
  const hasStores = accessibleStores.length > 0
  const [checking, setChecking] = useState(true)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Une seule évaluation par (utilisateur, décision magasins) : évite de rejouer
  // les appels secondaires à chaque revalidation du contexte.
  const evaluatedRef = useRef('')
  // Décision impossible (recherche d'invitation indisponible ou illisible) : un
  // réessai explicite est proposé, jamais un formulaire de création ouvert à tort.
  const [decisionError, setDecisionError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [form, setForm] = useState({
    category: categories[0],
    storeName: '',
    logoUrl: '',
    website: '',
    country: 'MA',
    timezone: 'Africa/Casablanca',
    currency: 'MAD',
  })

  useEffect(() => {
    if (!authReady || !userId) return
    // Tant que les accès ne sont pas confirmés (chargement ou erreur), aucune
    // décision d'onboarding n'est prise : une erreur n'est pas « aucun magasin ».
    if (isStoresLoading || storesError) return

    const evaluationKey = `${userId}:${hasStores ? 'stores' : 'none'}`
    if (evaluatedRef.current === evaluationKey) return

    // Une nouvelle tentative démarre : l'avertissement précédent est levé.
    setDecisionError(false)

    let active = true

    const load = async () => {
      // L'évaluation n'est acquise qu'une fois une décision RÉELLEMENT prise :
      // une exécution interrompue (Strict Mode, changement de dépendance) ou une
      // recherche d'invitation en échec ne doit jamais bloquer les suivantes.
      let decided = false
      try {
        const [geoResponse] = await Promise.all([
          fetch('/api/geo', { cache: 'no-store' }).catch(() => null),
        ])

        if (!active) return

        await fetch('/api/auth/finalize-profile', { method: 'POST' }).catch(() => null)
        if (!active) return

        const [profileResponse, pendingRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('company, country, timezone, main_currency, preferred_currency')
            .eq('id', userId)
            .maybeSingle(),
          fetch('/api/team/invitations/pending', { cache: 'no-store' }).catch(() => null),
        ])

        if (!active) return

        // Ne pas afficher l'onboarding si la recherche d'invitation échoue : une
        // réponse indisponible ou illisible ne vaut PAS « aucune invitation ».
        if (!pendingRes?.ok) throw new Error('INVITATION_LOOKUP_FAILED')
        const rawPayload: unknown = await pendingRes.json().catch(() => null)
        if (!active) return
        // Contrat de la route : `{ invitation: null }` ou une invitation portant un
        // token non vide. Toute autre forme est illisible et doit être réessayée.
        if (
          !rawPayload ||
          typeof rawPayload !== 'object' ||
          Array.isArray(rawPayload) ||
          !('invitation' in rawPayload)
        ) {
          throw new Error('INVITATION_LOOKUP_FAILED')
        }
        const rawInvitation = (rawPayload as { invitation: unknown }).invitation
        let pendingToken: string | null = null
        if (rawInvitation !== null) {
          const token =
            typeof rawInvitation === 'object' && rawInvitation !== null
              ? (rawInvitation as { token?: unknown }).token
              : undefined
          if (typeof token !== 'string' || token.length === 0) {
            throw new Error('INVITATION_LOOKUP_FAILED')
          }
          pendingToken = token
        }

        if (pendingToken) {
          decided = true
          setChecking(false)
          router.push('/invite/' + pendingToken)
          return
        }

        // Un magasin confirmé (y compris créé ailleurs) ferme l'onboarding.
        if (hasStores) {
          decided = true
          setOpen(false)
          return
        }

        const profile = profileResponse.data
        const geo = geoResponse && geoResponse.ok ? await geoResponse.json() : null
        if (!active) return

        setForm((prev) => ({
          ...prev,
          country: profile?.country || geo?.country || prev.country,
          timezone: profile?.timezone || geo?.timezone || prev.timezone,
          currency: profile?.preferred_currency || profile?.main_currency || geo?.currency || prev.currency,
        }))

        // Ne pas ouvrir si l'utilisateur a déjà cliqué sur "Je le ferai après"
        const skipped = typeof window !== 'undefined' && window.localStorage.getItem('onboarding_skipped') === 'true'
        setOpen(!skipped)
        decided = true
      } catch {
        // Décision impossible : aucun formulaire n'est ouvert, un réessai explicite
        // est proposé et l'évaluation n'est PAS marquée comme acquise.
        if (active) setDecisionError(true)
      } finally {
        if (active) {
          if (decided) evaluatedRef.current = evaluationKey
          setChecking(false)
        }
      }
    }

    load()
    return () => {
      active = false
    }
  }, [supabase, userId, authReady, isStoresLoading, storesError, hasStores, router, retryKey])

  // Le formulaire n'est affiché que si l'absence de magasin est CONFIRMÉE : un
  // magasin apparu ailleurs (création, invitation acceptée) ferme immédiatement
  // l'onboarding, sans attendre les appels secondaires ni une recherche
  // d'invitation qui pourrait échouer.
  const canShow = useMemo(
    () => !checking && open && !hasStores && !isStoresLoading && !storesError && !decisionError,
    [checking, open, hasStores, isStoresLoading, storesError, decisionError],
  )

  // Décision impossible : un bandeau discret propose de réessayer, plutôt que
  // d'afficher un formulaire de création potentiellement injustifié.
  if (decisionError && !hasStores) {
    return (
      <div className="fixed bottom-4 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs font-medium text-amber-600 shadow-sm">
        <span>Vérification de vos invitations impossible pour le moment.</span>
        <button
          type="button"
          onClick={() => {
            setDecisionError(false)
            setChecking(true)
            setRetryKey((key) => key + 1)
          }}
          className="underline underline-offset-2 hover:opacity-80"
        >
          Réessayer
        </button>
      </div>
    )
  }

  const handleChange = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleLogoUpload = async (file: File | null) => {
    if (!file) return

    setUploadingLogo(true)
    setError(null)

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
    } catch (err: any) {
      setError(err.message || 'Upload logo impossible')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (!form.storeName.trim()) throw new Error('Le nom du store est requis')
      if (form.currency.trim().length !== 3) throw new Error('La devise doit contenir 3 lettres')

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
        throw new Error(describeQuotaError(payload.error) || payload.error || 'STORE_CREATE_FAILED')
      }

      setOpen(false)
      window.location.href = '/dashboard'
    } catch (err: any) {
      setError(err.message || 'Une erreur est survenue')
    } finally {
      setLoading(false)
    }
  }

  if (!canShow) return null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
      <div className="absolute inset-0" />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-[24px] border border-white/10 bg-[#101613] shadow-[0_30px_120px_rgba(0,0,0,0.45)]">

        <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
          <div className="border-b border-white/10 bg-white/[0.03] p-6 lg:border-b-0 lg:border-r lg:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-jisra-green/20 bg-jisra-green/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-jisra-green-light">
              <Sparkles className="h-3.5 w-3.5" />
              onboarding
            </div>
            <h2 className="mt-5 text-2xl font-bold text-white">Terminez la configuration de votre business</h2>
            <p className="mt-3 text-sm leading-6 text-jisra-cream/85">
              Une dernière étape pour préparer votre store, la devise par défaut et votre environnement de travail.
            </p>

            <div className="mt-8 space-y-4">
              {[
                { icon: Building2, title: 'Business prêt', text: 'Nom business + domaine d’activité pour une base propre.' },
                { icon: Store, title: 'Store principal', text: 'Nom du store utilisé immédiatement dans votre dashboard.' },
                { icon: Globe2, title: 'Paramètres locaux', text: 'Pays, fuseau et devise préremplis automatiquement.' },
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

          <form onSubmit={handleSubmit} className="p-6 sm:p-8">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom du store" value={form.storeName} onChange={(v) => handleChange('storeName', v)} placeholder="Store principal" />
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

            {error ? <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">{error}</div> : null}

            <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  try { localStorage.setItem('onboarding_skipped', 'true') } catch {}
                  window.location.href = '/dashboard'
                }}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-jisra-cream/60 transition hover:border-white/30 hover:text-jisra-cream/90"
              >
                Je le ferai après
              </button>
              <button
                type="submit"
                disabled={loading || uploadingLogo}
                className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-xl bg-jisra-green px-5 py-3 text-sm font-semibold text-white transition hover:bg-jisra-green-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                <span>{loading ? 'Création...' : 'Créer mon store'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
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
    <label className="space-y-1.5 text-sm text-jisra-cream/95">
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