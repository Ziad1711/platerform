import { redirect } from 'next/navigation'

/** Ancienne URL de la documentation (espace connecté) → documentation publique. */
export default function LegacyCustomSiteDocsPage() {
  redirect('/documentation')
}
