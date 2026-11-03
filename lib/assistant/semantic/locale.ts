/**
 * Profil de communication de l'assistant.
 *
 * La langue, l'écriture et la direction sont trois notions distinctes :
 * - `locale` : variété linguistique attendue pour la rédaction ;
 * - `script`  : alphabet réellement utilisé (la darija peut être latine) ;
 * - `direction` : sens de lecture déduit de l'écriture, jamais du pays.
 *
 * Aucun module ne doit déduire la direction à partir de la locale seule.
 */

export type AssistantLocale = 'fr' | 'ar' | 'darija' | 'en'
export type TextScript = 'latin' | 'arabic'
export type TextDirection = 'ltr' | 'rtl'

export interface CommunicationProfile {
  locale: AssistantLocale
  script: TextScript
  direction: TextDirection
}

/** Locales reconnues par le moteur, dans l'ordre de préférence par défaut. */
export const ASSISTANT_LOCALES: readonly AssistantLocale[] = ['fr', 'ar', 'darija', 'en']

/**
 * Marqueurs darija en écriture arabe. Volontairement des mots-outils fréquents :
 * aucune expression ne doit dépendre d'une question précise.
 */
const DARIJA_ARABIC = /(?:واش|شنو|بغيت|بغا|ديال|هاد|دابا|شحال|كيفاش|مزيان|عطيني|شوف|كاين|ماكاين|بزاف|شوية|دير|ديري|خاصني|عندي|سافي|والو|دغيا|غير|علاش|فين|منين|أش|اش)/

/** Marqueurs darija en écriture latine (transcription usuelle). */
const DARIJA_LATIN = /\b(?:wach|wa?ch|bghit|bgha|dyal|dial|had|hadak|daba|daba|ch7al|chhal|kifach|kifech|mzyan|mzyana|3tini|3afak|chouf|chof|kayn|makaynch|bezzaf|chwiya|safi|walou|dghia|3lach|fin|mnin|sir|khassni|3ndi|derte|dert|kaynin|machi|rah|rahou|zwina|zwin|taman|bezaf|nqdr|n9dr|khasna)\b/i

/** Marqueurs anglais non ambigus (évite de classer « store » ou « profit »). */
const ENGLISH_MARKERS = /\b(?:the|and|with|what|which|how|much|many|please|show|give|compare|between|revenue|orders?|last|this|month|week|year|delivered|summary|report|rate|best|worst)\b/gi

const ARABIC_CHAR = /[\u0600-\u06FF]/
const ARABIC_CHARS = /[\u0600-\u06FF]/g
const LATIN_CHARS = /[A-Za-z]/g

/** Part de caractères arabes parmi les lettres réellement présentes. */
export function arabicLetterShare(message: string): number {
  const arabic = (message.match(ARABIC_CHARS) ?? []).length
  const latin = (message.match(LATIN_CHARS) ?? []).length
  const total = arabic + latin
  return total === 0 ? 0 : arabic / total
}

/** Direction naturelle d'un texte, sans tenir compte des chiffres. */
export function directionOfScript(script: TextScript): TextDirection {
  return script === 'arabic' ? 'rtl' : 'ltr'
}

/**
 * Détecte le profil de communication d'un message.
 *
 * Règles :
 * - une écriture arabe significative impose le script arabe et la direction RTL ;
 * - la darija latine n'est jamais assimilée au français ;
 * - un message sans signal fort reste en français, valeur par défaut du produit.
 */
export function detectCommunicationProfile(message: string): CommunicationProfile {
  const text = String(message ?? '')
  const share = arabicLetterShare(text)
  const hasArabic = share > 0 && ARABIC_CHAR.test(text)

  if (hasArabic && share >= 0.2) {
    return {
      locale: DARIJA_ARABIC.test(text) ? 'darija' : 'ar',
      script: 'arabic',
      direction: 'rtl',
    }
  }

  if (DARIJA_LATIN.test(text)) {
    return { locale: 'darija', script: 'latin', direction: 'ltr' }
  }

  const englishHits = (text.match(ENGLISH_MARKERS) ?? []).length
  const frenchHits = (text.match(/\b(?:le|la|les|des|du|de|et|avec|pour|quel|quelle|quels|quelles|combien|montre|compare|mois|semaine|année|ventes|commandes|livrées|chiffre)\b/gi) ?? []).length

  if (englishHits > 0 && englishHits > frenchHits) {
    return { locale: 'en', script: 'latin', direction: 'ltr' }
  }

  return { locale: 'fr', script: 'latin', direction: 'ltr' }
}

/** Profil par défaut, utilisé lorsqu'aucun message n'est encore disponible. */
export function defaultCommunicationProfile(): CommunicationProfile {
  return { locale: 'fr', script: 'latin', direction: 'ltr' }
}

/**
 * Direction d'une valeur isolée (nombre, date, montant, référence).
 * Ces séquences restent toujours LTR, quelle que soit la phrase qui les porte.
 */
export function valueDirection(): TextDirection {
  return 'ltr'
}
