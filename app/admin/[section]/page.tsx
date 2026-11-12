import { notFound } from 'next/navigation'
import { adminSections } from '@/lib/admin/navigation'
import { requireAdmin } from '@/lib/admin/access.server'
import { AdminSecurity } from '@/components/admin/admin-security'
import { AdminBankSettings } from '@/components/admin/admin-bank-settings'
import { AdminAnalytics } from '@/components/admin/admin-analytics'

export default async function AdminSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params
  const item = adminSections.find((entry) => entry.slug === section)
  if (!item) notFound()
  try { await requireAdmin(section === 'security' ? 'security.read' : section === 'settings' ? 'bank_settings.manage' : section === 'acquisition' ? 'analytics.read' : 'admin.access') } catch {
    return <div role="alert" className="rounded-xl border border-white/15 p-6">Permission refusée ou vérification TOTP récente requise.</div>
  }
  return <div className="space-y-6"><h1 className="text-3xl font-bold">{item.title}</h1><p className="max-w-2xl text-jisra-cream/70">{item.description}</p>
    {section === 'security' ? <AdminSecurity /> : section === 'settings' ? <AdminBankSettings /> : section === 'acquisition' ? <AdminAnalytics /> : <div role="status" className="rounded-2xl border border-white/15 p-6">Section préparée pour un sous-lot ultérieur. Aucune lecture des opérations privées des boutiques.</div>}
  </div>
}