import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/legal/legal-page'

export const metadata: Metadata = {
  title: 'Instructions de suppression des données',
  description:
    'Comment demander la suppression de vos données personnelles chez jisra : depuis la plateforme, en révoquant l’accès Facebook/Meta ou par email.',
}

export default function DataDeletionPage() {
  return (
    <LegalPage
      eyebrow="Légal"
      title="Instructions de suppression des données"
      updatedAt="17 septembre 2026"
      sections={[
        {
          title: 'Objet de cette page',
          content: [
            'Cette page explique comment demander la suppression des données à caractère personnel traitées par jisra, que vous soyez simple visiteur du site, prospect ou utilisateur disposant d’un compte sur la plateforme.',
            'Elle couvre également les données transmises dans le cadre d’une intégration tierce connectée à votre compte, notamment une régie publicitaire (Facebook / Meta), une plateforme e-commerce ou un transporteur.',
            'Ces instructions complètent la politique de confidentialité publiée sur ce site, qui détaille les données collectées, les finalités, les destinataires et les durées de conservation.',
          ],
        },
        {
          title: 'Option 1 — Supprimer depuis la plateforme',
          content: [
            'Connectez-vous à votre compte jisra et ouvrez la page Paramètres : vous pouvez y modifier ou supprimer vos informations de profil et vos préférences enregistrées.',
            'Depuis les sections d’intégration, vous pouvez déconnecter un service tiers (Facebook / Meta, plateforme e-commerce, transporteur). Cette action révoque le jeton d’accès enregistré et interrompt immédiatement les synchronisations associées.',
            'Pour supprimer l’intégralité de votre compte et des données rattachées, écrivez-nous à contact@jisra.io en indiquant l’adresse email du compte : la suppression du compte entraîne celle des données d’exploitation qui y sont liées, sous réserve des durées de conservation légales décrites ci-dessous.',
          ],
        },
        {
          title: 'Option 2 — Révoquer l’accès Facebook / Meta',
          content: [
            'Si vous avez connecté votre compte publicitaire via Facebook Login, vous pouvez retirer l’autorisation à tout moment depuis Facebook : Paramètres et confidentialité → Paramètres → Applications et sites web, sélectionnez jisra puis « Supprimer ».',
            'Cette révocation supprime l’accès de jisra à vos données Facebook et rend inutilisable le jeton d’accès correspondant. Les données déjà synchronisées (par exemple l’historique des dépenses publicitaires importées) restent visibles dans votre espace jusqu’à ce que vous demandiez leur effacement.',
            'Pour que les données synchronisées soient également supprimées, envoyez votre demande à contact@jisra.io en précisant que la révocation a été effectuée depuis Facebook et l’adresse email associée à votre compte jisra.',
          ],
        },
        {
          title: 'Option 3 — Demander la suppression par email',
          content: [
            'Écrivez à contact@jisra.io avec pour objet « Suppression des données » et indiquez : l’adresse email du compte concerné, les boutiques ou stores visés, le périmètre souhaité (profil uniquement, données d’exploitation, données d’une intégration précise ou totalité du compte).',
            'Une vérification raisonnable de votre identité peut être demandée afin de nous assurer que la demande émane bien du titulaire du compte ou d’une personne habilitée à agir pour son organisation.',
            'Vous pouvez également exercer ce droit depuis les fonctionnalités disponibles dans la page Paramètres lorsque la suppression est proposée directement par l’interface.',
          ],
        },
        {
          title: 'Données concernées par la suppression',
          content: [
            'Données de compte et de contact : identité, adresse email, mot de passe chiffré, préférences, rôles et accès à vos boutiques.',
            'Données d’exploitation rattachées à votre organisation : boutiques, produits, stocks, fournisseurs, dépenses, commandes, informations de livraison et données de rentabilité que vous avez saisies ou synchronisées.',
            'Données de connexion aux intégrations : jetons d’accès et identifiants techniques permettant la synchronisation avec un service tiers, ainsi que les données d’activité importées depuis ces services.',
            'Journaux techniques et de sécurité associés à votre compte, susceptibles d’être conservés pour une durée limitée à des fins de sécurité et de traçabilité.',
            'Les données strictement nécessaires au respect d’une obligation légale (par exemple une pièce comptable ou une facture) peuvent être conservées pour la durée imposée par la réglementation, en accès restreint, puis supprimées.',
          ],
        },
        {
          title: 'Délais et confirmation',
          content: [
            'Nous accusons réception de chaque demande et la traitons dans un délai maximum de 30 jours à compter de sa réception, sauf demande complexe pour laquelle vous êtes informé d’une prolongation motivée.',
            'Une fois la suppression effectuée, vous recevez une confirmation par email. Les données supprimées peuvent subsister temporairement dans nos sauvegardes techniques : elles y sont isolées et écrasées selon le cycle normal de rotation des sauvegardes.',
            'Si une partie de votre demande ne peut pas être satisfaite, nous vous indiquons les motifs et les données concernées, ainsi que les voies de recours disponibles.',
          ],
        },
        {
          title: 'Suppression des données de vos clients finaux',
          content: [
            'Les données relatives aux clients de votre boutique (nom, téléphone, ville, informations de livraison) sont traitées par jisra pour votre compte : vous en êtes le responsable de traitement et nous agissons comme sous-traitant.',
            'Vous pouvez supprimer ces données depuis la plateforme (suppression des commandes concernées ou des boutiques rattachées) ou nous demander de procéder à leur effacement à contact@jisra.io.',
            'Si l’un de vos clients nous contacte directement pour demander la suppression de ses données, nous transmettons la demande à l’organisation responsable en tant que de besoin, sans traiter la demande à sa place.',
          ],
        },
        {
          title: 'Contact et réclamation',
          content: [
            'Pour toute question relative à la suppression de vos données, ou si vous ne recevez pas de réponse dans les délais indiqués, écrivez à contact@jisra.io.',
            'Vous pouvez également introduire une réclamation auprès de l’autorité compétente, notamment la Commission Nationale de contrôle de la protection des Données à caractère personnel (CNDP) au Maroc, ou l’autorité de contrôle de votre lieu de résidence lorsque le RGPD est applicable.',
          ],
        },
      ]}
    />
  )
}
