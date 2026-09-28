'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, RefreshCcw, Settings2, ShieldAlert, User2, Loader2, Trash2, Upload, Building2, Users, PhoneCall, FileText, ChevronLeft, ChevronRight, CreditCard, type LucideIcon } from 'lucide-react'
import { JisraMark } from '@/components/logo'
import StoresSection from '@/components/settings/stores-section'
import TeamSection from '@/components/settings/team-section'
import ConfirmationSettingsSection from '@/components/settings/confirmation-settings-section'
import InvoicingSettingsSection from '@/components/settings/invoicing-settings-section'
import JisraBillingSection from '@/components/settings/jisra-billing-section'
import { useTheme } from '@/components/providers'
import { createClient } from '@/lib/supabase/client'

const currencies = ['MAD', 'USD', 'EUR', 'GBP', 'CAD', 'NZD', 'AED']
const blacklistStatuses = [
  { value: 'returned_not_stocked', label: 'Retour non stocké' },
  { value: 'returned_stocked', label: 'Retour stocké' },
  { value: 'refused', label: 'Refusée' },
  { value: 'cancelled', label: 'Annulée' },
]

type SettingsSectionId =
  | 'personal'
  | 'security'
  | 'preferences'
  | 'rates'
  | 'blacklist'
  | 'confirmation'
  | 'invoicing'
  | 'jisra-billing'
  | 'stores'
  | 'team'

type SettingsSection = {
  id: SettingsSectionId
  label: string
  description: string
  icon: LucideIcon
}

const SECTION_GROUPS: { label: string; items: SettingsSection[] }[] = [
  {
    label: 'Compte',
    items: [
      { id: 'personal', label: 'Informations personnelles', description: 'Nom, photo de profil et coordonnées', icon: User2 },
      { id: 'security', label: 'Sécurité', description: 'Mot de passe et accès au compte', icon: Lock },
      { id: 'preferences', label: 'Préférences', description: 'Devise, langue, fuseau horaire et thème', icon: Settings2 },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { id: 'rates', label: 'Taux de change', description: 'Conversions entre vos devises', icon: RefreshCcw },
      { id: 'blacklist', label: 'Blacklist', description: 'Blocage automatique des clients à risque', icon: ShieldAlert },
      { id: 'confirmation', label: 'Confirmation', description: "Tentatives d'appel et commission", icon: PhoneCall },
    ],
  },
  {
    label: 'Facturation',
    items: [
      { id: 'invoicing', label: 'Factures clients', description: 'Identité légale, TVA et mentions de vos factures clients', icon: FileText },
      { id: 'jisra-billing', label: 'Facturation Jisra', description: 'Votre abonnement, votre quota de commandes et vos crédits IA du mois', icon: CreditCard },
    ],
  },
  {
    label: 'Organisation',
    items: [
      { id: 'stores', label: 'Stores', description: 'Créer et configurer vos boutiques', icon: Building2 },
      { id: 'team', label: 'Équipe', description: 'Invitations et rôles des membres', icon: Users },
    ],
  },
]

const SECTIONS: SettingsSection[] = SECTION_GROUPS.flatMap((group) => group.items)

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
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('personal')
  const [mobilePane, setMobilePane] = useState<'list' | 'detail'>('list')

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

  const activeSectionLabel = SECTIONS.find((entry) => entry.id === activeSection)?.label ?? 'Paramètres'

  const selectSection = (id: SettingsSectionId) => {
    setActiveSection(id)
    setMobilePane('detail')
    if (typeof window !== 'undefined') {
      document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const navItemClass = (id: SettingsSectionId) =>
    `relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${
      activeSection === id
        ? 'bg-primary/10 font-semibold text-primary'
        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
    }`

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-3 pb-8 pt-16 sm:px-4 lg:px-6 lg:pt-6">
      <div className="flex flex-col items-center md:items-start gap-1">
        <div className="flex items-center gap-2">
          <JisraMark size={28} />
          <span className="text-lg font-bold text-[#1fa971] bg-[#1fa971]/10 px-3 py-1 rounded-full">
            Paramètres
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Gérez votre profil, sécurité, préférences, taux de change et blacklist globale appliquée à tous vos stores.
        </p>
      </div>
      <div className="space-y-6">
        {message ? (
          <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm ${
            message.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            {message.type === 'success' ? (
              <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            ) : (
              <svg className="h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            )}
            <span>{message.text}</span>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[264px_minmax(0,1fr)] lg:items-start">
          <aside className="hidden lg:sticky lg:top-6 lg:block">
            <nav className="space-y-5 rounded-2xl border bg-card p-4 shadow-sm">
              {SECTION_GROUPS.map((group) => (
                <div key={group.label} className="space-y-1">
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">{group.label}</p>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectSection(item.id)}
                      aria-current={activeSection === item.id ? 'page' : undefined}
                      className={navItemClass(item.id)}
                    >
                      {activeSection === item.id ? (
                        <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                      ) : null}
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </aside>

          <div className={mobilePane === 'list' ? 'lg:hidden' : 'hidden'}>
            <nav className="space-y-2">
              {SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectSection(item.id)}
                  className="flex w-full items-center gap-3 rounded-2xl border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <item.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </nav>
          </div>

          <div className={`space-y-4 ${mobilePane === 'list' ? 'hidden lg:block' : ''}`}>
            <div className="flex items-center gap-3 lg:hidden">
              <button
                type="button"
                onClick={() => setMobilePane('list')}
                className="inline-flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                Retour aux paramètres
              </button>
              <span className="ml-auto truncate text-sm font-medium text-foreground">{activeSectionLabel}</span>
            </div>
            {activeSection === 'personal' && <section id="personal" className="rounded-2xl border bg-card p-6 scroll-mt-32">
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
            </section>}

            {activeSection === 'security' && <section id="security" className="rounded-2xl border bg-card p-6 scroll-mt-32">
            <h2 className="text-lg font-semibold">Sécurité</h2>
            <p className="mt-2 text-sm text-muted-foreground">Envoyer un email Supabase pour définir un nouveau mot de passe de manière sécurisée.</p>
            <button onClick={sendResetPassword} disabled={savingKey === 'security'} className="mt-4 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-secondary">{savingKey === 'security' ? 'Envoi...' : 'Modifier le mot de passe'}</button>
            </section>}

            {activeSection === 'preferences' && <section id="preferences" className="rounded-2xl border bg-card p-6 scroll-mt-32">
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
            </section>}

            {activeSection === 'rates' && <section id="rates" className="rounded-2xl border bg-card p-6 scroll-mt-32">
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
            </section>}

             {activeSection === 'blacklist' && <section id="blacklist" className="rounded-2xl border bg-card p-6 scroll-mt-32">
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
             </section>}

             {activeSection === 'confirmation' && <ConfirmationSettingsSection />}
             {activeSection === 'invoicing' && <InvoicingSettingsSection />}
             {activeSection === 'jisra-billing' && <JisraBillingSection />}
             {activeSection === 'stores' && <StoresSection />}
             {activeSection === 'team' && <TeamSection />}
           </div>
        </div>
      </div>
    </div>
  )
}