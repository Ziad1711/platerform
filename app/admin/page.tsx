import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/access.server'
import { adminSections } from '@/lib/admin/navigation'
import { AdminDashboard } from '@/components/admin/admin-dashboard'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  try { await requireAdmin('dashboard.read') } catch {
    return <div role="alert" className="rounded-xl border border-white/15 p-6">Permission dashboard ou vérification TOTP récente requise.
      <Link href="/admin/security" className="mt-4 block underline">Vérifier mon habilitation</Link></div>
  }
  return <div className="min-w-0 space-y-10">
    <AdminDashboard />
    <section className="space-y-4"><h2 className="text-xl font-semibold">Administration</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{adminSections.slice(1).map((section) => <Link key={section.slug} href={`/admin/${section.slug}`} className="min-w-0 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 hover:border-jisra-green/40">
        <h3 className="font-semibold">{section.title}</h3><p className="break-words text-sm leading-6 text-jisra-cream/65">{section.description}</p>
      </Link>)}</div>
    </section>
  </div>
}
