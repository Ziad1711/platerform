'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, RefreshCcw, Settings2, ShieldAlert, User2, Loader2, Trash2, Upload, Building2, Users } from 'lucide-react'
import { JisraMark } from '@/components/logo'
import StoresSection from '@/components/settings/stores-section'
import TeamSection from '@/components/settings/team-section'
import { useTheme } from '@/components/providers'
import { createClient } from '@/lib/supabase/client'

const currencies = ['MAD', 'USD', 'EUR', 'GBP', 'CAD', 'NZD', 'AED']
const blacklistStatuses = [
  { value: 'returned_not_stocked', label: 'Retour non stocké' },
  { value: 'returned_stocked', label: 'Retour stocké' },
  { value: 'refused', label: 'Refusée' },
  { value: 'cancelled', label: 'Annulée' },
]

async function toJson(res: Response) {
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error || 'REQUEST_FAILED')
  return payload
}

function AvatarUpload({
  avatarUrl,
  onUpload,
  onDelete,
  uploading,
}: {
  avatarUrl: string | null
  onUpload: (file: File) => Promise<void>
  onDelete: () => Promise<void>
  uploading: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onUpload(file)
      e.target.value = ''
    }
  }

  const initials = 'U'

  return (
    <div className="mt-4 flex items-center gap-5">
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-border">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-lg font-semibold text-muted-foreground">
            {initials}
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {avatarUrl ? 'Changer la photo' : 'Ajouter une photo'}
        </button>
        {avatarUrl && (
          <button
            type="button"
            onClick={onDelete}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Supprimer
          </button>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { setTheme } = useTheme()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', country: '' })
  const [preferencesForm, setPreferencesForm] = useState({ preferredCurrency: 'MAD', language: 'fr', timezone: 'Africa/Casablanca', themePreference: 'system' })
  const [rateForm, setRateForm] = useState({ baseCurrency: 'MAD', targetCurrency: 'USD', rate: '' })
  const [blacklistForm, setBlacklistForm] = useState({ isEnabled: true, maxStatusHits: 3, statusFilters: ['returned_not_stocked', 'returned_stocked'] as string[] })
  const [savingKey, setSavingKey] = useState('')
  const [activeSection, setActiveSection] = useState('personal')

  // Scrollspy logic
  useEffect(() => {
    const sections = ['personal', 'security', 'preferences', 'rates', 'blacklist', 'stores', 'team']
    const observerOptions = {
      root: null,
      rootMargin: '-10% 0px -80% 0px',
      threshold: 0
    }

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id)
        }
      })
    }

    const observer = new IntersectionObserver(observerCallback, observerOptions)
    sections.forEach(id => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    })

    return () => observer.disconnect()
  }, [])

  const { data: profilePayload } = useQuery({
    queryKey: ['settings-profile'],
    queryFn: async () => toJson(await fetch('/api/settings/profile')),
  })

  const { data: preferencesPayload } = useQuery({
    queryKey: ['settings-preferences'],
    queryFn: async () => toJson(await fetch('/api/settings/preferences')),
  })

  const { data: ratesPayload } = useQuery({
    queryKey: ['settings-exchange-rates'],
    queryFn: async () => toJson(await fetch('/api/settings/exchange-rates')),
  })

  const { data: blacklistPayload } = useQuery({
    queryKey: ['settings-blacklist-rule'],
    queryFn: async () => toJson(await fetch('/api/settings/blacklist-rule')),
  })

  useEffect(() => {
    const profile = profilePayload?.profile
    if (profile) {
      setProfileForm({
        firstName: profile.first_name || '',
        lastName: profile.last_name || '',
        country: profile.country || '',
      })
    }
  }, [profilePayload])

  useEffect(() => {
    const preferences = preferencesPayload?.preferences
    if (preferences) {
      setPreferencesForm({
        preferredCurrency: preferences.preferred_currency || 'MAD',
        language: preferences.language || 'fr',
        timezone: preferences.timezone || 'Africa/Casablanca',
        themePreference: preferences.theme_preference || 'system',
      })
    }
  }, [preferencesPayload])

  useEffect(() => {
    const rule = blacklistPayload?.rule
    if (rule) {
      setBlacklistForm({
        isEnabled: rule.is_enabled !== false,
        maxStatusHits: Number(rule.max_status_hits || 3),
        statusFilters: Array.isArray(rule.status_filters) ? rule.status_filters : ['returned_not_stocked', 'returned_stocked'],
      })
    }
  }, [blacklistPayload])

  async function saveProfile() {
    setSavingKey('profile')
    setMessage(null)
    try {
      await toJson(await fetch('/api/settings/profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileForm),
      }))
      await queryClient.invalidateQueries({ queryKey: ['settings-profile'] })
      setMessage({ type: 'success', text: 'Informations personnelles mises à jour.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'PROFILE_SAVE_FAILED' })
    } finally { setSavingKey('') }
  }

  async function savePreferences() {
    setSavingKey('preferences')
    setMessage(null)
    try {
      await toJson(await fetch('/api/settings/preferences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferencesForm),
      }))
      await queryClient.invalidateQueries({ queryKey: ['settings-preferences'] })
      
      if (preferencesForm.themePreference === 'light' || preferencesForm.themePreference === 'dark' || preferencesForm.themePreference === 'system') {
        setTheme(preferencesForm.themePreference as any)
      }

      setMessage({ type: 'success', text: 'Préférences enregistrées.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'PREFERENCES_SAVE_FAILED' })
    } finally { setSavingKey('') }
  }

  async function sendResetPassword() {
    setSavingKey('security')
    setMessage(null)
    try {
      await toJson(await fetch('/api/settings/security/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: window.location.origin }),
      }))
      setMessage({ type: 'success', text: 'Email de réinitialisation envoyé.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'PASSWORD_RESET_FAILED' })
    } finally { setSavingKey('') }
  }

  async function saveRate() {
    setSavingKey('rate')
    setMessage(null)
    try {
      await toJson(await fetch('/api/settings/exchange-rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rateForm, rate: Number(rateForm.rate) }),
      }))
      await queryClient.invalidateQueries({ queryKey: ['settings-exchange-rates'] })
      setRateForm((current) => ({ ...current, rate: '' }))
      setMessage({ type: 'success', text: 'Taux de change ajouté.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'RATE_SAVE_FAILED' })
    } finally { setSavingKey('') }
  }

  async function saveBlacklistRule() {
    setSavingKey('blacklist')
    setMessage(null)
    try {
      await toJson(await fetch('/api/settings/blacklist-rule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blacklistForm),
      }))
      await queryClient.invalidateQueries({ queryKey: ['settings-blacklist-rule'] })
      setMessage({ type: 'success', text: 'Configuration blacklist enregistrée.' })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'BLACKLIST_SAVE_FAILED' })
    } finally { setSavingKey('') }
  }

  const navItemClass = (id: string) =>
    `flex items-center gap-2 rounded-lg px-3 py-2 transition-colors ${
      activeSection === id
        ? 'bg-primary text-primary-foreground font-medium'
        : 'hover:bg-secondary text-muted-foreground'
    }`

  return (
    <div className="space-y-6 pb-4 sm:pb-6 lg:pb-8">
      <div className="flex flex-col items-center sm:items-start gap-1 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Paramètres
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Gérez votre profil, sécurité, préférences, taux de change et blacklist globale
        </p>
      </div>
      <div className="sticky top-0 z-30 border-b bg-background/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="hidden">
            <h1 className="text-3xl font-bold text-foreground">Paramètres</h1>
            <p className="mt-1 text-sm text-muted-foreground">Gérez votre profil, sécurité, préférences, taux de change et blacklist globale appliquée à tous vos stores.</p>
          </div>
          <div className="flex wrap items-center gap-3">
            <div className="rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">Dernière mise à jour: maintenant</div>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-6 lg:px-8">
        {message ? <div className={`rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'}`}>{message.text}</div> : null}

        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="rounded-2xl border bg-card p-4 lg:sticky lg:top-[88px] lg:h-fit">
          <div className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Navigation</div>
          <div className="space-y-2 text-sm">
           <a href="#personal" className={navItemClass('personal')}><User2 className="h-4 w-4" /> Informations personnelles</a>
             <a href="#security" className={navItemClass('security')}><Lock className="h-4 w-4" /> Sécurité</a>
             <a href="#preferences" className={navItemClass('preferences')}><Settings2 className="h-4 w-4" /> Préférences</a>
             <a href="#rates" className={navItemClass('rates')}><RefreshCcw className="h-4 w-4" /> Taux de change</a>
             <a href="#blacklist" className={navItemClass('blacklist')}><ShieldAlert className="h-4 w-4" /> Blacklist</a>
             <a href="#stores" className={navItemClass('stores')}><Building2 className="h-4 w-4" /> Stores</a>
             <a href="#team" className={navItemClass('team')}><Users className="h-4 w-4" /> Équipe</a>
          </div>
          </aside>

          <div className="space-y-6">
            <section id="personal" className="rounded-2xl border bg-card p-6 scroll-mt-32">
            <h2 className="text-lg font-semibold">Informations personnelles</h2>

            {/* Avatar */}
            <AvatarUpload
              avatarUrl={profilePayload?.profile?.avatar_url || null}
              onUpload={async (file) => {
                setSavingKey('avatar')
                setMessage(null)
                try {
                  const formData = new FormData()
                  formData.append('file', file)
                  const res = await fetch('/api/settings/profile/avatar', { method: 'POST', body: formData })
                  const data = await toJson(res)
                  await queryClient.invalidateQueries({ queryKey: ['settings-profile'] })
                  setMessage({ type: 'success', text: 'Photo de profil mise à jour.' })
                } catch (error) {
                  setMessage({ type: 'error', text: error instanceof Error ? error.message : 'AVATAR_UPLOAD_FAILED' })
                } finally { setSavingKey('') }
              }}
              onDelete={async () => {
                setSavingKey('avatar')
                setMessage(null)
                try {
                  await toJson(await fetch('/api/settings/profile/avatar', { method: 'DELETE' }))
                  await queryClient.invalidateQueries({ queryKey: ['settings-profile'] })
                  setMessage({ type: 'success', text: 'Photo de profil supprimée.' })
                } catch (error) {
                  setMessage({ type: 'error', text: error instanceof Error ? error.message : 'AVATAR_DELETE_FAILED' })
                } finally { setSavingKey('') }
              }}
              uploading={savingKey === 'avatar'}
            />

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Prénom</label>
                <input value={profileForm.firstName} onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })} placeholder="Prénom" className="w-full rounded-xl border bg-background px-4 py-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Nom</label>
                <input value={profileForm.lastName} onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })} placeholder="Nom" className="w-full rounded-xl border bg-background px-4 py-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Email</label>
                <input value={profilePayload?.email || ''} disabled placeholder="Email" className="w-full rounded-xl border bg-muted px-4 py-3 text-sm" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Pays</label>
                <input value={profileForm.country} onChange={(e) => setProfileForm({ ...profileForm, country: e.target.value })} placeholder="Pays" className="w-full rounded-xl border bg-background px-4 py-3 text-sm" />
              </div>
            </div>
            <button onClick={saveProfile} disabled={savingKey === 'profile'} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{savingKey === 'profile' ? 'Enregistrement...' : 'Enregistrer'}</button>
            </section>

            <section id="security" className="rounded-2xl border bg-card p-6 scroll-mt-32">
            <h2 className="text-lg font-semibold">Sécurité</h2>
            <p className="mt-2 text-sm text-muted-foreground">Envoyer un email Supabase pour définir un nouveau mot de passe de manière sécurisée.</p>
            <button onClick={sendResetPassword} disabled={savingKey === 'security'} className="mt-4 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-secondary">{savingKey === 'security' ? 'Envoi...' : 'Modifier le mot de passe'}</button>
            </section>

            <section id="preferences" className="rounded-2xl border bg-card p-6 scroll-mt-32">
            <h2 className="text-lg font-semibold">Préférences</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Devise préférée</label>
                <select value={preferencesForm.preferredCurrency} onChange={(e) => setPreferencesForm({ ...preferencesForm, preferredCurrency: e.target.value })} className="w-full rounded-xl border bg-background px-4 py-3 text-sm">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Mode d'affichage</label>
                <select value={preferencesForm.themePreference} onChange={(e) => setPreferencesForm({ ...preferencesForm, themePreference: e.target.value })} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"><option value="system">Thème système</option><option value="light">Clair</option><option value="dark">Sombre</option></select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Langue</label>
                <select value={preferencesForm.language} onChange={(e) => setPreferencesForm({ ...preferencesForm, language: e.target.value })} className="w-full rounded-xl border bg-background px-4 py-3 text-sm"><option value="fr">Français</option><option value="en">English</option></select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Fuseau horaire</label>
                <input value={preferencesForm.timezone} onChange={(e) => setPreferencesForm({ ...preferencesForm, timezone: e.target.value })} className="w-full rounded-xl border bg-background px-4 py-3 text-sm" />
              </div>
            </div>
            <button onClick={savePreferences} disabled={savingKey === 'preferences'} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{savingKey === 'preferences' ? 'Enregistrement...' : 'Sauvegarder les préférences'}</button>
            </section>

            <section id="rates" className="rounded-2xl border bg-card p-6 scroll-mt-32">
            <h2 className="text-lg font-semibold">Taux de change</h2>
            <p className="mt-2 text-sm text-muted-foreground">Ajoutez vos conversions pour piloter les montants entre votre devise locale et les devises étrangères.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Source</label>
                <select value={rateForm.baseCurrency} onChange={(e) => setRateForm({ ...rateForm, baseCurrency: e.target.value })} className="w-full rounded-xl border bg-background px-4 py-3 text-sm">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Cible</label>
                <select value={rateForm.targetCurrency} onChange={(e) => setRateForm({ ...rateForm, targetCurrency: e.target.value })} className="w-full rounded-xl border bg-background px-4 py-3 text-sm">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Taux</label>
                <input value={rateForm.rate} onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })} placeholder="Ex: 10.5" className="w-full rounded-xl border bg-background px-4 py-3 text-sm" />
              </div>
              <div className="flex items-end">
                <button onClick={saveRate} disabled={savingKey === 'rate'} className="w-full h-[46px] rounded-xl border px-4 text-sm font-medium hover:bg-secondary transition-colors">{savingKey === 'rate' ? 'Ajout...' : 'Ajouter'}</button>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(ratesPayload?.rates || []).slice(0, 8).map((rate: any) => (
                <div key={rate.id} className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                  <div>
                    <div>{rate.base_currency} → {rate.target_currency}</div>
                    <div className="text-xs text-muted-foreground">{rate.rate_date}</div>
                  </div>
                  <div className="font-medium">{rate.rate}</div>
                </div>
              ))}
            </div>
            </section>

             <section id="blacklist" className="rounded-2xl border bg-card p-6 scroll-mt-32">
             <h2 className="text-lg font-semibold">Blacklist configuration</h2>
             <p className="mt-2 text-sm text-muted-foreground">Cette configuration est définie au niveau utilisateur et sera appliquée à tous vos stores.</p>
             <div className="mt-4 space-y-4">
               <label className="flex items-center justify-between rounded-xl border px-4 py-3 text-sm">
                 <span className="font-medium">Activer la blacklist automatique</span>
                 <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary" checked={blacklistForm.isEnabled} onChange={(e) => setBlacklistForm({ ...blacklistForm, isEnabled: e.target.checked })} />
               </label>
               <div className="space-y-1.5">
                 <label className="text-xs font-medium text-muted-foreground ml-1">Nombre maximum d'occurrences avant blacklist</label>
                 <input type="number" min={1} value={blacklistForm.maxStatusHits} onChange={(e) => setBlacklistForm({ ...blacklistForm, maxStatusHits: Number(e.target.value || 1) })} className="w-full rounded-xl border bg-background px-4 py-3 text-sm" />
               </div>
               <div className="space-y-2">
                 <label className="text-xs font-medium text-muted-foreground ml-1">Statuts à surveiller</label>
                 <div className="grid gap-2 md:grid-cols-2">
                   {blacklistStatuses.map((status) => (
                     <label key={status.value} className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm hover:bg-secondary/50 cursor-pointer transition-colors">
                       <input
                         type="checkbox"
                         className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                         checked={blacklistForm.statusFilters.includes(status.value)}
                         onChange={(e) => setBlacklistForm((current) => ({
                           ...current,
                           statusFilters: e.target.checked
                             ? [...current.statusFilters, status.value]
                             : current.statusFilters.filter((item) => item !== status.value),
                         }))}
                       />
                       <span>{status.label}</span>
                     </label>
                   ))}
                 </div>
               </div>
             </div>
             <button onClick={saveBlacklistRule} disabled={savingKey === 'blacklist'} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{savingKey === 'blacklist' ? 'Enregistrement...' : 'Sauvegarder la configuration'}</button>
             </section>

             <StoresSection />
             <TeamSection />
           </div>
        </div>
      </div>
    </div>
  )
}