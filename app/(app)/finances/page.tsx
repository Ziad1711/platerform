import { redirect } from 'next/navigation'
import { requireAnyPermission } from '@/lib/auth/require-permission'
import FinancesClient from '@/components/dashboard/finance/finance-client'

export default async function FinancesPage() {
  try {
    await requireAnyPermission('finance.view')
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') redirect('/login')
    redirect('/dashboard')
  }

  return <FinancesClient />
}
