import { requireAdmin } from '@/lib/admin/access.server'
import { AdminPaymentDetail } from '@/components/admin/admin-payment-detail'
import { notFound } from 'next/navigation'

export default async function AdminPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  try { await requireAdmin('payments.read') } catch { return <p role="alert">Permission bancaire ou vérification TOTP récente requise.</p> }
  return <AdminPaymentDetail id={id} />
}