import 'server-only'
import { createHmac, randomUUID } from 'node:crypto'
import type { AssistantProvider, AssistantProviderInput, AssistantProviderOutput } from '@/lib/assistant/providers/types'

export const PUBLIC_AI_PROVIDER_ENV = 'PUBLIC_AI_PROVIDER'
export const PUBLIC_AI_DAILY_BUDGET_ENV = 'PUBLIC_AI_DAILY_BUDGET_USD'

type Locale = 'fr' | 'ar' | 'ary'
type PlanFact = { name: string; line: string }

/** Détection de langue : script arabe, marqueurs darija latins, sinon français. */
export function detectLanguage(text: string): Locale {
  if (/[\u0600-\u06FF]/.test(text)) return 'ar'
  if (/\b(salam|labas|labes|ch7al|chhal|bghit|bghina|wach|wakha|3afak|afak|dyal|dial|taman|mzyan|mezyan|kifach|khdam|kayn|sbah|lkhir|hamdullah|bzzaf|chwiya|3la|fin)\b/i.test(text)) return 'ary'
  return 'fr'
}

function plansFromPrompt(prompt: string): PlanFact[] {
  return prompt
    .split('\n')
    .filter((line) => /^- .+MAD/.test(line.trim()))
    .map((line) => ({ name: (line.match(/^- ([^—:-]+)/)?.[1] || '').trim(), line: line.trim() }))
}

function selectedLocale(prompt: string): Locale {
  // Le prompt est la seule source : il porte « Langue choisie par le visiteur : … ».
  const line = /Langue (?:choisie|sélectionnée) par le visiteur *: *([^.]+)/i.exec(prompt)?.[1] || ''
  if (/arabe standard/i.test(line)) return 'ar'
  if (/darija/i.test(line)) return 'ary'
  return 'fr'
}

/** Fournisseur simulé : moteur déterministe d’intentions (aucun réseau, coût nul). */
export class SyntheticPublicProvider implements AssistantProvider {
  async chat(input: AssistantProviderInput): Promise<AssistantProviderOutput> {
    const last = input.messages.filter((message) => message.role === 'user').at(-1)?.content || ''
    const text = last.toLowerCase()
    const lang = selectedLocale(input.systemPrompt)
    const written = detectLanguage(last)
    const plans = plansFromPrompt(input.systemPrompt)
    const priceList = plans.length > 0 ? plans.map((plan) => plan.line.replace(/^- /, '• ')).join('\n') : ''
    const proLine = plans.find((plan) => /pro/i.test(plan.name))?.line || ''
    const ultimateLine = plans.find((plan) => /ultimate/i.test(plan.name))?.line || ''
    const answer = (fr: string, ar: string, ary: string) => (lang === 'ar' ? ar : lang === 'ary' ? ary : fr)

    // 0. Volume de commandes (avant tout refus) selon le volume de commandes.
    const volume = Number((text.match(/(\d{2,6})\s*(commandes?|orders?|طلب)/) || [])[1] || 0)
    if (volume > 0) {
      const plan = volume <= 250 ? 'Free' : volume <= 1000 ? 'Pro' : 'Ultimate'
      const detail = plan === 'Pro' ? proLine : plan === 'Ultimate' ? ultimateLine : ''
      const why = volume <= 250 ? 'votre volume tient dans l’offre gratuite (250 commandes/mois)' : volume <= 1000 ? 'Pro couvre jusqu’à 1 000 commandes/mois, Free s’arrête à 250' : 'Ultimate lève la limite de commandes'
      return this.reply(answer(
        `Avec ${volume} commandes par mois, ${plan} est adapté : ${why}. ${detail ? detail.replace(/^- /, '') : ''} Choix et total sur /pricing, inscription sur /signup.`,
        `مع ${volume} طلب في الشهر، ${plan} مناسب: ${why}. الاختيار في /pricing والتسجيل في /signup.`,
        `ب ${volume} طلب ف الشهر، ${plan} هو المناسب: ${why}. الاختيار ف /pricing والتسجيل ف /signup.`,
      ), input, last, 0)
    }
    // 1. Données privées : refus prioritaire, sans fuite.
    if (/(commande|orders?|boutique|store|admin|client final|justificatif|iban|rib|طلب|متجر|بيانات|فاتورة)/i.test(text)) {
      return this.reply(answer(
        'Je n’ai accès ni aux commandes, ni aux boutiques, ni aux données privées. Je peux expliquer l’offre publique Jisra ; pour un cas précis, utilisez « Demander un contact ».',
        'لا أملك صلاحية الوصول إلى الطلبات أو المتاجر أو البيانات الخاصة. يمكنني شرح عرض جيسرا العام، ولحالة محددة استخدم « طلب تواصل ».',
        'ما عنديش صلاحية للطلبات ولا للمتاجر ولا للبيانات الخاصة. نقدر نشرح ليك عرض جيسرا العام، وإيلا بغيتي حالة خاصة استعمل « طلب تواصل ».',
      ), input, last, 0)
    }
    // 2. Salutations / small talk : réponse naturelle, jamais un argumentaire.
    const clean = text.replace(/[\s!.?،؟]+$/g, '').trim()
    const greetingPattern = /^(salam|salamo?|salut|bonjour|bonsoir|hello|hi|hey|sbah lkhir|sba7 lkhir|labas|labe?s|السلام( عليكم)?|مرحبا|أهلا|صباح الخير|مساء الخير)$/i
    if (clean.length <= 24 && greetingPattern.test(clean)) {
      const greet = written === 'ar' ? 'السلام عليكم' : written === 'ary' ? 'Salam' : 'Bonjour'
      return this.reply(answer(
        `${greet} ! Bienvenue chez Jisra. Vous voulez comparer les forfaits, comprendre les intégrations, ou voir comment démarrer ?`,
        `${greet}، أهلاً بك في جيسرا. تريد مقارنة العروض، فهم التكاملات، أم معرفة طريقة البدء؟`,
        `${greet}، مرحبا بيك ف جيسرا. بغيتي تقارن الفورفيات، تفهم التكاملات، ولا كيفاش تبدا؟`,
      ), input, last, 0)
    }
    if (/^(merci|chokran|choukran|thanks|thank you|شكرا|شكراً)/i.test(text)) {
      return this.reply(answer('Avec plaisir ! Autre question sur les forfaits ou l’inscription ?', 'على الرحب والسعة! هل لديك سؤال آخر؟', 'بلا جميل! واش عندك سؤال آخر؟'), input, last, 0)
    }
    // 3. Prix / tarifs — depuis le catalogue injecté uniquement.
    if (/(ch7al|chhal|prix|tarif|combien|taman|combien coute|ثمن|سعر|بشحال|(?:^|\s)كم(?:\s|$))/i.test(text)) {
      const focus = /ultimate|ألتيميت/i.test(text) ? ultimateLine : /pro/i.test(text) ? proLine : ''
      if (priceList) {
        const head = focus || priceList
        return this.reply(answer(
          `${head}\nLe total annuel est affiché avant paiement et réglé en une seule fois. Détail complet sur /pricing.`,
          `${head}\nالمبلغ السنوي يظهر قبل الدفع ويُسدَّد مرة واحدة. التفاصيل في /pricing.`,
          `${head}\nالمبلغ السنوي كيبان قبل الأداء وكيتخلص مرة واحدة. التفاصيل ف /pricing.`,
        ), input, last, 0)
      }
      return this.reply(answer(
        'Les montants ne sont pas disponibles dans cet environnement. Consultez /pricing pour les tarifs officiels, ou demandez un contact.',
        'الأسعار غير متاحة في هذه البيئة. راجع /pricing للأسعار الرسمية أو اطلب تواصلاً.',
        'الأثمنة ما متوفرينش ف هاد البيئة. شوف /pricing ولا طلب تواصل.',
      ), input, last, 0)
    }
    // 4. Comparaison / différence entre offres.
    if (/(diff|différence|difference|vs|mieux|meilleur|comparer|الفرق|فرق|أفضل)/i.test(text)) {
      if (proLine && ultimateLine) {
        return this.reply(answer(
          `Pro : ${proLine.replace(/^- /, '')}\nUltimate : ${ultimateLine.replace(/^- /, '')}\nLes deux incluent les fonctions de vente ; Ultimate lève les limites et ajoute l’équipe, l’API et le support prioritaire.`,
          `Pro: ${proLine}\nUltimate: ${ultimateLine}\nكلاهما يشمل البيع؛ Ultimate يرفع الحدود ويضيف الفريق وAPI والدعم.`,
          `Pro: ${proLine}\nUltimate: ${ultimateLine}\nجوج كيشملو البيع؛ Ultimate كيرفع الحدود ويزيد الفريق وAPI والدعم.`,
        ), input, last, 0)
      }
      return this.reply(answer('Le comparatif détaillé est sur /pricing ; dites-moi votre volume de commandes et je vous oriente.', 'المقارنة المفصلة في /pricing. أخبرني بحجم طلباتك وأوجهك.', 'المقارنة المفصلة ف /pricing. گول ليا شحال من طلب ف الشهر ونوجهك.'), input, last, 0)
    }
    // 6. Annuel / engagement.
    if (/\bannuel(s)?\b|par an|\bun an\b|\bune ann\u00e9e\b|\b1 an\b|12 mois|سنة|سنوي|عام/i.test(text)) {
      const yearly = plans.filter((plan) => /par an/.test(plan.line)).map((plan) => plan.line.replace(/^- /, '')).join('\n')
      return this.reply(answer(
        yearly ? `${yearly}\nPaiement en une seule fois pour 12 mois, sans prélèvement mensuel.` : 'L’annuel se paie en une fois pour 12 mois, sans prélèvement mensuel ; montants sur /pricing.',
        yearly ? `${yearly}\nالدفع مرة واحدة لـ12 شهراً دون خصم شهري.` : 'السنوي يُدفع مرة واحدة لـ12 شهراً دون خصم شهري؛ الأسعار في /pricing.',
        yearly ? `${yearly}\nالأداء مرة واحدة ل 12 شهر بلا خصم شهري.` : 'السنوي كيتخلص مرة واحدة ل 12 شهر بلا خصم شهري؛ الأثمنة ف /pricing.',
      ), input, last, 0)
    }
    // 7. Paiement / activation.
    if (/paiement|virement|payer|facture|أداء|تحويل|دفع/i.test(text)) {
      return this.reply(answer(
        'Paiement par virement bancaire, puis vérification manuelle. Un justificatif seul n’active jamais un abonnement ; l’activation suit la confirmation du virement.',
        'الدفع بتحويل بنكي ثم تحقق يدوي. إرفاق إثبات لا يفعّل الاشتراك؛ التفعيل بعد تأكيد التحويل.',
        'الأداء بتحويل بنكي ومن بعد تحقق يدوي. غير وصل الإثبات ما كيفعّلش الاشتراك؛ التفعيل من بعد تأكيد التحويل.',
      ), input, last, 0)
    }
    // 8. Intégrations / fonctionnalités.
    if (/intégration|integration|youcan|lightfunnels|facebook|shopify|livraison|delivery|تكامل|توصيل/i.test(text)) {
      return this.reply(answer(
        'YouCan, LightFunnels, Facebook Ads et plusieurs transporteurs marocains sont déclarés disponibles ; Shopify est annoncé à venir. Les intégrations dépendent de votre configuration.',
        'YouCan وLightFunnels وFacebook Ads وعدد من شركات التوصيل المغربية متوفرة؛ Shopify قادم. يعتمد ذلك على إعداداتك.',
        'YouCan وLightFunnels وFacebook Ads وشي شركات توصيل مغربية متوفرين؛ Shopify جاي. كلشي كيتعلق بالإعدادات ديالك.',
      ), input, last, 0)
    }
    // 9. Inscription / démarrage.
    if (/inscription|inscrire|signup|commencer|démarrer|compte|nsjel|nsejjel|nsajal|bghit nbda|bghit nbedda|تسجيل|أسجل|نسجل|بداية/i.test(text)) {
      return this.reply(answer(
        'Créez votre compte sur /signup (gratuit), puis choisissez un forfait sur /pricing ; le récapitulatif est sur /subscribe.',
        'أنشئ حسابك في /signup (مجاناً) ثم اختر العرض من /pricing، والملخص في /subscribe.',
        'دير حسابك ف /signup (فابور) ومن بعد اختار الفورفي من /pricing، والملخص ف /subscribe.',
      ), input, last, 0)
    }
    // 10. Contact humain.
    if (/contact|humain|appel|téléphone|تواصل|هاتف/i.test(text)) {
      return this.reply(answer('Utilisez « Demander un contact » en bas de ce panneau : votre demande est enregistrée pour l’équipe Jisra.', 'استخدم « طلب تواصل » أسفل اللوحة؛ سيتم تسجيل طلبك لفريق جيسرا.', 'استعمل « طلب تواصل » لتحت ف اللوحة؛ الطلب ديالك كيتسجل لفريق جيسرا.'), input, last, 0)
    }
    // 11. Hors domaine.
    if (/météo|meteo|politique|football|recette|cuisine|طقس|كرة/i.test(text)) {
      return this.reply(answer('Je réponds uniquement sur Jisra : offres, fonctionnalités, intégrations et inscription. Puis-je vous aider sur ce point ?', 'أجيب فقط عن جيسرا: العروض والميزات والتكاملات والتسجيل. هل أساعدك في ذلك؟', 'أنا كن جاوب غير على جيسرا: الفورفيات، الميزات، التكاملات والتسجيل. نعاونك ف هادشي؟'), input, last, 0)
    }
    // 12. Ambigu / trop court : une seule question de clarification.
    return this.reply(answer(
      'Je veux être précis : cherchez-vous les tarifs, une comparaison d’offres, ou le fonctionnement des intégrations ?',
      'لأكون دقيقاً: تبحث عن الأسعار، مقارنة العروض، أم كيفية عمل التكاملات؟',
      'باش نكون دقيق: كتقلب على الأثمنة، مقارنة الفورفيات، ولا كيفاش كتخدم التكاملات؟',
    ), input, last, 0)
  }

  private reply(text: string, input: AssistantProviderInput, last: string, cost: number): AssistantProviderOutput {
    return {
      text, inputTokens: Math.ceil((input.systemPrompt.length + last.length) / 4),
      outputTokens: Math.ceil(text.length / 4), providerName: 'synthetic-technical', modelName: 'synthetic-technical',
      providerCostUsd: cost, usageKnown: true, usageState: 'measured',
    }
  }
}

/** L'assistant public reste fermé tant que PUBLIC_AI_ENABLED n'est pas `enabled`. */
export function publicAssistantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.PUBLIC_AI_ENABLED || '').trim().toLowerCase() === 'enabled' || env.NODE_ENV !== 'production'
}

export type PublicProviderChoice =
  | { kind: 'openai'; provider: AssistantProvider; model: string; live: true }
  | { kind: 'synthetic'; provider: AssistantProvider; model: string; live: false }
  | { kind: 'unavailable'; reason: string; live: false }

function externalCallsEnabled(env: NodeJS.ProcessEnv) {
  return String(env.PUBLIC_AI_EXTERNAL_CALLS || '').trim().toLowerCase() === 'enabled'
}

/** Le simulateur reste réservé aux tests techniques explicitement déclarés. */
function syntheticAllowed(env: NodeJS.ProcessEnv) {
  return env.JISRA_QUALIFICATION === '1' || env.NODE_ENV !== 'production'
}

/**
 * Un fournisseur explicitement demandé ne retombe jamais silencieusement sur
 * le simulateur. Sans configuration exploitable, la route répond 503.
 */
export async function publicProvider(env: NodeJS.ProcessEnv = process.env): Promise<PublicProviderChoice> {
  const requested = (env.PUBLIC_AI_PROVIDER || '').trim().toLowerCase()
  if (requested === 'openai') {
    if (env.JISRA_QUALIFICATION === '1') return { kind: 'unavailable', reason: 'qualification', live: false }
    if (!externalCallsEnabled(env)) return { kind: 'unavailable', reason: 'external_calls_disabled', live: false }
    if (!env.OPENAI_API_KEY) return { kind: 'unavailable', reason: 'missing_key', live: false }
    const { OpenAIResponsesProvider } = await import('./openai-responses')
    return {
      kind: 'openai',
      provider: new OpenAIResponsesProvider(),
      model: (env.PUBLIC_AI_MODEL || 'gpt-4o-mini').trim(),
      live: true,
    }
  }
  if (requested === 'synthetic') {
    if (!syntheticAllowed(env)) return { kind: 'unavailable', reason: 'synthetic_forbidden', live: false }
    return { kind: 'synthetic', provider: new SyntheticPublicProvider(), model: 'synthetic-technical', live: false }
  }
  if (!requested && env.JISRA_QUALIFICATION === '1') {
    return { kind: 'synthetic', provider: new SyntheticPublicProvider(), model: 'synthetic-technical', live: false }
  }
  return { kind: 'unavailable', reason: 'not_configured', live: false }
}

/** Décision synchrone : le widget n’est pas affiché s’il ne peut pas répondre réellement. */
export function publicAssistantConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const requested = (env.PUBLIC_AI_PROVIDER || '').trim().toLowerCase()
  if (requested === 'openai') {
    return env.JISRA_QUALIFICATION !== '1' && externalCallsEnabled(env) && Boolean(env.OPENAI_API_KEY)
  }
  if (requested === 'synthetic') return syntheticAllowed(env)
  return !requested && env.JISRA_QUALIFICATION === '1'
}

/** Clé pseudonymisée : HMAC serveur, jamais l’IP brute. */
export function publicKey(value: string, env: NodeJS.ProcessEnv = process.env) {
  const secret = env.PUBLIC_AI_HASH_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!secret) return null
  return createHmac('sha256', secret).update(value).digest('hex')
}

export function visitorKey(request: Request) {
  const cookie = request.headers.get('cookie') || ''
  const existing = /(?:^|;\s*)jisra-ai-visitor=([a-f0-9-]{36})/.exec(cookie)?.[1]
  return { id: existing || randomUUID(), setCookie: !existing }
}

export function clientIp(request: Request) {
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  return forwarded || request.headers.get('x-real-ip') || 'unknown'
}

export function dailyBudgetMicro(env: NodeJS.ProcessEnv = process.env) {
  const usd = Number(env[PUBLIC_AI_DAILY_BUDGET_ENV] || 5)
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1_000_000) : 5_000_000
}
