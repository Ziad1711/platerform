'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'

export default function RapidDeliveryVoucherPrintPage() {
  const params = useParams<{ key: string }>()
  const key = String(params?.key || '').trim()

  const { data, isLoading, error } = useQuery({
    queryKey: ['rapid-delivery-voucher-detail', key],
    enabled: !!key,
    queryFn: async () => {
      const response = await fetch(`/api/integrations/rapid-delivery/vouchers/${encodeURIComponent(key)}`)
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'RAPID_DELIVERY_VOUCHER_FETCH_FAILED')
      return payload as { voucher?: any; parcels?: any[] }
    },
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-semibold">Bon de ramassage #{key}</h1>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Imprimer / Télécharger PDF
        </button>
      </div>

      {isLoading ? <p>Chargement...</p> : null}
      {error ? <p className="text-red-500">{error instanceof Error ? error.message : 'Erreur'}</p> : null}

      {data ? (
        <div className="space-y-6 rounded-xl border bg-white p-6 text-black">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Bon de ramassage Rapid Delivery</h2>
            <p>Clé: #{data.voucher?.key || key}</p>
            <p>Shop: {data.voucher?.shop?.shop_name || data.voucher?.shop_id || '-'}</p>
            <p>Total colis: {Number(data.voucher?.total_parcels || data.parcels?.length || 0)}</p>
          </div>

          <table className="min-w-full border text-sm">
            <thead>
              <tr className="border-b bg-gray-100 text-left">
                <th className="px-3 py-2">Tracking</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Téléphone</th>
                <th className="px-3 py-2">Ville</th>
                <th className="px-3 py-2">Montant</th>
              </tr>
            </thead>
            <tbody>
              {(data.parcels || []).map((parcel: any) => (
                <tr key={parcel.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">{parcel.rapid_delivery_parcel_key || '-'}</td>
                  <td className="px-3 py-2">{parcel.customer_name || '-'}</td>
                  <td className="px-3 py-2">{parcel.phone || '-'}</td>
                  <td className="px-3 py-2">{parcel.city || '-'}</td>
                  <td className="px-3 py-2">{Number(parcel.total_selling_price || 0).toFixed(2)} MAD</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}