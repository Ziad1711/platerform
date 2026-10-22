# Dernière vérification de stabilisation legacy

Test réel sur B13 uniquement, avec le lanceur sécurisé et une session navigateur
synthétique auto-confirmée. Preuves readiness existantes réutilisées ; flags
temporaires restaurés exactement à leur état initial.

- React V5 affiché : PASS (commande livrée 1, CA 200, charges 80, profit 120).
- DOM legacy après confirmation COMMIT du kill switch : **2 703 ms**.
- RPC métriques, revenus et publicité : HTTP **200**.
- Attente des six valeurs legacy correctes, sans squelette, stables pendant
  750 ms : **expiration après 15 secondes d'attente supplémentaires**.
  Attendus : commandes 1, livrées 1, CA 200 MAD, charges 80 MAD,
  publicité 0 MAD, profit 120 MAD.
- Le délai cible global de 15 s n'est donc pas démontré ; aucun temps de rendu
  stabilisé ni PASS UI complet ne doit être annoncé.
- Aucun pageerror JavaScript. Livraison 403 et invitations 500 restent des
  erreurs annexes de l'environnement local, déjà identifiées.

Limite : la capture détaillée des cartes au moment de l'expiration n'a pas été
conservée. Le timeout ne permet donc pas à lui seul d'attribuer l'échec au rendu,
aux valeurs ou au sélecteur DOM du contrôle. Les HTTP 200 ne prouvent pas le rendu.

Verdict du contrôle de stabilisation : FAIL (condition attendue non obtenue),
pas de démonstration d'un défaut métier particulier. Aucun nouvel essai lancé.

Nettoyage : PASS. Compte/profil/sessions, boutiques, commandes, articles,
agrégats, journal, cohorte et runs synthétiques supprimés. Contenus publics,
fonctions/ACL/politiques/triggers/configurations identiques à la capture initiale,
hors séquences. Utilisateurs initiaux préservés. Serveur et navigateur fermés ;
fichiers générés Next restaurés. Socle legacy conservé.

Preuves : `C:/Users/HP-EXE/AppData/Local/Temp/b13-action3-stable/`
(`RESULT.json`, `baseline.json`, `final.json`, `server.log`, `v5.png`).

B13 performance reste FAIL ; aucun changement des seuils, aucun commit,
déploiement ou écriture Production/TEST/P7.