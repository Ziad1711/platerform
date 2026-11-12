'use client'

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send, X, Loader2, Mail } from 'lucide-react'

type Locale = 'fr' | 'ar' | 'ary'
type Message = { role: 'user' | 'assistant'; content: string }
const labels: Record<Locale, Record<string, string>> = {
  fr: { open: 'Discuter avec l’assistant Jisra', title: 'Assistant Jisra', intro: 'Bonjour 👋 Je peux vous aider à choisir un forfait ou comprendre l’inscription.', placeholder: 'Votre question…', send: 'Envoyer', close: 'Fermer', contact: 'Demander un contact', contactTitle: 'Demande de contact humain', contactHint: 'Décrivez votre besoin (10 caractères minimum). Ne communiquez aucune donnée bancaire.', submit: 'Envoyer la demande', sent: 'Demande enregistrée. Notre équipe vous répondra par email.', error: 'Assistant momentanément indisponible. Consultez /pricing ou demandez un contact.', loading: 'L’assistant écrit…' },
  ar: { open: 'تحدث مع مساعد جيسرا', title: 'مساعد جيسرا', intro: 'مرحباً 👋 يمكنني مساعدتك في اختيار العرض أو فهم التسجيل.', placeholder: 'سؤالك…', send: 'إرسال', close: 'إغلاق', contact: 'طلب تواصل بشري', contactTitle: 'طلب تواصل بشري', contactHint: 'اشرح حاجتك (10 أحرف على الأقل). لا تشارك أي بيانات بنكية.', submit: 'إرسال الطلب', sent: 'تم تسجيل طلبك. سيتواصل معك فريقنا.', error: 'المساعد غير متاح حالياً. راجع صفحة الأسعار أو اطلب تواصلاً.', loading: 'المساعد يكتب…' },
  ary: { open: 'هدر مع مساعد جيسرا', title: 'مساعد جيسرا', intro: 'أهلا 👋 نقدر نعاونك تختار الفورفي و تفهم كيفاش تسجل.', placeholder: 'السؤال ديالك…', send: 'صيفط', close: 'سد', contact: 'طلب تواصل مع بنادم', contactTitle: 'طلب تواصل بشري', contactHint: 'شرح لينا شنو بغيتي (10 حروف على الأقل). ما تعطينا حتى معلومة بنكية.', submit: 'صيفط الطلب', sent: 'تسجل الطلب ديالك. الفريق غادي يتواصل معاك.', error: 'المساعد ما متوفرش دابا. شوف الأسعار ولا طلب تواصل.', loading: 'المساعد كيكتب…' },
}

export function AssistantWidget({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [locale, setLocale] = useState<Locale>('fr')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [contactOpen, setContactOpen] = useState(false)
  const [contactState, setContactState] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const t = labels[locale]
  const rtl = locale !== 'fr'

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [messages, busy])

  async function send(event: React.FormEvent) {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    const history = messages.slice(-6)
    setMessages((current) => [...current, { role: 'user', content: text }])
    setInput(''); setBusy(true); setError('')
    try {
      const response = await fetch('/api/public-assistant/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale, message: text, history }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || t.error)
      setMessages((current) => [...current, { role: 'assistant', content: result.reply }])
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.error) }
    finally { setBusy(false) }
  }
  async function sendContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setContactState('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/public-assistant/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: form.get('message'), email: form.get('email') || undefined, preferredChannel: 'email', locale }),
    }).catch(() => null)
    setContactState(response?.ok ? t.sent : t.error)
    if (response?.ok) { (event.target as HTMLFormElement).reset(); setContactOpen(false) }
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} aria-label={t.open}
    className="fixed bottom-20 right-4 z-[70] flex h-12 w-12 sm:bottom-[5.25rem] sm:right-6 items-center justify-center rounded-full bg-jisra-green text-white shadow-lg shadow-jisra-green/30 transition hover:bg-jisra-green-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-cream">
    <MessageCircle aria-hidden className="h-6 w-6" />
  </button>

  return <section dir={rtl ? 'rtl' : 'ltr'} lang={locale === 'ar' ? 'ar' : locale === 'ary' ? 'ar-MA' : 'fr'} aria-label={t.title}
    className="fixed bottom-0 right-0 z-[80] flex h-[min(78dvh,560px)] w-full flex-col pb-[env(safe-area-inset-bottom)] border border-white/15 bg-jisra-ink-light text-jisra-cream shadow-2xl sm:bottom-6 sm:right-6 sm:w-[380px] sm:rounded-2xl">
    <header className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
      <p className="text-sm font-semibold">{t.title}</p>
      <div className="flex items-center gap-1">
        <select aria-label="Langue" value={locale} onChange={(event) => setLocale(event.target.value as Locale)} className="min-h-9 rounded-lg border border-white/15 bg-jisra-ink px-2 text-xs">
          <option value="fr">FR</option><option value="ar">العربية</option><option value="ary">Darija</option>
        </select>
        <button type="button" onClick={() => setOpen(false)} aria-label={t.close} className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15"><X className="h-4 w-4" /></button>
      </div>
    </header>
    <div ref={listRef} role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
      {messages.length === 0 && <p className="rounded-xl bg-white/5 p-3 leading-6">{t.intro}</p>}
      {messages.map((message, index) => <p key={index} className={message.role === 'user' ? 'ms-auto max-w-[85%] rounded-2xl bg-jisra-green/20 p-3' : 'max-w-[90%] rounded-2xl bg-white/5 p-3 leading-6'}>{message.content}</p>)}
      {busy && <p className="flex items-center gap-2 text-xs text-jisra-cream/60"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t.loading}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-400/30 p-3 text-xs text-red-300">{error}</p>}
    </div>
    <form onSubmit={(event) => void send(event)} className="flex items-end gap-2 border-t border-white/10 p-3">
      <label className="sr-only" htmlFor="jisra-ai-input">{t.placeholder}</label>
      <textarea id="jisra-ai-input" value={input} onChange={(event) => setInput(event.target.value.slice(0, 600))} rows={1} maxLength={600} placeholder={t.placeholder} className="max-h-24 min-h-11 flex-1 resize-none rounded-xl border border-white/20 bg-jisra-ink px-3 py-2.5 text-sm" />
      <button type="submit" disabled={busy || !input.trim()} aria-label={t.send} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-jisra-green text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
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

