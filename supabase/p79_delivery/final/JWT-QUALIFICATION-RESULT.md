# Qualification Auth et JWT B13

Cible unique : `biqrgdopcvkrbgfxkzxm`, service PostgreSQL `b13-isolated`.

## Résultats réels

- Auth Admin : PASS. Création auto-confirmée (`email_confirm: true`), sans
  inscription publique, invitation ni demande d'envoi de courriel.
- Trois identités temporaires sur le domaine réservé `example.invalid` :
  propriétaire A, commercial A (`marketer` selon le contrat installé), propriétaire B.
- Connexion par mot de passe avec le client public B13 sécurisé : trois vrais
  JWT délivrés par Auth et identités vérifiées avec `getUser`.
- Lecteur owner : accès `full`. Commercial : accès `commercial`, aucun champ
  `purchase_cost`, `delivery_fee_cost`, `confirmation_cost`, `contribution_margin`
  ou `margin_rate` dans la réponse entière.
- Sélections de boutiques étrangères : aucune donnée KPI divulguée ; requêtes
  directes `orders` : zéro ligne via RLS, dans les trois cas testés.
- Sélection mixte : seule la boutique autorisée est retournée.
- Révocation du commercial : même JWT conservé ; lecteur KPI et lecture orders
  désormais refusés ou vides. Aucun renouvellement du JWT pour obtenir ce résultat.

## Limites

Kill switch client/UI : NOT COVERED. Aucun frontend React authentifié B13
exécuté ; aucun indicateur readiness forcé ni cohorte V5 activée.
Ces tests portent sur le lecteur et la lecture orders ; ils ne constituent pas
une qualification exhaustive des permissions d'écriture.

## Nettoyage

Déconnexion globale, suppression Auth Admin des trois identités de la campagne ;
absence vérifiée dans `auth.users`, `auth.sessions`, `auth.refresh_tokens` et
`public.profiles`. Liste des utilisateurs initiaux identique. Aucun utilisateur
existant modifié.

Toutes les données publiques, fonctions, attributs, ACL, politiques, configurations
et triggers identiques à la capture initiale après nettoyage. Seules les séquences
peuvent avancer normalement. C0 préservée, six producteurs actifs, worker arrêté,
lecteur legacy, zéro fixture.

Un premier essai a rencontré une FK owner/profiles avant création de boutiques :
les trois comptes ont été supprimés et la restauration vérifiée. Le second essai
a provisionné explicitement les seuls profils synthétiques et terminé avec succès.

Preuves locales sans mots de passe ni JWT :
`C:/Users/HP-EXE/AppData/Local/Temp/b13-jwt-qualification/RESULT.json`,
`baseline.json` et `final.json`.

B13 performance conserve son verdict FAIL ; aucune exception approuvée ici.
La clé administrative exposée dans la conversation doit toujours être remplacée.