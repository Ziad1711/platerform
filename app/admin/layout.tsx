import { redirect } from 'next/navigation'
import Link from 'next/link'
import { adminContext } from '@/lib/admin/access.server'
import { AdminShell } from '@/components/admin/admin-shell'
import { AdminMfa } from '@/components/admin/admin-mfa'
import { AdminSessionBoundary } from '@/components/admin/admin-session-boundary'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Administration Jisra', robots: { index: false, follow: false } }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let result
  try { result = await adminContext() } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'ADMIN_AUTH') redirect('/login?next=%2Fadmin')
    return <div className="min-h-screen bg-jisra-ink p-6 text-jisra-cream"><div className="mx-auto max-w-lg rounded-2xl border border-white/15 p-6">
      <h1 className="text-2xl font-semibold">{code === 'ADMIN_FORBIDDEN' ? 'Accès plateforme refusé' : 'Administration indisponible'}</h1>
      <p className="mt-4">{code === 'ADMIN_FORBIDDEN' ? 'Les rôles de boutique ne donnent aucun accès à l’administration Jisra.' : 'Votre habilitation ne peut pas être vérifiée. Aucun accès n’est accordé.'}</p>
      <Link href="/" className="mt-6 inline-block underline">Retour au site</Link>
    </div></div>
  }
  return <AdminSessionBoundary><AdminShell permissions={result.context.permissions}>{result.context.strong ? children : <AdminMfa />}</AdminShell></AdminSessionBoundary>
}