'use client'

import { CatalogOffers } from '@/components/marketing/pricing/catalog-offers'

export default function JisraPlanCatalog({ currentPlanName }: { currentPlanName?: string }) {
  return <div className="space-y-4 border-t pt-5">
    <h3 className="text-base font-semibold">Tarifs actuels des offres Jisra</h3>
    <p className="text-sm text-muted-foreground">Les boutons ouvrent la souscription (/subscribe). Le tarif affiché est le tarif actuel du catalogue : il ne modifie ni le montant historiquement payé, ni votre échéance. L’activation suit la vérification bancaire.</p>
    <CatalogOffers appearance="app" currentPlanName={currentPlanName} />
  </div>
}
