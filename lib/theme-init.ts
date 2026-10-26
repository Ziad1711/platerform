/**
 * Thème : source unique partagée par le script d'amorçage (avant le premier
 * paint) et par `components/providers.tsx` (état React).
 *
 * Le thème n'est volontairement pas déduit du profil utilisateur ici : aucune
 * requête n'est faite avant l'affichage. La préférence enregistrée en base est
 * appliquée ensuite, sans écraser un choix explicite de l'appareil.
 */

/** Clé `localStorage` de la préférence de thème. */
export const THEME_STORAGE_KEY = 'theme'

export type Theme = 'light' | 'dark' | 'system'

export const isThemeValue = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system'

/**
 * Script bloquant injecté dans `<head>` : applique la classe `dark` et
 * `color-scheme` sur `<html>` AVANT le premier paint.
 *
 * Sans lui, le thème n'était posé qu'après hydratation, en deux temps : l'état
 * initial `system` pouvait peindre un fond sombre (OS sombre) avant que la
 * préférence claire stockée ne soit relue — d'où le flash sombre → clair.
 *
 * Contraintes respectées :
 * - aucune requête réseau, aucune dépendance à React ;
 * - aucune écriture : `localStorage` n'est jamais modifié ici (une préférence
 *   ne peut donc pas être écrasée au passage) ;
 * - tolérant aux erreurs (stockage indisponible, mode privé) ;
 * - compatible avec une future CSP stricte : aucun `eval`, aucune ressource
 *   externe (le script devra alors être autorisé par hash/nonce).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'&&t!=='system'){t='system'}var d=t==='dark'||(t==='system'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d){r.classList.add('dark');r.style.colorScheme='dark'}else{r.classList.remove('dark');r.style.colorScheme='light'}}catch(e){}})()`
