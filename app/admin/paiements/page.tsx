import { requireAdmin } from '@/lib/admin/access.server'
import { AdminPayments } from '@/components/admin/admin-payments'

export default async function AdminPaymentsPage() {
  try { await requireAdmin('payments.read') } catch { return <p role="alert">Permission bancaire ou vérification TOTP récente requise.</p> }
  return <AdminPayments />
}