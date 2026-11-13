export type PublicFaqItem = { question: string; answer: string }

/**
 * FAQ publique réconciliée (page Tarifs + assistant commercial).
 * Une seule formulation par fait : aucun nombre de boutiques codé en dur,
 * aucune contradiction entre « souscription » et « paiement en ligne ».
 */
export const pricingFaqItems: PublicFaqItem[] = [
  {
    question: 'Jisra est-il conçu pour le Maroc ?',
    answer:
      'Oui. Le produit est pensé pour les e-commerçants marocains : français, MAD, workflows de confirmation et sociétés de livraison locales.',
  },
  {
    question: 'Est-ce que Jisra remplace mes tableaux Excel ?',
    answer:
      'Oui. L’objectif est de centraliser commandes, coûts, livraison, stock et rentabilité dans une seule interface.',
  },
  {
    question: 'Puis-je commencer gratuitement puis évoluer ?',
    answer:
      'Le compte Free est gratuit et sans engagement. Pour une offre payante, vous pouvez préparer une demande depuis /subscribe ; l’activation intervient après vérification du paiement par virement. Le paiement en ligne n’est pas disponible.',
  },
  {
    question: 'Puis-je gérer plusieurs boutiques ?',
    answer:
      'Oui. Le nombre de boutiques dépend de l’offre : il est indiqué dans le tableau de comparaison des tarifs.',
  },
  {
    question: 'Comment calculez-vous le vrai profit ?',
    answer:
      'Jisra combine revenus, coût produit, coûts publicitaires, livraison et coûts opérationnels pour calculer la rentabilité par commande.',
  },
  {
    question: 'Dois-je connecter mes intégrations dès le début ?',
    answer:
      'Non. Vous pouvez démarrer progressivement, puis brancher vos boutiques et vos sources de dépenses quand vous êtes prêt.',
  },
  {
    question: 'Qu’est-ce que les crédits IA ?',
    answer:
      'Les crédits IA correspondent à l’usage de l’assistant intelligent de Jisra. Chaque offre inclut un quota mensuel indiqué dans le tableau de comparaison.',
  },
  {
    question: 'Les transporteurs sont-ils inclus dans toutes les offres ?',
    answer:
      'Non. Les intégrations transporteurs disponibles sont listées sur /catalogue-integrations, mais le nombre inclus dépend de l’offre (colonne « Intégrations livraison »). Une intégration disponible dans Jisra n’est pas nécessairement incluse dans chaque offre.',
  },
  {
    question: 'Comment se passe le paiement d’une offre payante ?',
    answer:
      'Le paiement se fait par virement bancaire, puis l’équipe Jisra vérifie le règlement. Un justificatif seul n’active jamais un abonnement ; le paiement en ligne n’est pas disponible.',
  },
  {
    question: 'L’abonnement annuel est-il prélevé chaque mois ?',
    answer:
      'Non. L’annuel est payé en une seule fois pour 12 mois, sans prélèvement mensuel automatique.',
  },
]
