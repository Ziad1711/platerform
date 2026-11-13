'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X, Loader2, Mail } from 'lucide-react'
import { isPublicAssistantHref, type PublicAssistantLink } from '@/lib/marketing/assistant/public-routes'

type Locale = 'fr' | 'ar' | 'ary' | 'en'
type Message = { role: 'user' | 'assistant'; content: string; links?: PublicAssistantLink[] }
const labels: Record<Locale, Record<string, string>> = {
  fr: { open: 'Discuter avec l’assistant Jisra', title: 'Assistant Jisra', welcome: 'Bonjour 👋 Je suis l’assistant IA de Jisra ! Je suis là pour répondre à vos questions sur notre plateforme, nos fonctionnalités et nos offres. Que souhaitez-vous savoir ?', placeholder: 'Votre question…', send: 'Envoyer', close: 'Fermer', contact: 'Demander un contact', contactTitle: 'Demande de contact humain', contactHint: 'Décrivez votre besoin (10 caractères minimum). Ne communiquez aucune donnée bancaire.', submit: 'Envoyer la demande', sent: 'Demande enregistrée. Notre équipe vous répondra par email.', error: 'Assistant momentanément indisponible. Consultez /pricing ou demandez un contact.', loading: 'L’assistant écrit…', offline: 'Mode local : le fournisseur IA n’est pas configuré. L’icône reste visible, mais les réponses réelles sont désactivées.' },
  ar: { open: 'تحدث مع مساعد جيسرا', title: 'مساعد جيسرا', welcome: 'مرحباً 👋 أنا مساعد جيسرا الذكي. أنا هنا للإجابة عن أسئلتك حول منصتنا وميزاتنا وعروضنا. ما الذي تودّ معرفته؟', placeholder: 'سؤالك…', send: 'إرسال', close: 'إغلاق', contact: 'طلب تواصل بشري', contactTitle: 'طلب تواصل بشري', contactHint: 'اشرح حاجتك (10 أحرف على الأقل). لا تشارك أي بيانات بنكية.', submit: 'إرسال الطلب', sent: 'تم تسجيل طلبك. سيتواصل معك فريقنا.', error: 'المساعد غير متاح حالياً. راجع صفحة الأسعار أو اطلب تواصلاً.', loading: 'المساعد يكتب…', offline: 'وضع محلي: مزوّد الذكاء الاصطناعي غير مُهيّأ. تبقى الأيقونة ظاهرة، لكن الردود الحقيقية معطّلة.' },
  ary: { open: 'هدر مع مساعد جيسرا', title: 'مساعد جيسرا', welcome: 'أهلا 👋 أنا مساعد جيسرا الذكي. أنا هنا باش نجاوبك على الأسئلة على المنصة، الميزات والعروض. شنو بغيتي تعرف؟', placeholder: 'السؤال ديالك…', send: 'صيفط', close: 'سد', contact: 'طلب تواصل مع بنادم', contactTitle: 'طلب تواصل بشري', contactHint: 'شرح لينا شنو بغيتي (10 حروف على الأقل). ما تعطينا حتى معلومة بنكية.', submit: 'صيفط الطلب', sent: 'تسجل الطلب ديالك. الفريق غادي يتواصل معاك.', error: 'المساعد ما متوفرش دابا. شوف الأسعار ولا طلب تواصل.', loading: 'المساعد كيكتب…', offline: 'وضع محلي: مزوّد الذكاء الاصطناعي ما مهيّأش. الأيقونة كتبان، ولكن الردود الحقيقية معطّلة.' },
  en: { open: 'Chat with the Jisra assistant', title: 'Jisra assistant', welcome: "Hello 👋 I'm Jisra's AI assistant! I'm here to answer your questions about our platform, features and plans. What would you like to know?", placeholder: 'Your question…', send: 'Send', close: 'Close', contact: 'Request a human contact', contactTitle: 'Human contact request', contactHint: 'Describe your need (at least 10 characters). Do not share banking details.', submit: 'Send request', sent: 'Request recorded. Our team will reply by email.', error: 'Assistant temporarily unavailable. See /pricing or request a contact.', loading: 'The assistant is writing…', offline: 'Local mode: the AI provider is not configured. The icon stays visible, but real replies are disabled.' },
}

const linkLabels: Record<Locale, Record<string, string>> = {
  fr: { '/pricing': 'Voir les tarifs', '/signup': 'Créer un compte', '/login': 'Se connecter', '/subscribe': 'Récapitulatif', '/contact': 'Contact', '/catalogue-integrations': 'Intégrations', '/features': 'Fonctionnalités', '/documentation': 'Documentation API' },
  en: { '/pricing': 'View plans', '/signup': 'Create an account', '/login': 'Sign in', '/subscribe': 'Subscription summary', '/contact': 'Contact', '/catalogue-integrations': 'Integrations', '/features': 'Features', '/documentation': 'API documentation' },
  ar: { '/pricing': 'عرض الأسعار', '/signup': 'إنشاء حساب', '/login': 'تسجيل الدخول', '/subscribe': 'ملخص الاشتراك', '/contact': 'تواصل', '/catalogue-integrations': 'التكاملات', '/features': 'الميزات', '/documentation': 'توثيق API' },
  ary: { '/pricing': 'شوف الأثمنة', '/signup': 'دير حساب', '/login': 'دخول', '/subscribe': 'ملخص الاشتراك', '/contact': 'تواصل', '/catalogue-integrations': 'التكاملات', '/features': 'الميزات', '/documentation': 'توثيق API' },
}

/** Langue du navigateur : FR/EN/AR, avec ar-MA interprété comme darija. Repli français. */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'fr'
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const value of languages) {
    const tag = String(value || '').toLowerCase()
    if (tag.startsWith('ar')) return tag.includes('-ma') ? 'ary' : 'ar'
    if (tag.startsWith('en')) return 'en'
    if (tag.startsWith('fr')) return 'fr'
  }
  return 'fr'
}

export function AssistantWidget({ initialOpen = false, available = true }: { initialOpen?: boolean; available?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [welcomeShown, setWelcomeShown] = useState(initialOpen)
  const [locale, setLocale] = useState<Locale>(() => detectBrowserLocale())
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [contactOpen, setContactOpen] = useState(false)
  const [contactState, setContactState] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const sendingRef = useRef(false)
  const t = labels[locale]
  // Darija latine reste LTR ; arabe (standard ou darija en caractères arabes) passe en RTL.
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')?.content || ''
  const arabicScript = /[\u0600-\u06FF]/.test(input) || /[\u0600-\u06FF]/.test(lastUser)
  const rtl = locale === 'ar' || (locale === 'ary' && (!lastUser || arabicScript))

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [messages, busy])

  async function submitMessage() {
    const text = input.trim()
    if (!text || !available || sendingRef.current) return
    sendingRef.current = true
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 1400) }))
    setMessages((current) => [...current, { role: 'user', content: text }])
    setInput(''); setBusy(true); setError('')
    try {
      const response = await fetch('/api/public-assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale, message: text, history }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t.error)
      const links: PublicAssistantLink[] = Array.isArray(result.links)
        ? result.links
            .filter((link: unknown): link is PublicAssistantLink => {
              if (!link || typeof link !== 'object') return false
              const candidate = link as { href?: unknown }
              return typeof candidate.href === 'string' && isPublicAssistantHref(candidate.href)
            })
            .map((link) => ({ href: link.href, label: typeof link.label === 'string' ? link.label : link.href }))
            .slice(0, 3)
        : []
      setMessages((current) => [...current, { role: 'assistant', content: result.reply, links }])
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.error) }
    finally { sendingRef.current = false; setBusy(false) }
  }
  function send(event: React.FormEvent) {
    event.preventDefault()
    void submitMessage()
  }
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    // Sur mobile, Enter garde le retour à la ligne ; l'envoi passe par le bouton.
    if (window.matchMedia('(max-width: 639px)').matches) return
    event.preventDefault()
    void submitMessage()
  }
  async function sendContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setContactState('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/public-assistant/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: form.get('message'), email: form.get('email') || undefined, preferredChannel: 'email', locale: locale === 'en' ? 'fr' : locale }),
    }).catch(() => null)
    setContactState(response?.ok ? t.sent : t.error)
    if (response?.ok) { (event.target as HTMLFormElement).reset(); setContactOpen(false) }
  }
  if (!open) return <button type="button" onClick={() => { setOpen(true); setWelcomeShown(true) }} aria-label={t.open}
    className="fixed bottom-20 right-4 z-[70] flex h-12 w-12 sm:bottom-[5.25rem] sm:right-6 items-center justify-center rounded-full bg-jisra-green text-white shadow-lg shadow-jisra-green/30 transition hover:bg-jisra-green-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-cream">
    <MessageCircle aria-hidden className="h-6 w-6" />
  </button>

  return <section dir={rtl ? 'rtl' : 'ltr'} lang={locale === 'ar' ? 'ar' : locale === 'ary' ? 'ar-MA' : locale} aria-label={t.title}
    className="fixed bottom-0 right-0 z-[80] flex h-[min(78dvh,560px)] w-full flex-col pb-[env(safe-area-inset-bottom)] border border-white/15 bg-jisra-ink-light text-jisra-cream shadow-2xl sm:bottom-6 sm:right-6 sm:w-[380px] sm:rounded-2xl">
    <header className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
      <p className="text-sm font-semibold">{t.title}</p>
      <div className="flex items-center gap-1">
        <select aria-label="Langue" value={locale} onChange={(event) => setLocale(event.target.value as Locale)} className="min-h-9 rounded-lg border border-white/15 bg-jisra-ink px-2 text-xs">
          <option value="fr">FR</option><option value="en">EN</option><option value="ar">العربية</option><option value="ary">Darija</option>
        </select>
        <button type="button" onClick={() => setOpen(false)} aria-label={t.close} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15"><X className="h-4 w-4" /></button>
      </div>
    </header>
    {!available && <p role="status" className="border-b border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">{t.offline}</p>}
    <div ref={listRef} role="log" aria-live="polite" aria-busy={busy} className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      {welcomeShown && <p data-testid="assistant-welcome" dir={locale === 'ar' || locale === 'ary' ? 'rtl' : 'ltr'} lang={locale === 'ar' ? 'ar' : locale === 'ary' ? 'ar-MA' : locale} className="max-w-[90%] whitespace-pre-line rounded-2xl bg-white/5 p-3 leading-6">{t.welcome}</p>}
      {messages.map((message, index) => (
        <div key={index} className={message.role === 'user' ? 'ms-auto max-w-[85%] rounded-2xl bg-jisra-green/20 p-3' : 'max-w-[90%] rounded-2xl bg-white/5 p-3 leading-6'}>
          <p className="whitespace-pre-line">{message.content}</p>
          {message.role === 'assistant' && message.links && message.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.links.map((link) => (
                <Link key={link.href} href={link.href}
                  className="inline-flex min-h-9 items-center rounded-full border border-jisra-green/40 px-3 py-1 text-xs font-medium text-jisra-green transition hover:bg-jisra-green/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-cream">
                  {linkLabels[locale][link.href] || link.label || link.href}
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
      {busy && <p className="flex items-center gap-2 text-xs text-jisra-cream/60"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t.loading}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-400/30 p-3 text-xs text-red-300">{error}</p>}
    </div>
    <form onSubmit={(event) => void send(event)} className="flex items-end gap-2 border-t border-white/10 p-3">
      <label className="sr-only" htmlFor="jisra-ai-input">{t.placeholder}</label>
      <textarea id="jisra-ai-input" value={input} onChange={(event) => setInput(event.target.value.slice(0, 600))} onKeyDown={handleKeyDown} rows={1} maxLength={600} placeholder={t.placeholder} disabled={!available} className="max-h-24 min-h-11 flex-1 resize-none rounded-xl border border-white/20 bg-jisra-ink px-3 py-2.5 text-sm disabled:opacity-50" />
      <button type="submit" disabled={!available || busy || !input.trim()} aria-label={t.send} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-jisra-green text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
    </form>
    <div className="border-t border-white/10 p-2 text-center">
      <button type="button" onClick={() => setContactOpen(!contactOpen)} className="inline-flex min-h-9 items-center gap-2 text-xs underline"><Mail className="h-3.5 w-3.5" />{t.contact}</button>
      {contactState && <p role="status" className="mt-2 text-xs text-jisra-green">{contactState}</p>}
    </div>
    {contactOpen && <form onSubmit={(event) => void sendContact(event)} className="space-y-2 border-t border-white/10 p-3">
      <p className="text-xs font-semibold">{t.contactTitle}</p>
      <p className="text-xs text-jisra-cream/60">{t.contactHint}</p>
      <textarea required name="message" minLength={10} maxLength={1000} rows={3} className="w-full rounded-xl border border-white/20 bg-jisra-ink p-2 text-sm" />
      <input name="email" type="email" maxLength={254} placeholder="email@exemple.com" className="min-h-10 w-full rounded-xl border border-white/20 bg-jisra-ink px-2 text-sm" />
      <button type="submit" className="min-h-10 w-full rounded-xl bg-jisra-green text-sm font-semibold text-white">{t.submit}</button>
    </form>}
  </section>
}

