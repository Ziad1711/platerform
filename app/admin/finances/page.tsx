import { requireAdmin } from '@/lib/admin/access.server'
import { AdminFinance } from '@/components/admin/admin-finance'

export default async function AdminFinancePage() {
  try { await requireAdmin('finance.read') } catch { return <p role="alert">Permission finance plateforme et TOTP récent requis.</p> }
  return <AdminFinance />
}