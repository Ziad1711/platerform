import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSmtp, smtpConfigFromEnv } from './smtp'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.jisra.io'

type OutboxKind = 'receipt' | 'activated' | 'scheduled' | 'refused'
type OutboxPayload = {
  request_id: string
  reference: string
  plan_name: string
  amount_minor: number
  currency: string
  duration_months: number
  reason?: string
  started_at?: string | null
  expires_at?: string | null
}
type OutboxRow = { id: number; recipient: string; kind: OutboxKind; payload: OutboxPayload; attempts: number }

const mad = (minor: number) => `${(minor / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`

function subject(kind: OutboxKind, payload: OutboxPayload): string {
  switch (kind) {
    case 'receipt': return `Demande de paiement reçue — ${payload.plan_name}`
    case 'activated': return `Abonnement activé — ${payload.plan_name}`
    case 'scheduled': return `Abonnement programmé — ${payload.plan_name}`
    case 'refused': return `Paiement non validé — ${payload.plan_name}`
  }
}

function html(kind: OutboxKind, payload: OutboxPayload): string {
  const link = `${APP_URL}/payment-requests/${payload.request_id}`
  const common = `<p>Offre : ${payload.plan_name}</p><p>Montant : ${mad(payload.amount_minor)}</p><p>Référence : ${payload.reference}</p>`
  switch (kind) {
    case 'receipt':
      return `<p>Votre demande de paiement a bien été reçue. La vérification de votre virement est en cours.</p>${common}<p><a href="${link}">Suivre ma demande</a></p>`
    case 'activated':
      return `<p>Votre abonnement est désormais actif${payload.expires_at ? ` jusqu&apos;au ${payload.expires_at}` : ''}.</p>${common}`
    case 'scheduled':
      return `<p>Une période d&apos;abonnement a été accordée${payload.started_at ? ` à partir du ${payload.started_at}` : ''}.</p>${common}`
    case 'refused':
      return `<p>Votre paiement n&apos;a pas été validé.</p>${payload.reason ? `<p>Motif : ${payload.reason}</p>` : ''}${common}`
  }
}

/**
 * Vide la file de notifications. Idempotent par `dedupe_key` (côté base) et par le
 * passage `pending -> sent/failed`. Un échec SMTP ne bloque jamais une transaction bancaire :
 * il n'incrémente que `attempts` et réessaie plus tard, sans retirer l'e-mail de la file.
 */
export async function drainEmailOutbox(limit = 20) {
  const config = smtpConfigFromEnv()
  if (!config) return { disabled: true, reason: 'SMTP_NOT_CONFIGURED' }
  const backend = createAdminClient()
  const { data, error } = await backend.rpc('rpc_email_outbox_claim', { p_limit: limit })
  if (error) throw error
  const rows = (data || []) as OutboxRow[]
  if (rows.length === 0) return { sent: 0 }
  let sent = 0
  for (const row of rows) {
    try {
      await sendSmtp(config, { to: row.recipient, subject: subject(row.kind, row.payload), html: html(row.kind, row.payload) })
      await backend.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id)
      sent += 1
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 300) : 'SMTP_ERROR'
      await backend.from('email_outbox').update({ status: row.attempts >= 5 ? 'failed' : 'pending', last_error: message }).eq('id', row.id)
    }
  }
  return { sent }
}
