# Références — non exécutées par `10_install_objects.sql`

## R-BL4

`20261018213537_dashboard_legacy_financial_permissions.sql` est une copie
exacte de la migration validée sur Test. Elle n'est **pas** incluse dans le
lot d'installation inerte.

Elle est requise avant :

- un mode shadow comparant le legacy sécurisé ;
- un rollback d'affichage vers le lecteur legacy avec masquage financier.

En Production, les objets `_rbl4_*` et `dashboard_legacy_access` sont absents
(0 objet constaté). Le lot R-BL4 doit donc être appliqué et vérifié avant
l'activation du lecteur V5 ou d'un shadow.

Ne pas modifier ce fichier de référence : toute correction doit passer par une
nouvelle migration datée et une nouvelle revue.
