export type DocNavSection = {
  id: string
  label: string
}

export type DocNavGroup = {
  title: string
  sections: DocNavSection[]
}

/** Structure de la documentation : les `id` correspondent aux ancres des sections. */
export const DOC_NAV_GROUPS: DocNavGroup[] = [
  {
    title: 'Commencer',
    sections: [
      { id: 'vue-ensemble', label: "Vue d'ensemble" },
      { id: 'demarrage', label: 'Démarrage rapide' },
      { id: 'authentification', label: 'Authentification' },
    ],
  },
  {
    title: 'API Catalogue',
    sections: [
      { id: 'catalogue', label: 'Catalogue produits' },
      { id: 'categories', label: 'Catégories produits' },
      { id: 'disponibilite', label: 'Vérification panier' },
    ],
  },
  {
    title: 'API Commandes',
    sections: [
      { id: 'commandes', label: 'Créer une commande' },
      { id: 'erreurs', label: 'Erreurs' },
    ],
  },
  {
    title: 'Ressources',
    sections: [
      { id: 'exemples', label: "Exemples d'intégration" },
      { id: 'bonnes-pratiques', label: 'Bonnes pratiques' },
      { id: 'webhooks', label: 'Webhooks' },
    ],
  },
]

export const DOC_SECTION_IDS: string[] = DOC_NAV_GROUPS.flatMap((group) =>
  group.sections.map((section) => section.id)
)

export const DOC_SECTIONS_BY_ID: Record<string, DocNavSection> = Object.fromEntries(
  DOC_NAV_GROUPS.flatMap((group) => group.sections).map((section) => [section.id, section])
)
