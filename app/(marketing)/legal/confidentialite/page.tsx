import type { Metadata } from 'next'
import { LegalPage } from '@/components/marketing/legal/legal-page'

export const metadata: Metadata = {
  title: 'Politique de confidentialité',
  description:
    'Politique de confidentialité de jisra : données collectées, finalités, cookies, sous-traitants, sécurité, conservation et droits des utilisateurs.',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Légal"
      title="Politique de confidentialité"
      updatedAt="17 septembre 2026"
      sections={[
        {
          title: 'Champ d’application et responsable du traitement',
          content: [
            'La présente politique décrit la manière dont jisra collecte, utilise, conserve et protège les données à caractère personnel dans le cadre du site marketing et de la plateforme SaaS de pilotage e-commerce destinée aux commerçants marocains.',
            'Elle s’applique aux visiteurs du site, aux prospects qui nous contactent et aux utilisateurs disposant d’un compte sur la plateforme. Les coordonnées complètes de l’entité responsable du traitement seront précisées dans la version légale finale validée.',
            'Le traitement est réalisé dans le respect de la loi marocaine n° 09-08 relative à la protection des personnes physiques à l’égard du traitement des données à caractère personnel et, lorsque le Règlement général sur la protection des données (RGPD) est applicable, des exigences complémentaires qu’il prévoit.',
          ],
        },
        {
          title: 'Données que nous collectons',
          content: [
            'Données de compte et de contact : nom, prénom, adresse email, mot de passe chiffré, préférences d’affichage, devise préférée et informations de connexion.',
            'Données d’entreprise et d’exploitation : nom du business, boutiques ou stores rattachés, pays, fuseau horaire, produits, stocks, fournisseurs, dépenses, commandes et leurs statuts, informations de livraison et de rentabilité.',
            'Données issues des intégrations : lors de la connexion d’un outil tiers (plateforme e-commerce, transporteur, régie publicitaire), nous traitons les identifiants techniques et jetons d’accès nécessaires à la synchronisation, ainsi que les données d’activité renvoyées par ces services.',
            'Données techniques et d’usage : horodatage des requêtes, type d’appareil et de navigateur, journaux d’erreurs et événements de sécurité strictement nécessaires au fonctionnement et à la protection du service.',
            'Échanges avec le support : contenu des messages que vous nous adressez, afin de traiter vos demandes et d’améliorer le produit.',
          ],
        },
        {
          title: 'Finalités et bases légales',
          content: [
            'Fournir le service : créer et sécuriser votre compte, héberger vos données d’exploitation, exécuter les synchronisations et produire les tableaux de bord et rapports demandés.',
            'Gérer la relation commerciale : répondre à vos demandes de contact ou de démonstration, préparer une mise en relation pertinente et assurer le suivi de l’abonnement.',
            'Améliorer le produit : analyser de manière agrégée les usages et les incidents techniques afin de corriger les erreurs, renforcer les performances et prioriser les fonctionnalités.',
            'Sécurité et conformité : prévenir les accès non autorisés, la fraude et les usages abusifs, et satisfaire nos obligations légales, comptables et de traçabilité.',
            'Ces traitements reposent selon le cas sur l’exécution du contrat, votre consentement, notre intérêt légitime à sécuriser et améliorer le service, ou le respect d’une obligation légale. Vos données ne sont jamais revendues.',
          ],
        },
        {
          title: 'Fonctionnalités d’assistance automatisée',
          content: [
            'Certaines fonctionnalités d’analyse, de suggestion et de normalisation (par exemple l’interprétation de questions métier ou la normalisation de libellés de villes) peuvent s’appuyer sur des modèles d’intelligence artificielle accessibles via des fournisseurs techniques.',
            'Dans ce cadre, seules les données strictement nécessaires à la réponse sont transmises au fournisseur concerné, sous forme de requête technique. Aucune donnée n’est utilisée à des fins d’entraînement de modèles publics de notre fait.',
            'Ces traitements restent optionnels : les fonctionnalités principales de la plateforme demeurent utilisables sans recourir à l’assistance automatisée.',
          ],
        },
        {
          title: 'Cookies et traceurs',
          content: [
            'Le site utilise des cookies et un stockage local limités à des finalités essentielles : maintien de votre session authentifiée, mémorisation de vos préférences d’interface (par exemple le choix exprimé dans le bandeau de consentement) et protection contre les abus.',
            'Aucun cookie publicitaire ni traceur de profilage marketing n’est déposé par le site marketing à ce jour. Si des outils de mesure d’audience venaient à être ajoutés, ils seraient présentés dans cette politique et soumis à votre consentement préalable.',
            'Vous pouvez à tout moment supprimer ou bloquer les cookies et le stockage local depuis les réglages de votre navigateur. Le blocage des cookies strictement nécessaires peut toutefois empêcher la connexion à la plateforme.',
          ],
        },
        {
          title: 'Données de vos clients finaux',
          content: [
            'Lorsque vous importez ou synchronisez vos commandes, la plateforme traite des données relatives à vos propres clients (nom, téléphone, ville et informations de livraison). Dans ce cadre, vous agissez en qualité de responsable du traitement et jisra intervient comme sous-traitant pour votre compte.',
            'Vous garantissez disposer d’une base légale et de l’information nécessaire auprès de vos clients pour ce traitement, et vous vous engagez à ne transmettre que des données pertinentes pour l’exploitation de votre activité.',
            'Ces données sont utilisées exclusivement pour fournir les fonctionnalités demandées (suivi des ventes, rentabilité, livraison, préparation de colis et de bons de ramassage) et ne font l’objet d’aucune exploitation pour notre propre compte.',
          ],
        },
        {
          title: 'Destinataires et sous-traitants',
          content: [
            'L’accès à vos données est limité aux membres de votre organisation selon les rôles et permissions que vous définissez, ainsi qu’aux personnes habilitées de jisra dans le strict cadre du support et de la maintenance.',
            'Nous faisons appel à des prestataires techniques agissant sur nos instructions : hébergement de la base de données et de l’authentification, hébergement et diffusion de l’application, fournisseurs de modèles d’intelligence artificielle pour l’assistance et, lorsque vous les activez, les services tiers connectés (plateforme e-commerce, transporteur, régie publicitaire).',
            'Chaque prestataire est tenu à des obligations de confidentialité et de sécurité. Nous ne partageons aucune donnée avec des tiers à des fins commerciales ou publicitaires sans votre accord explicite, sauf réquisition légale ou judiciaire dûment motivée.',
          ],
        },
        {
          title: 'Transferts hors du Maroc',
          content: [
            'Certains prestataires techniques peuvent héberger ou traiter des données en dehors du territoire marocain, notamment au sein de l’Union européenne ou dans d’autres régions où ils opèrent.',
            'Dans ce cas, nous veillons à ce que ces transferts s’accompagnent de garanties appropriées (encadrement contractuel, engagements de confidentialité et mesures de sécurité conformes aux standards du secteur) et qu’ils respectent la réglementation applicable.',
          ],
        },
        {
          title: 'Durée de conservation',
          content: [
            'Les données de compte et d’exploitation sont conservées pendant toute la durée de la relation contractuelle, puis archivées ou supprimées selon les durées nécessaires à la gestion des litiges et au respect de nos obligations légales.',
            'Les journaux techniques et de sécurité sont conservés pour une durée limitée, proportionnée à leur finalité de détection des incidents et des accès frauduleux.',
            'Les demandes de contact et échanges de prospection sont conservés le temps nécessaire au traitement de la demande, puis pendant une durée limitée permettant la reprise de contact, sauf demande d’effacement de votre part.',
            'À la clôture d’un compte, vous pouvez demander l’export de vos données. Les données concernées sont ensuite supprimées ou anonymisées dans les délais fixés par la version finale de cette politique.',
          ],
        },
        {
          title: 'Sécurité des données',
          content: [
            'Nous mettons en œuvre des mesures techniques et organisationnelles adaptées : chiffrement des échanges, cloisonnement des données par organisation et par boutique, contrôle d’accès par rôles, journalisation des actions sensibles et chiffrement des jetons d’accès aux intégrations tierces.',
            'L’accès aux environnements de production est restreint et tracé. Les mots de passe sont stockés sous forme chiffrée et ne sont jamais accessibles en clair à nos équipes.',
            'Aucun dispositif n’offrant une sécurité absolue, nous vous invitons à protéger vos identifiants, à utiliser des mots de passe uniques et à nous signaler sans délai toute activité suspecte afin que nous puissions réagir rapidement.',
          ],
        },
        {
          title: 'Vos droits',
          content: [
            'Vous disposez d’un droit d’accès, de rectification, d’opposition, de limitation et d’effacement de vos données, ainsi que du droit de retirer votre consentement lorsqu’il constitue la base du traitement. Une partie de ces droits est directement accessible depuis la page Paramètres de la plateforme.',
            'Pour exercer ces droits, écrivez-nous à contact@jisra.io en précisant votre demande et l’adresse email associée à votre compte. Nous répondons dans les délais prévus par la réglementation applicable.',
            'Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de l’autorité compétente, notamment la Commission Nationale de contrôle de la protection des Données à caractère personnel (CNDP) au Maroc, ou l’autorité de contrôle de votre lieu de résidence lorsque le RGPD s’applique.',
          ],
        },
        {
          title: 'Mineurs, modifications et contact',
          content: [
            'La plateforme est destinée à un usage professionnel et n’est pas conçue pour des personnes mineures. Nous ne collectons pas sciemment de données concernant des mineurs.',
            'Cette politique peut évoluer pour refléter des changements de fonctionnalités, de prestataires ou d’exigences légales. Toute modification substantielle sera signalée sur cette page avec une date de mise à jour actualisée.',
            'Pour toute question relative à la confidentialité ou à la protection de vos données, contactez-nous à contact@jisra.io.',
          ],
        },
      ]}
    />
  )
}