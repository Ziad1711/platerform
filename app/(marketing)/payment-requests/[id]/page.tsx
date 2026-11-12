import { notFound } from 'next/navigation'
import { PaymentRequestDetail } from '@/components/billing/payment-request-detail'

export default async function PaymentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound()
  return <PaymentRequestDetail id={id} />
}