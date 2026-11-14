'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2, MessageSquarePlus } from 'lucide-react'

type Status = 'idle' | 'sending' | 'sent' | 'error'

/** Formulaire de proposition de question. Soumission sécurisée via /api/faq/suggestions. */
export function FaqSuggestForm() {
  const [question, setQuestion] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [feedback, setFeedback] = useState('')
  const remaining = 500 - question.length

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = question.trim()
    if (value.length < 10) {
      setStatus('error')
      setFeedback('Votre question doit contenir au moins 10 caractères.')
      return
    }
    setStatus('sending')
    setFeedback('')
    try {
      const response = await fetch('/api/faq/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: value, locale: 'fr' }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string }
        setStatus('error')
        setFeedback(data.error || 'Envoi impossible pour le moment. Réessayez plus tard.')
        return
      }
      setStatus('sent')
      setFeedback('Merci. Votre question a bien été enregistrée pour examen par l’équipe Jisra.')
      setQuestion('')
    } catch {
      setStatus('error')
      setFeedback('Envoi impossible pour le moment. Réessayez plus tard.')
    }
  }

  return (
    <section aria-labelledby="faq-suggest-title" className="marketing-panel mx-auto max-w-3xl p-6 sm:p-8">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-jisra-green/10">
          <MessageSquarePlus className="h-5 w-5 text-jisra-green" />
        </span>
        <div>
          <h2 id="faq-suggest-title" className="text-xl font-semibold text-jisra-cream">Proposer une question</h2>
          <p className="mt-1 text-sm leading-6 text-jisra-cream/60">
            Vous ne trouvez pas votre réponse ? Proposez votre question : elle sera étudiée par l’équipe Jisra. Aucune réponse n’est publiée automatiquement.
          </p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="mt-5 space-y-3">
        <label htmlFor="faq-suggest-input" className="sr-only">Votre question</label>
        <textarea
          id="faq-suggest-input"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value.slice(0, 500))
            if (status !== 'sending') {
              setStatus('idle')
              setFeedback('')
            }
          }}
          placeholder="Ex. : Comment importer mes commandes depuis un fichier CSV ?"
          className="w-full resize-y rounded-2xl border border-white/15 bg-jisra-ink p-3 text-sm text-jisra-cream placeholder:text-jisra-cream/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-green"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-jisra-cream/45">
            {remaining} caractère{remaining > 1 ? 's' : ''} restant{remaining > 1 ? 's' : ''}
          </p>
          <button
            type="submit"
            disabled={status === 'sending' || question.trim().length < 10}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-jisra-green px-5 text-sm font-semibold text-white transition hover:bg-jisra-green-light disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jisra-cream"
          >
            {status === 'sending' ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {status === 'sending' ? 'Envoi…' : 'Envoyer ma question'}
          </button>
        </div>
        <p role="status" aria-live="polite" className={status === 'error' ? 'text-sm text-red-300' : 'text-sm text-jisra-green'}>
          {feedback}
        </p>
      </form>
    </section>
  )
}
