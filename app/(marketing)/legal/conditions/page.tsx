import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/legal/legal-page'

export const metadata: Metadata = {
  title: 'Conditions d’utilisation',
  description:
    'Conditions d’utilisation de jisra : accès à la plateforme, abonnement, obligations de l’utilisateur, intégrations tierces, responsabilité et résiliation.',
}

export default function ConditionsPage() {
  return (
    <LegalPage
      eyebrow="Légal"
      title="Conditions d’utilisation"
      updatedAt="17 septembre 2026"
      sections={[
        {
          title: 'Objet et acceptation',
          content: [
            'Les présentes conditions régissent l’accès au site marketing jisra ainsi que l’utilisation de la plateforme SaaS de pilotage e-commerce (tableaux de bord, ventes, stock, trésorerie, livraison, dépenses publicitaires et assistance à la décision).',
            'L’utilisation du site et de la plateforme implique l’acceptation pleine et entière des présentes conditions dans leur version en vigueur. Si vous utilisez le service pour le compte d’une entreprise, vous déclarez disposer du pouvoir de l’engager.',
            'Toute condition contraire émanant de l’utilisateur est inopposable, sauf acceptation écrite préalable de notre part.',
          ],
        },
        {
          title: 'Description du service',
          content: [
            'jisra est une plateforme de centralisation et d’analyse de l’activité e-commerce : consolidation des ventes et des commandes, suivi du stock et des fournisseurs, suivi des dépenses publicitaires et de la rentabilité, préparation des expéditions et aide à la décision.',
            'Le service s’appuie sur des connecteurs vers des outils tiers (plateforme e-commerce, transporteur, régie publicitaire) que l’utilisateur choisit d’activer, ainsi que sur des fonctionnalités d’assistance automatisée.',
            'La plateforme évolue par itérations successives : certaines fonctionnalités peuvent être ajoutées, modifiées ou retirées, notamment pendant la phase de déploiement initiale. Les informations présentées sur le site marketing le sont à titre indicatif et ne constituent pas un engagement contractuel.',
          ],
        },
        {
          title: 'Compte utilisateur et accès',
          content: [
            'La création d’un compte requiert des informations exactes, complètes et à jour. L’utilisateur s’engage à les maintenir à jour et à ne pas partager ses identifiants de connexion.',
            'L’utilisateur est responsable de la confidentialité de ses identifiants et de toute activité effectuée depuis son compte. Toute utilisation non autorisée doit nous être signalée sans délai à contact@jisra.io.',
            'Les accès aux boutiques et aux données sont organisés par rôles et permissions. L’administrateur du compte est responsable des invitations envoyées et des droits attribués à ses collaborateurs.',
          ],
        },
        {
          title: 'Abonnement, tarifs et facturation',
          content: [
            'L’accès à la plateforme peut être proposé sous forme d’essai, d’offre gratuite limitée ou d’abonnement payant selon la formule choisie. Les caractéristiques et les montants applicables sont ceux communiqués lors de la souscription ou sur la page Tarifs.',
            'Sauf mention contraire, l’abonnement est facturé d’avance et renouvelé automatiquement pour une durée identique. L’utilisateur peut résilier avant la date de renouvellement ; la résiliation prend effet à la fin de la période en cours, sans remboursement de la période entamée.',
            'Les tarifs peuvent être ajustés pour tenir compte de l’évolution du service. Toute hausse est notifiée à l’avance ; en cas de désaccord, l’utilisateur peut résilier avant son entrée en vigueur.',
            'Tout retard ou défaut de paiement peut entraîner la suspension de l’accès au service après relance, sans préjudice des sommes restant dues.',
          ],
        },
        {
          title: 'Obligations et usage acceptable',
          content: [
            'L’utilisateur s’engage à utiliser la plateforme conformément à sa destination professionnelle et à la réglementation applicable, notamment en matière de protection des données personnelles et de commerce.',
            'Sont notamment interdits : l’accès ou la tentative d’accès à des données appartenant à d’autres organisations, l’extraction automatisée massive de données, la revente ou la mise à disposition du service à des tiers non autorisés, ainsi que toute action visant à contourner les limitations techniques ou les mesures de sécurité.',
            'L’utilisateur demeure responsable des données qu’il importe, des bases légales associées et du respect des droits de ses propres clients, fournisseurs et partenaires.',
          ],
        },
        {
          title: 'Intégrations tierces',
          content: [
            'La connexion d’un service tiers (plateforme e-commerce, transporteur, régie publicitaire) implique l’acceptation des conditions d’utilisation de ce service et la transmission des jetons d’accès nécessaires au fonctionnement des synchronisations.',
            'La disponibilité et l’exactitude des données issues de ces services dépendent de leurs propres interfaces, quotas et politiques. Une modification ou une interruption côté tiers peut affecter temporairement les synchronisations sans que jisra puisse en être tenue responsable.',
            'L’utilisateur reste titulaire de ses comptes tiers et peut révoquer les accès à tout moment ; la révocation met fin aux synchronisations correspondantes.',
          ],
        },
        {
          title: 'Propriété intellectuelle',
          content: [
            'La marque jisra, l’interface, le code, les éléments graphiques, les textes et la documentation sont protégés par le droit de la propriété intellectuelle et demeurent la propriété de l’éditeur ou de ses partenaires.',
            'L’utilisateur bénéficie d’un droit d’usage personnel, non exclusif et non transférable du service pendant la durée de son abonnement. Toute reproduction, décompilation, revente ou exploitation non autorisée est interdite.',
          ],
        },
        {
          title: 'Données, confidentialité et restitution',
          content: [
            'Les données d’exploitation, de stock et de commandes saisies ou synchronisées restent la propriété de l’utilisateur. jisra agit en qualité de sous-traitant pour les données des clients finaux de l’utilisateur et applique la politique de confidentialité publiée sur ce site.',
            'L’utilisateur peut exporter ses données depuis la plateforme pendant la durée de son accès. Après résiliation, les données sont conservées puis supprimées ou anonymisées selon les durées décrites dans la politique de confidentialité.',
          ],
        },
        {
          title: 'Disponibilité, maintenance et support',
          content: [
            'jisra met en œuvre des moyens raisonnables pour assurer la disponibilité et la sécurité du service, sans garantir une absence totale d’interruption. Des opérations de maintenance, des mises à jour ou des incidents chez nos prestataires peuvent entraîner des indisponibilités temporaires.',
            'Le support est assuré par email à contact@jisra.io. Les demandes sont traitées selon leur nature et leur criticité, dans le cadre défini par la formule souscrite.',
          ],
        },
        {
          title: 'Limites de responsabilité',
          content: [
            'Le service constitue un outil d’aide au pilotage : les calculs, agrégations et suggestions reposent sur les données disponibles et ne dispensent pas l’utilisateur d’un contrôle. Les décisions commerciales, fiscales ou logistiques prises sur cette base relèvent de sa responsabilité.',
            'Dans les limites permises par la loi, jisra ne peut être tenue responsable des dommages indirects, des pertes d’exploitation ou des pertes de données résultant d’un usage non conforme, d’une défaillance d’un service tiers ou d’un cas de force majeure.',
            'En tout état de cause, si la responsabilité de jisra est retenue, elle est limitée au montant des sommes effectivement versées par l’utilisateur au cours des douze derniers mois.',
          ],
        },
        {
          title: 'Suspension et résiliation',
          content: [
            'jisra peut suspendre ou résilier l’accès en cas de manquement grave ou répété aux présentes conditions, de non-paiement, d’usage frauduleux ou d’atteinte à la sécurité du service, après notification lorsque la situation le permet.',
            'L’utilisateur peut résilier son abonnement à tout moment depuis son espace ou en écrivant à contact@jisra.io. À l’issue de la résiliation, l’accès au service est interrompu à la fin de la période payée.',
          ],
        },
        {
          title: 'Modifications, droit applicable et contact',
          content: [
            'Ces conditions peuvent être mises à jour pour tenir compte de l’évolution du service ou de la réglementation. La version applicable est celle publiée sur cette page, avec sa date de mise à jour.',
            'Les présentes conditions sont soumises au droit marocain. En cas de différend, les parties privilégient une solution amiable avant toute action contentieuse devant les juridictions compétentes.',
            'Pour toute question relative à ces conditions, écrivez-nous à contact@jisra.io.',
          ],
        },
      ]}
    />
  )
}