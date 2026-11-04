/**
 * Catalogue de messages de l'assistant.
 *
 * Un seul endroit contient **tous** les textes visibles : titres de sections,
 * libellés d'indicateurs, en-têtes de tableaux, réserves, états vocaux et
 * erreurs publiques. Aucun composant ne doit contenir de phrase codée en dur.
 *
 * Le français sert de base : chaque locale le surcharge, ce qui garantit qu'une
 * clé oubliée reste lisible au lieu d'afficher un identifiant technique.
 */
import type { AssistantLocale } from '@/lib/assistant/semantic/locale'

export type Dictionary = Readonly<Record<string, string>>

const FR: Dictionary = {
  'analysis.decomposition': '{period} : le CA réalisé de {revenue}, diminué des achats, de la livraison, de la confirmation et de la publicité, donne une marge contributive de {margin}. Ce n’est pas un bénéfice net.',
  'analysis.hypothesis': 'Hypothèse à vérifier pour {metric} ({period}) : contrôler la couverture et le mix des commandes. Aucune cause n’est établie par cette variation seule.',
  /* ---- Indicateurs ---- */
  'metric.totalOrders': 'Commandes',
  'metric.deliveredOrders': 'Livrées',
  'metric.returnedOrders': 'Retours',
  'metric.cancelledOrders': 'Annulations',
  'metric.revenue': 'CA réalisé',
  'metric.revenueEstimated': 'CA estimé',
  'metric.adSpend': 'Publicité',
  'metric.deliveryRate': 'Taux de livraison',
  'metric.purchaseCost': "Coût d'achat",
  'metric.deliveryCost': 'Coût de livraison',
  'metric.confirmationCost': 'Coût de confirmation',
  'metric.contributionMargin': 'Marge contributive',

  /* ---- Indicateurs dérivés ---- */
  'derived.ordersPerDay': 'Commandes / jour',
  'derived.deliveredPerDay': 'Livrées / jour',
  'derived.revenuePerDay': 'CA / jour',
  'derived.revenuePerDelivered': 'CA par livrée',

  /* ---- Titres de blocs ---- */
  'title.verdict': 'Verdict',
  'title.figures': 'Chiffres clés',
  'title.strengths': 'Points forts',
  'title.weaknesses': 'Points faibles',
  'title.recommendations': 'Recommandations',
  'title.comparison': 'Comparaison',
  'title.trend': 'Évolution',
  'title.breakdown': 'Répartition',

  /* ---- Tableaux ---- */
  'table.indicator': 'Indicateur',
  'table.current': 'Période',
  'table.baseline': 'Référence',
  'table.delta': 'Écart',
  'table.value': 'Valeur',
  'table.days': 'Jours',
  'table.name': 'Nom',

  /* ---- Phrases de synthèse ---- */
  'summary.comparison': '{current} comparé à {baseline}.',
  'summary.single': 'Analyse de {period}.',
  'summary.comparisons': '{count} comparaisons demandées : chaque période est présentée séparément.',
  'title.comparisonPair': '{current} vs {baseline}',
  'summary.noFigures': 'Aucune valeur chiffrée fiable ne peut être publiée pour cette demande.',

  /* ---- Réserves et limites ---- */
  'reason.coverage_partial': 'Couverture partielle sur une partie de la période.',
  'reason.duration_differs': 'Durées différentes ({currentDays} et {baselineDays} jours).',
  'reason.definition_differs': 'Définitions de calcul différentes entre les deux périodes.',
  'reason.metric_missing': 'Indicateur disponible sur une seule période.',
  'reason.access_denied': 'Accès financier insuffisant pour cet indicateur.',
  'reason.stale': 'Agrégat à rafraîchir : la comparaison est provisoire.',
  'reason.cohort_immature': 'Période récente : les livraisons peuvent encore évoluer.',

  /* ---- Limites explicites (jamais silencieuses) ---- */
  'limit.netProfit': "Le bénéfice net n'est pas défini par le contrat analytique actuel : la marge contributive est publiée à la place, sans charges fixes déduites.",
  'limit.metricUnavailable': '{metric} n’est pas publié pour cette période.',
  'limit.dimensionUnavailable': 'La ventilation demandée n’a pas pu être lue : aucune valeur de détail n’est publiée.',
  'limit.productProfit': 'Profit produit : ventes moins achats, hors publicité, livraison et confirmation.',
  'limit.dimensionSubset': 'Détail limité : ces lignes ne représentent pas nécessairement le total de la période.',
  'limit.dimensionsTruncated': '{kept} ventilation(s) affichée(s) sur {total} : les autres sont omises.',
  'limit.dimensionScope': 'Ventilations calculées sur {period} uniquement, pas sur chaque période comparée.',
  'limit.kpiTruncated': '{kept} indicateur(s) affiché(s) sur {total} : les autres sont omis.',
  'limit.tableRowsTruncated': '{kept} ligne(s) affichée(s) sur {total} : les autres sont omises.',
  'narrative.up': '{metric} : en hausse.',
  'narrative.down': '{metric} : en baisse.',
  'narrative.flat': '{metric} : stable.',

  /* ---- Dimensions réellement lues ---- */
  'dim.city': 'Ville',
  'dim.product': 'Produit',
  'dim.productName': 'Produit',
  'dim.agent': 'Agent',
  'dim.agentName': 'Agent',
  'dim.status': 'Statut',
  'dim.quantity': 'Quantité',
  'dim.name': 'Nom',
  'dim.confirmationRate': 'Taux de confirmation',
  'dim.profit': 'Profit produit',
  'dim.confirmedOrders': 'Confirmées',
  'dim.sentOrders': 'Expédiées',
  'dim.pendingOrders': 'En attente',
  'dim.waitingPickupOrders': 'En attente de ramassage',
  'dim.title.city': 'Par ville',
  'dim.title.product': 'Par produit',
  'dim.title.agent': 'Par agent',
  'dim.title.status': 'Dernières commandes',
  'dim.title.confirmation': 'Confirmation',
  'dim.title.delivery': 'Livraison',
  'dim.title.stock': 'Stock',

  'absence.empty': 'Aucune commande enregistrée sur cette période.',
  'absence.no_coverage': "Cette période n'a pas encore d'agrégat disponible.",
  'absence.partial': 'Une partie seulement de la période est couverte par les agrégats.',
  'absence.unavailable': 'La lecture a échoué : impossible de conclure à une absence de données.',
  'absence.range': 'Période invalide ou trop large pour être analysée.',
  'absence.access': 'Accès refusé pour cette période.',
  'absence.budget': "Analyse limitée : le budget d'exécution a été atteint.",
  'absence.unknown': 'Résultat non disponible pour cette période.',
  'absence.none': '',

  'notice.limits': 'Limites',
  'notice.moreLimits': 'Autres limites',

  /* ---- Clarification ---- */
  'clarify.period': 'Quelle période souhaitez-vous analyser ?',

  /* ---- Verdict comparatif ---- */
  'verdict.better': '{period} ressort meilleur sur {metric}.',
  'verdict.worse': '{period} ressort plus faible sur {metric}.',
  'verdict.equal': '{metric} est stable entre les deux périodes.',
  'verdict.noDelta': 'Aucun écart interprétable ne peut être publié.',

  /* ---- Recommandations (toujours adossées à un fait) ---- */
  'reco.deliveryRate': 'Taux de livraison à {value} : vérifier les commandes non livrées avant de conclure sur la rentabilité.',
  'reco.confirmation': 'Confirmation à {value} : suivre les commandes encore en attente avant d’augmenter le volume.',
  'reco.ads': 'Publicité à {value} pour {revenue} de CA réalisé : contrôler le coût par commande livrée.',
  'reco.ordersSpike': 'Volume en hausse de {delta} : confirmer que la capacité de livraison suit.',
  'reco.ordersDrop': 'Volume en baisse de {delta} : vérifier l’approvisionnement publicitaire et la confirmation.',

  /* ---- Graphiques ---- */
  'chart.title.daily': 'Évolution quotidienne',
  'chart.title.orders': 'Commandes par jour',
  'chart.title.revenue': 'CA par jour',
  'chart.orders': 'Commandes',
  'chart.delivered': 'Livrées',
  'chart.revenue': 'CA réalisé',

  /* ---- Vocal ---- */
  'voice.label': 'Enregistrement vocal',
  'voice.recording': 'Enregistrement en cours',
  'voice.encoding': 'Préparation de l’audio…',
  'voice.ready': 'Enregistrement prêt',
  'voice.transcribing': 'Transcription en cours…',
  'voice.cancel': 'Annuler l’enregistrement',
  'voice.stop': 'Arrêter l’enregistrement',
  'voice.send': 'Envoyer l’enregistrement',
  'voice.retry': 'Réessayer l’envoi',
  'voice.tooLong': 'Enregistrement trop long : la dictée est limitée à deux minutes.',
  'voice.empty': 'Aucune parole détectée dans l’enregistrement.',
  'voice.failed': 'Transcription impossible pour le moment.',
  'voice.readyHint': 'Écoutez ou envoyez la dictée.',

  /* ---- Saisie ---- */
  'composer.placeholder': 'Posez votre question business...',
  'composer.label': 'Message à envoyer',
  'composer.voice': 'Dicter un message',

  /* ---- Suggestions ---- */
  'suggest.analyze': 'Analyse mon business',
  'suggest.compare': 'Compare deux périodes',
  'suggest.cities': 'Performance par ville',

  /* ---- Erreurs publiques ---- */
  'error.generic': 'Une erreur est survenue. Réessayez dans un instant.',
  'error.noCredits': 'Vous n’avez plus de crédits IA.',
}

const AR: Dictionary = {
  ...FR,
  'metric.totalOrders': 'الطلبات',
  'metric.deliveredOrders': 'الطلبات المسلّمة',
  'metric.returnedOrders': 'المرتجعات',
  'metric.cancelledOrders': 'الإلغاءات',
  'metric.revenue': 'رقم المعاملات المحقق',
  'metric.revenueEstimated': 'رقم المعاملات التقديري',
  'metric.adSpend': 'مصاريف الإعلانات',
  'metric.deliveryRate': 'نسبة التسليم',
  'metric.purchaseCost': 'تكلفة الشراء',
  'metric.deliveryCost': 'تكلفة التوصيل',
  'metric.confirmationCost': 'تكلفة التأكيد',
  'metric.contributionMargin': 'الهامش المساهم',
  'derived.ordersPerDay': 'طلبات في اليوم',
  'derived.deliveredPerDay': 'مسلّمة في اليوم',
  'derived.revenuePerDay': 'المعاملات في اليوم',
  'derived.revenuePerDelivered': 'المعاملات لكل طلب مسلّم',
  'title.verdict': 'الخلاصة',
  'title.figures': 'الأرقام الأساسية',
  'title.strengths': 'نقاط القوة',
  'title.weaknesses': 'نقاط الضعف',
  'title.recommendations': 'التوصيات',
  'title.comparison': 'مقارنة',
  'title.trend': 'التطور',
  'title.breakdown': 'التوزيع',
  'table.indicator': 'المؤشر',
  'table.current': 'الفترة',
  'table.baseline': 'المرجع',
  'table.delta': 'الفرق',
  'table.value': 'القيمة',
  'table.days': 'الأيام',
  'table.name': 'الاسم',
  'summary.comparison': '{current} مقارنة بـ {baseline}.',
  'summary.single': 'تحليل {period}.',
  'summary.noFigures': 'لا يمكن نشر أي قيمة رقمية موثوقة لهذا الطلب.',
}

const AR_REST: Dictionary = {
  'analysis.decomposition': '{period}: المبيعات المحققة {revenue} ناقص المشتريات والتوصيل والتأكيد والإعلانات تعطي هامش مساهمة {margin}. هذا ليس ربحًا صافيًا.',
  'analysis.hypothesis': 'فرضية للتحقق بخصوص {metric} ({period}): راجع التغطية وتوزيع الطلبات. هذا الفرق وحده لا يثبت أي سبب.',
  ...AR,
  'reason.coverage_partial': 'التغطية جزئية على جزء من الفترة.',
  'reason.duration_differs': 'مدتان مختلفتان ({currentDays} و {baselineDays} يومًا).',
  'reason.definition_differs': 'طريقة الحساب مختلفة بين الفترتين.',
  'reason.metric_missing': 'المؤشر متوفر في فترة واحدة فقط.',
  'reason.access_denied': 'الصلاحية المالية غير كافية لهذا المؤشر.',
  'reason.stale': 'التجميع يحتاج تحديثًا: المقارنة مؤقتة.',
  'reason.cohort_immature': 'فترة حديثة: قد تتغير عمليات التسليم.',
  'summary.comparisons': '{count} مقارنات مطلوبة: كل فترة معروضة على حدة.',
  'title.comparisonPair': '{current} مقابل {baseline}',
  'limit.netProfit': 'الربح الصافي غير محدد في عقد التحليلات الحالي: يُعرض هامش المساهمة بدلًا منه، قبل الخصم الثابت.',
  'limit.metricUnavailable': '{metric} غير منشور لهذه الفترة.',
  'limit.dimensionUnavailable': 'لم يتم قراءة التوزيع المطلوب: لا تُنشر أي قيمة تفصيلية.',
  'limit.productProfit': 'ربح المنتج: المبيعات ناقص المشتريات، دون الإعلانات والتوصيل والتأكيد.',
  'limit.dimensionSubset': 'تفاصيل محدودة: هذه السطور لا تمثل بالضرورة إجمالي الفترة.',
  'dim.city': 'المدينة',
  'dim.product': 'المنتج',
  'dim.agent': 'الموظف',
  'dim.status': 'الحالة',
  'dim.quantity': 'الكمية',
  'dim.name': 'الاسم',
  'dim.confirmationRate': 'نسبة التأكيد',
  'dim.productName': 'المنتج',
  'dim.agentName': 'الموظف',
  'dim.profit': 'ربح المنتج',
  'dim.confirmedOrders': 'مؤكدة',
  'dim.sentOrders': 'مُرسلة',
  'dim.pendingOrders': 'قيد الانتظار',
  'dim.waitingPickupOrders': 'في انتظار الاستلام',
  'limit.dimensionsTruncated': 'تم عرض {kept} توزيع من {total}: الباقي محذوف.',
  'limit.dimensionScope': 'التوزيعات محسوبة على {period} فقط، وليس على كل فترة مقارنة.',
  'limit.kpiTruncated': 'تم عرض {kept} مؤشر من {total}: الباقي محذوف.',
  'limit.tableRowsTruncated': 'تم عرض {kept} سطر من {total}: الباقي محذوف.',
  'narrative.up': '{metric}: في ارتفاع.',
  'narrative.down': '{metric}: في انخفاض.',
  'narrative.flat': '{metric}: مستقر.',
  'dim.title.city': 'حسب المدينة',
  'dim.title.product': 'حسب المنتج',
  'dim.title.agent': 'حسب الموظف',
  'dim.title.status': 'آخر الطلبات',
  'absence.empty': 'لا توجد طلبات مسجلة في هذه الفترة.',
  'absence.no_coverage': 'لا يوجد تجميع متوفر لهذه الفترة بعد.',
  'absence.partial': 'جزء فقط من الفترة مغطى بالتجميعات.',
  'absence.unavailable': 'فشلت القراءة: لا يمكن الجزم بغياب المعطيات.',
  'absence.range': 'الفترة غير صالحة أو واسعة جدًا للتحليل.',
  'absence.access': 'الوصول مرفوض لهذه الفترة.',
  'absence.budget': 'التحليل محدود: تم بلوغ حد التنفيذ.',
  'absence.unknown': 'النتيجة غير متوفرة لهذه الفترة.',
  'notice.limits': 'حدود التحليل',
  'notice.moreLimits': 'حدود أخرى',
  'clarify.period': 'أي فترة تريد تحليلها؟',
  'verdict.better': '{period} أفضل على مستوى {metric}.',
  'verdict.worse': '{period} أضعف على مستوى {metric}.',
  'verdict.equal': '{metric} مستقر بين الفترتين.',
  'verdict.noDelta': 'لا يمكن نشر أي فرق قابل للتفسير.',
  'reco.deliveryRate': 'نسبة التسليم {value}: راجع الطلبات غير المسلّمة قبل الحكم على الربحية.',
  'reco.confirmation': 'نسبة التأكيد {value}: تابع الطلبات المعلّقة قبل رفع الحجم.',
  'reco.ads': 'الإعلانات {value} مقابل {revenue} من المعاملات: راقب التكلفة لكل طلب مسلّم.',
  'reco.ordersSpike': 'ارتفاع الحجم بـ {delta}: تأكد من قدرة التوصيل.',
  'reco.ordersDrop': 'انخفاض الحجم بـ {delta}: راجع الإعلانات والتأكيد.',
  'chart.title.daily': 'التطور اليومي',
  'chart.title.orders': 'الطلبات في اليوم',
  'chart.title.revenue': 'المعاملات في اليوم',
  'chart.orders': 'الطلبات',
  'chart.delivered': 'المسلّمة',
  'chart.revenue': 'رقم المعاملات',
  'voice.label': 'تسجيل صوتي',
  'voice.recording': 'جاري التسجيل',
  'voice.encoding': 'جاري تجهيز الصوت…',
  'voice.ready': 'التسجيل جاهز',
  'voice.transcribing': 'جاري التفريغ…',
  'voice.cancel': 'إلغاء التسجيل',
  'voice.stop': 'إيقاف التسجيل',
  'voice.send': 'إرسال التسجيل',
  'voice.retry': 'إعادة الإرسال',
  'voice.tooLong': 'التسجيل طويل جدًا: الحد دقيقتان.',
  'voice.empty': 'لم يتم التعرف على أي كلام في التسجيل.',
  'voice.failed': 'تعذر التفريغ حاليًا.',
  'voice.readyHint': 'يمكنك الإرسال أو الإلغاء.',
  'composer.placeholder': 'اكتب سؤالك حول المتجر...',
  'composer.label': 'الرسالة',
  'composer.voice': 'إملاء رسالة',
  'suggest.analyze': 'حلل الأداء ديالي',
  'suggest.compare': 'قارن فترتين',
  'suggest.cities': 'الأداء حسب المدينة',
  'error.generic': 'حدث خطأ. أعد المحاولة بعد لحظات.',
  'error.noCredits': 'لم يتبق لديك رصيد من الذكاء الاصطناعي.',
}

/**
 * Darija en écriture arabe : variante de l'arabe avec les tournures marocaines.
 * Aucun mot anglais ni français ne doit apparaître dans ces valeurs.
 */
const DARIJA_ARABIC: Dictionary = {
  ...AR_REST,
  'metric.deliveredOrders': 'الطلبات اللي توصلو',
  'metric.deliveryRate': 'نسبة التوصيل',
  'title.figures': 'الأرقام المهمة',
  'title.strengths': 'اللي مزيان',
  'title.weaknesses': 'اللي خاصو تحسين',
  'title.recommendations': 'الوصايا',
  'absence.empty': 'ما كاين حتى طلب فهاد الفترة.',
  'absence.no_coverage': 'هاد الفترة مازال ما عندها تجميع.',
  'absence.unavailable': 'القراءة ما نجحاتش: ما نقدرش نقول بلي ما كاينش معطيات.',
  'voice.ready': 'التسجيل واجد',
  'voice.send': 'صيفط التسجيل',
  'voice.stop': 'وقف التسجيل',
  'voice.cancel': 'لغي التسجيل',
  'clarify.period': 'أشمن فترة بغيتي نحلل؟',
}

/**
 * Darija en écriture latine : transcription usuelle. Entièrement latine pour
 * éviter tout mélange d'alphabets dans une même réponse.
 */
const DARIJA_LATIN: Dictionary = {
  ...FR,
  'analysis.decomposition': '{period}: l-bi3 {revenue} na9es chra, tawsil, ta2kid w pub kay3ti marge {margin}. Machi ribh safi.',
  'analysis.hypothesis': 'Iftirad khaso ta7a9o9 f {metric} ({period}): t2ekked mn taghtiya w no3 talabat. L-far9 bo7do ma kaytbet ta sabab.',
  'metric.totalOrders': 'Talabat',
  'metric.deliveredOrders': 'Tawselou',
  'metric.returnedOrders': 'Rjou3',
  'metric.cancelledOrders': 'Ilgha2',
  'metric.adSpend': 'Masaref l’pub',
  'metric.deliveryRate': 'Nisbat tawsil',
  'derived.ordersPerDay': 'Talabat / nhar',
  'derived.revenuePerDay': 'CA / nhar',
  'title.verdict': 'L-kholasa',
  'title.figures': 'L-arqam l-mohimma',
  'title.strengths': 'Li mzyan',
  'title.weaknesses': 'Li khassou t7sin',
  'title.recommendations': 'L-wasaya',
  'title.comparison': 'Moqarana',
  'table.indicator': 'L-mo2achir',
  'table.current': 'L-fatra',
  'table.baseline': 'L-marja3',
  'table.delta': 'L-farq',
  'summary.single': 'Tahlil dyal {period}.',
  'summary.comparison': '{current} moqarana m3a {baseline}.',
  'absence.empty': 'Ma kayn 7ta talab f had l-fatra.',
  'absence.no_coverage': 'Had l-fatra mazal ma 3andha tajmi3.',
  'absence.unavailable': 'L-qira2a ma nj7atch: ma n9droch n9oulo belli ma kaynch mo3tayat.',
  'voice.ready': 'Tasjil wajed',
  'voice.encoding': 'Kanwejjed s-sout…',
  'limit.productProfit': 'Ribh l-produit: l-bi3 na9es chra, bla pub, tawsil w ta2kid.',
  'limit.dimensionSubset': 'Tafsil m7doud: had s-sotor machi darori majmou3 l-fatra.',
  'voice.send': 'Sift tasjil',
  'voice.stop': 'Wqef tasjil',
  'voice.cancel': 'Lghi tasjil',
  'dim.city': 'L-mdina',
  'dim.product': 'L-produit',
  'dim.productName': 'L-produit',
  'dim.agent': 'L-muwadaf',
  'dim.agentName': 'L-muwadaf',
  'dim.status': 'L-hala',
  'dim.quantity': 'L-kammiya',
  'dim.confirmationRate': 'Nisbat ta2kid',
  'dim.profit': 'Ribh l-produit',
  'dim.title.city': 'B l-mdina',
  'dim.title.product': 'B l-produit',
  'dim.title.agent': 'B l-muwadaf',
  'dim.title.status': 'Akhir talabat',
  'limit.dimensionsTruncated': '{kept} tafsil me3rud mn {total}: l-baqi ma me3rudch.',
  'limit.dimensionScope': 'T-tafsil m7sub 3la {period} ghir.',
  'limit.kpiTruncated': '{kept} mo2achir me3rud mn {total}: l-baqi ma me3rudch.',
  'limit.tableRowsTruncated': '{kept} ster me3rud mn {total}: l-baqi ma me3rudch.',
  'narrative.up': '{metric}: tal3a.',
  'narrative.down': '{metric}: hbta.',
  'narrative.flat': '{metric}: stable.',
  'composer.placeholder': 'Kteb so2alak 3la l-store...',
  'clarify.period': 'Achmen fatra bghiti n7allel?',
}

const EN: Dictionary = {
  ...FR,
  'analysis.decomposition': '{period}: realized revenue of {revenue}, less purchases, delivery, confirmation and advertising, yields contribution margin of {margin}. This is not net profit.',
  'analysis.hypothesis': 'Hypothesis to investigate for {metric} ({period}): check coverage and order mix. This change alone does not establish a cause.',
  'metric.totalOrders': 'Orders',
  'metric.deliveredOrders': 'Delivered',
  'metric.returnedOrders': 'Returns',
  'metric.cancelledOrders': 'Cancellations',
  'metric.revenue': 'Realized revenue',
  'metric.revenueEstimated': 'Estimated revenue',
  'metric.adSpend': 'Ad spend',
  'metric.deliveryRate': 'Delivery rate',
  'metric.purchaseCost': 'Purchase cost',
  'metric.deliveryCost': 'Delivery cost',
  'metric.confirmationCost': 'Confirmation cost',
  'metric.contributionMargin': 'Contribution margin',
  'derived.ordersPerDay': 'Orders / day',
  'derived.deliveredPerDay': 'Delivered / day',
  'derived.revenuePerDay': 'Revenue / day',
  'derived.revenuePerDelivered': 'Revenue per delivered order',
  'title.verdict': 'Verdict',
  'title.figures': 'Key figures',
  'title.strengths': 'Strengths',
  'title.weaknesses': 'Weaknesses',
  'title.recommendations': 'Recommendations',
  'title.comparison': 'Comparison',
  'title.trend': 'Trend',
  'title.breakdown': 'Breakdown',
  'table.indicator': 'Metric',
  'table.current': 'Period',
  'table.baseline': 'Baseline',
  'table.delta': 'Change',
  'table.value': 'Value',
  'table.days': 'Days',
  'table.name': 'Name',
  'summary.comparison': '{current} compared with {baseline}.',
  'summary.single': 'Analysis of {period}.',
  'summary.noFigures': 'No reliable figure can be published for this request.',
  'reason.coverage_partial': 'Partial coverage on part of the period.',
  'reason.duration_differs': 'Different lengths ({currentDays} and {baselineDays} days).',
  'reason.definition_differs': 'Different calculation definitions between both periods.',
  'reason.metric_missing': 'Metric available for one period only.',
  'reason.access_denied': 'Insufficient financial access for this metric.',
  'reason.stale': 'Aggregate needs refresh: this comparison is provisional.',
  'reason.cohort_immature': 'Recent period: deliveries may still change.',
  'summary.comparisons': '{count} requested comparisons: each period is presented separately.',
  'title.comparisonPair': '{current} vs {baseline}',
  'limit.netProfit': 'Net profit is not defined by the current analytics contract: contribution margin is published instead, before fixed costs.',
  'limit.metricUnavailable': '{metric} is not published for this period.',
  'limit.dimensionUnavailable': 'The requested breakdown could not be read: no detail values are published.',
  'limit.productProfit': 'Product profit: sales minus purchases, excluding advertising, delivery and confirmation.',
  'limit.dimensionSubset': 'Limited breakdown: these rows do not necessarily represent the period total.',
  'dim.city': 'City',
  'dim.product': 'Product',
  'dim.agent': 'Agent',
  'dim.status': 'Status',
  'dim.quantity': 'Quantity',
  'dim.name': 'Name',
  'dim.confirmationRate': 'Confirmation rate',
  'dim.productName': 'Product',
  'dim.agentName': 'Agent',
  'dim.profit': 'Product profit',
  'dim.confirmedOrders': 'Confirmed',
  'dim.sentOrders': 'Sent',
  'dim.pendingOrders': 'Pending',
  'dim.waitingPickupOrders': 'Awaiting pickup',
  'limit.dimensionsTruncated': '{kept} breakdown(s) shown out of {total}: the others are omitted.',
  'limit.dimensionScope': 'Breakdowns computed for {period} only, not for every compared period.',
  'limit.kpiTruncated': '{kept} indicator(s) shown out of {total}: the others are omitted.',
  'limit.tableRowsTruncated': '{kept} row(s) shown out of {total}: the others are omitted.',
  'narrative.up': '{metric}: rising.',
  'narrative.down': '{metric}: falling.',
  'narrative.flat': '{metric}: stable.',
  'dim.title.city': 'By city',
  'dim.title.product': 'By product',
  'dim.title.agent': 'By agent',
  'dim.title.status': 'Recent orders',
  'absence.empty': 'No order recorded for this period.',
  'absence.no_coverage': 'No aggregate is available for this period yet.',
  'absence.partial': 'Only part of the period is covered by aggregates.',
  'absence.unavailable': 'The read failed: absence of data cannot be concluded.',
  'absence.range': 'Invalid or too wide a period to analyse.',
  'absence.access': 'Access denied for this period.',
  'absence.budget': 'Analysis limited: the execution budget was reached.',
  'absence.unknown': 'Result unavailable for this period.',
  'notice.limits': 'Limits',
  'notice.moreLimits': 'More limits',
  'clarify.period': 'Which period would you like to analyse?',
  'verdict.better': '{period} is stronger on {metric}.',
  'verdict.worse': '{period} is weaker on {metric}.',
  'verdict.equal': '{metric} is stable between both periods.',
  'verdict.noDelta': 'No interpretable change can be published.',
  'chart.title.daily': 'Daily trend',
  'chart.orders': 'Orders',
  'chart.delivered': 'Delivered',
  'chart.revenue': 'Realized revenue',
  'voice.recording': 'Recording',
  'voice.encoding': 'Preparing audio…',
  'voice.ready': 'Recording ready',
  'voice.transcribing': 'Transcribing…',
  'voice.cancel': 'Cancel recording',
  'voice.stop': 'Stop recording',
  'voice.send': 'Send recording',
  'voice.failed': 'Transcription is unavailable right now.',
  'composer.placeholder': 'Ask your business question...',
  'composer.label': 'Message to send',
  'composer.voice': 'Dictate a message',
  'suggest.analyze': 'Analyse my business',
  'suggest.compare': 'Compare two periods',
  'suggest.cities': 'Performance by city',
  'error.generic': 'Something went wrong. Please try again.',
  'error.noCredits': 'You have no AI credits left.',
}

/* -------------------------------------------------------------------------- */
/* Résolution et interpolation                                               */
/* -------------------------------------------------------------------------- */

const DICTIONARIES: Readonly<Record<string, Dictionary>> = {
  'fr:latin': FR,
  'en:latin': EN,
  'ar:arabic': AR_REST,
  'darija:arabic': DARIJA_ARABIC,
  'darija:latin': DARIJA_LATIN,
}

/**
 * Dictionnaire retenu pour un profil de communication.
 *
 * La combinaison langue + écriture est nécessaire : une darija latine ne doit
 * jamais produire de texte arabe, et inversement.
 */
export function resolveDictionary(
  locale: AssistantLocale,
  script: 'latin' | 'arabic',
): Dictionary {
  return DICTIONARIES[`${locale}:${script}`] ?? (script === 'arabic' ? AR_REST : FR)
}

export type MessageParams = Readonly<Record<string, string | number>>

/** Interpolation simple `{name}` ; un paramètre manquant reste visible. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}

/**
 * Traduit une clé. Une clé inconnue renvoie une chaîne vide plutôt que
 * l'identifiant technique : l'interface ne doit jamais afficher `metric.foo`.
 */
export function translate(
  dictionary: Dictionary,
  key: string,
  params?: MessageParams,
): string {
  const template = dictionary[key]
  if (typeof template !== 'string') return ''
  return interpolate(template, params)
}

/** Raccourci pour un profil donné. */
export function t(
  locale: AssistantLocale,
  script: 'latin' | 'arabic',
  key: string,
  params?: MessageParams,
): string {
  return translate(resolveDictionary(locale, script), key, params)
}

/** Vrai si la clé existe dans le dictionnaire résolu. */
export function hasMessage(locale: AssistantLocale, script: 'latin' | 'arabic', key: string): boolean {
  return typeof resolveDictionary(locale, script)[key] === 'string'
}

export { FR as FRENCH_DICTIONARY }
