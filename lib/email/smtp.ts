import 'server-only'
import { connect, type TLSSocket } from 'node:tls'

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
}

/**
 * Adaptateur SMTP Purelymail. Fermé par défaut : sans `SMTP_HOST` et un expéditeur
 * (`SMTP_FROM`, ou `SMTP_ADMIN_EMAIL` comme Supabase Auth), aucun envoi n'est possible.
 * Implicit TLS uniquement (port 465) ; STARTTLS non géré. Aucun identifiant journalisé.
 */
export function smtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST
  const from = process.env.SMTP_FROM || process.env.SMTP_ADMIN_EMAIL
  if (!host || !from) return null
  return {
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from,
  }
}

/** Neutralise toute injection d'en-tête (CR/LF) dans les champs d'en-tête. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function smtpLines(socket: TLSSocket) {
  let buffer = ''
  let done = false
  const queue: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = []
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    buffer += chunk
    let index: number
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      const next = queue.shift()
      if (next) next.resolve(line)
    }
  })
  const fail = (error: Error) => {
    if (done) return
    done = true
    for (const waiter of queue.splice(0)) waiter.reject(error)
  }
  socket.on('error', fail)
  socket.on('close', () => fail(new Error('SMTP_CONNECTION_CLOSED')))
  return () => new Promise<string>((resolve, reject) => queue.push({ resolve, reject }))
}

export async function sendSmtp(
  config: SmtpConfig,
  message: { to: string; subject: string; html: string },
): Promise<void> {
  const to = headerSafe(message.to)
  const subject = headerSafe(message.subject)
  const from = headerSafe(config.from)

  const socket = connect({ host: config.host, port: config.port, servername: config.host, rejectUnauthorized: true })
  socket.setTimeout(30_000, () => socket.destroy(new Error('SMTP_TIMEOUT')))
  const read = smtpLines(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('secureConnect', () => resolve())
    socket.once('error', reject)
  })

  const expect = async (codes: number[]) => {
    let line = await read()
    while (/^\d{3}-/.test(line)) line = await read()
    const code = Number(line.slice(0, 3))
    if (!codes.includes(code)) throw new Error(`SMTP ${code}: ${line.slice(4)}`)
  }
  const write = (text: string) => socket.write(text + '\r\n')
  try {
    await expect([220])
    write('EHLO jisra')
    await expect([250])
    if (config.user && config.pass) {
      write('AUTH LOGIN')
      await expect([334])
      write(Buffer.from(config.user).toString('base64'))
      await expect([334])
      write(Buffer.from(config.pass).toString('base64'))
      await expect([235])
    }
    write(`MAIL FROM:<${from}>`)
    await expect([250])
    write(`RCPT TO:<${to}>`)
    await expect([250, 251])
    write('DATA')
    await expect([354])
    const body = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n`
      + message.html.replace(/\r\n|\n|\r/g, '\r\n').replace(/^\./gm, '..')
    socket.write(body + '\r\n.\r\n')
    await expect([250])
    write('QUIT')
  } finally {
    socket.destroy()
  }
}
