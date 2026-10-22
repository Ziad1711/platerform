# Action 3 — test réel React B13

## Readiness et V5

Readiness fonctionnelles attestées temporairement sur B13 uniquement : socle
legacy/R-BL4 validé, conversions Casablanca conformes IANA 2026c, worker
automatique PASS (preuves existantes, non rejouées). Aucun acquittement de
performance ou autorisation Production. Toutes configurations initiales
restaurées après l'expérience, y compris les trois readiness false.

Compte Auth synthétique auto-confirmé, session navigateur réelle, cohorte V5
limitée à sa boutique. Une seconde boutique synthétique appartient à l'utilisateur
préexistant, sans modifier son compte ; elle sert de sentinelle d'isolation.

V5 observé dans le DOM React : mode=v5, resolved=true, kill=false ; lecteur V5
HTTP 200. Rendu : une commande livrée, CA 200 MAD, achats 80 MAD, profit 120 MAD.
Aucune donnée de la boutique sentinelle dans les payloads lecteur ou le rendu.

## Bascule et limite du verdict

Après confirmation du COMMIT de kill_switch=true :
- DOM React mode=legacy observé à 2 275 ms.
- RPC legacy métriques, revenus et publicité HTTP 200 observées ; capture finale
  à 2 507 ms après confirmation du COMMIT.
- Aucun pageerror JavaScript.

Le runner a déclaré PASS sur ces critères intermédiaires. Cependant sa capture
legacy montre encore des squelettes/chargements et un tunnel indisponible :
il n'a pas attendu la stabilisation des valeurs financières React.
Le résultat brut n'est pas modifié ni effacé ; la présente conclusion est plus
restrictive : bascule de mode et requêtes PASS, mais **kill switch UI complet
NOT COVERED** (délai jusqu'aux cartes legacy correctes non mesuré).
Ne pas présenter 2 507 ms comme un temps de rendu legacy complet.

Deux erreurs non bloquantes pour V5 restent dans l'environnement local :
suivi livraison HTTP 403 FORBIDDEN_ORIGIN et invitations HTTP 500 (clé Admin
volontairement non transmise au processus frontend). Les requêtes externes vers
polices et télémétrie ont été bloquées ; aucun fournisseur externe utilisé.

## Nettoyage PASS

Navigateur et serveur fermés ; compte/profil/sessions synthétiques supprimés,
boutiques/commandes/articles/agrégats/journal/cohorte/runs et télémétrie synthétiques
nettoyés. Tous contenus publics, fonctions, ACL, politiques, triggers et lignes
de configuration identiques à la capture initiale, hors avances de séquences.
Liste des comptes Auth initiaux préservée. Socle legacy conservé.
Fichiers générés par Next restaurés depuis leur capture avant démarrage.

Preuves locales : `C:/Users/HP-EXE/AppData/Local/Temp/b13-action3/RESULT.json`,
`baseline.json`, `final.json`, `v5.png`, `legacy.png` et `server.log`.

Verdict final : readiness fonctionnelles PASS, React V5 PASS, kill switch UI
complet NOT COVERED, restauration PASS. B13 performance FAIL inchangé ; exceptions
non approuvées dans cette mission. Aucune campagne supplémentaire lancée.