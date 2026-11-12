import { redirect } from 'next/navigation'
import { getServerUserResult } from '@/lib/supabase/server'
import { Container } from '@/components/marketing/shared/container'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mes demandes de paiement', robots: { index: false, follow: false } }
export default async function PaymentLayout({ children }: { children: React.ReactNode }) {
  const { user, authUnavailable } = await getServerUserResult()
  if (authUnavailable) return <Container className="py-20">Vérification de session indisponible. Réessayez ultérieurement.</Container>
  if (!user) redirect('/login?next=%2Fpayment-requests')
  return <Container className="py-12 sm:py-20">{children}</Container>
}