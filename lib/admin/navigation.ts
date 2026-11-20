export const adminSections = [
  { slug: '', title: 'Vue d’ensemble', description: 'KPI commerciaux déterministes, limites de couverture et période comparative.' },
  { slug: 'accounts', title: 'Comptes', description: 'La consultation commerciale minimisée sera ajoutée séparément. Aucune donnée opérationnelle des boutiques n’est consultée.' },
  { slug: 'subscriptions', title: 'Abonnements', description: 'Le suivi des périodes et renouvellements sera ajouté au sous-lot 4B.' },
  { slug: 'paiements', title: 'Paiements', description: 'Demandes, justificatifs privés, décisions bancaires et périodes acquises.' },
  { slug: 'finances', title: 'Finances Jisra', description: 'Charges, règlements, comptes et trésorerie internes, sans accès aux finances des boutiques.' },
  { slug: 'acquisition', title: 'Acquisition / Analytics', description: 'Rapports GA4 consentis en lecture seule et tunnel commercial interne.' },
  // The OAuth form needs the Referrer-Policy of a fresh Acquisition document.
  { slug: 'marketing/acquisition', title: 'Marketing / Acquisition', description: 'Attribution interne et dépenses Meta Ads Jisra.', permission: 'acquisition.manage', documentNavigation: true },
  { slug: 'catalog', title: 'Catalogue', description: 'Le catalogue versionné existe ; son édition administrative sera ajoutée dans un lot dédié.' },
  { slug: 'settings', title: 'Paramètres', description: 'Brouillon bancaire historisé. Le paiement public reste désactivé.' },
  { slug: 'security', title: 'Sécurité et audit', description: 'Habilitations plateforme, authentification renforcée et journal des accès.' },
] as const