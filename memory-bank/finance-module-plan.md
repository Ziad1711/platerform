# Plan opérationnel — Module Finances & Règlements

Statut : **en cours d'implémentation.** Une première version (résultat opérationnel, soldes agents/fournisseurs, enregistrement des paiements) est en place ; **Phase 1 (contrat de calcul / Lot B) implémentée le 26/09/2026** — cf. §11, complétée le même jour par le fuseau d'affaires explicite et le retrait des privilèges `anon` — cf. §12 ; **Phase 3 (actions de paiement dans l'UI existante) faite** — cf. §14. Les vues « À vérifier » / « retours » et l'alignement du dashboard restent à terminer. Les **versions de migration ont été revérifiées en base le 26/09/2026** : les 17 fichiers locaux correspondent exactement aux couples version/nom de `supabase_migrations.schema_migrations` (dernière : `20260926193328`), donc **aucun `db push` n'est nécessaire** pour ce module — cf. §13.
Décisions figées le 26/09/2026. Ne pas modifier sans accord explicite du propriétaire.

---

## 1. Objectif

Donner au propriétaire / admin une lecture fiable et **justifiable** de :

1. **Commissions des agents** : potentielles, acquises, versées, reste à verser.
2. **Fournisseurs** : montants dus, payés, restant à payer, avances.
3. **Résultat opérationnel** : réel et expliqué ligne par ligne.
4. **Trésorerie** : affichée « non vérifiée » tant que les reversements transporteurs
   et le solde initial ne sont pas fiabilisés.

Tout chiffre affiché doit pouvoir être **reconstitué à partir d'écritures traçables**.

---

## 2. Décisions validées (invariants)

1. Le rôle **comptable** peut **consulter les finances** et **enregistrer des paiements**.
2. **Aucune source fiable** des reversements transporteurs ni **solde initial vérifié** :
   → interdiction d'afficher une trésorerie « réelle ». Afficher **« non vérifiée »** + mouvements connus.
3. Les commissions restent calculées par les règles/migrations existantes ; on ajoute
   un **registre de versements** sans casser le flux de confirmation.
4. **Ne pas convertir en masse** les données historiques ambiguës
   (entrées de stock → dettes ; commissions `paid` → paiements certains).
5. Ne jamais dupliquer un coût (résultat) avec un flux de trésorerie (décaissement).

---

## 3. État actuel constaté (source de vérité)

### Tables & colonnes pertinentes

- `orders` — statuts et coûts :
  - `confirmation_commission_amount`, `confirmation_commission_trigger`,
    `confirmation_commission_rule_source`, `confirmation_commission_status`
    (valeurs : `pending`, `earned`, `cancelled`, `paid`), `confirmation_commission_earned_at`.
  - `confirmation_cost_allocated`, `delivery_fee`, `ads_cost_allocated`,
    `subtotal_amount`, `discount_amount`, `delivery_status`, `status`.
- `confirmation_agents` — `commission_per_order`, `commission_enabled`,
  `commission_trigger`, `use_store_commission_settings`, `is_active`.
- `confirmation_settings` — `default_commission_amount`, `default_commission_trigger`,
  `commission_enabled` (un enregistrement par store).
- `supplier_ledger` — `store_id`, `supplier_id`, `entry_type` (`debit`/`credit`),
  `amount` (>= 0), `entry_date`, `reference_type`, `note`.
  **Constat : table vide (0 ligne).** Pas de lien vers un achat précis, pas d'auteur,
  pas de devise, pas de mode de paiement, pas d'imputation.
- `suppliers` — `store_id`, `name` (+ coordonnées).
- `inventory_movements` — `movement_type` (`in`/`out`/`adjustment`), `supplier_id`,
  `quantity`, `unit_cost`, `total_cost`, `remaining_qty`.
- `expenses` — `amount` (>= 0), `expense_date`, `expense_type`
  (`manual`/`recurring`/`automated`), `status` (`active`/`cancelled`/`pending`),
  `source_type`, `source_table`, `source_id`, `source_hash`, `category_id`, `note`.
- `ad_spend_daily` — `spend`, `spend_converted`, `is_provisional`, `spend_date`, `platform`.
- `stores` — `currency`, `owner_user_id`.

### Rôles & permissions actuels (`lib/auth/permissions.ts`)

Rôles : `owner`, `admin`, `confirmation`, `delivery`, `stock_manager`,
`accountant`, `marketer`, `viewer`.

Permissions existantes pertinentes : `suppliers.view`, `suppliers.manage`,
`expenses.view`, `expenses.manage`, `dashboard.view`, `sales.view`, `stock.view`.

**Écart constaté :** le rôle `accountant` possède `expenses.view/expenses.manage`
et `sales.view`, mais **pas** `suppliers.view`. Il faudra le lui accorder (ou créer
une permission financière dédiée) pour qu'il puisse enregistrer des paiements fournisseurs.

### Formulaire actuel du dashboard (à ne pas confondre avec un résultat complet)

`components/dashboard/kpi-cards.tsx` calcule :
`profit = revenue − purchaseCost − deliveryCost − confirmationCost − adCost`.
Il **n'inclut pas** les `expenses` et ne constitue pas un résultat opérationnel complet.
Le KPI « Charges » = `purchaseCost + deliveryCost + confirmationCost`.

### Travaux locaux non commités (à préserver absolument)

Présence de migrations et composants de commissions **non commités** :
`20260926155155_confirmation_commission.sql`,
`20260926163554_confirmation_commission_fixes.sql`,
`20260926165031_confirmation_commission_cleanup.sql`,
`20260926170631_confirmation_commission_reactivation.sql`,
plus `app/api/team/confirmation-agents/`, `components/dashboard/staff/`,
et des fichiers modifiés (staff, confirmation). **Ne rien écraser**, intégrer au-dessus.

---

## 4. Contrat de calcul (définitions impératives, à réutiliser partout)

| Notion | Définition exacte |
|---|---|
| **Commission potentielle** | Montant attaché à une commande dont le déclencheur n'est pas rempli. **Pas une dette exigible.** |
| **Commission acquise** | Montant dû selon la règle figée sur la commande, après réalisation du déclencheur. |
| **Commission versée** | Somme des **versements enregistrés** pour l'agent. |
| **Reste à verser (agent)** | `acquises − régularisations − versements imputés`. Un négatif = **trop-versé** (ne pas ramener à 0). |
| **Dette fournisseur** | Achats reconnus comme dus, corrigés des avoirs/régularisations. |
| **Reste fournisseur** | `dettes − paiements imputés`. Une **avance** est montrée séparément. |
| **Résultat opérationnel** | Ventes reconnues − coût des produits vendus − livraison − publicité − commissions acquises − autres charges applicables, **sans double comptage**. |
| **Trésorerie vérifiée** | `solde initial vérifié + encaissements constatés − décaissements constatés`. |
| **Trésorerie non vérifiée** | État par défaut tant que les reversements transporteurs et le solde initial ne sont pas fiabilisés. |

### Règles impératives

- Un **paiement** change la trésorerie et le reste à payer ; il ne crée **pas une deuxième charge**.
- Un **achat de stock** peut créer une dette et, une fois payé, consommer de la trésorerie ;
  le coût du stock n'entre au résultat des ventes que selon la valorisation retenue à la vente (FIFO/coût unitaire).
- « **Livré** » ≠ « **encaissé** ». Ne jamais créer un reversement transporteur à partir du statut de livraison.
- Les sommes négatives (retour, avoir, paiement excédentaire) doivent rester **explicites**
  (trop-versé / avance), jamais silencieusement ramenées à zéro.

---

## 5. Traitement des données historiques (interdictions)

- **Interdit** : convertir automatiquement tous les anciens mouvements `in` en dettes fournisseur.
- **Interdit** : marquer les anciennes commissions `paid` comme « paiements certains »
  sans preuve de règlement. Les signaler **« historique à vérifier »**.
- **Interdit** : déduire un encaissement d'un statut `delivered`.
- Les données incertaines sont présentées **« à qualifier »** jusqu'à validation des pièces
  ou saisie d'un solde d'ouverture justifié.

---

## 6. Phases d'implémentation (ordre strict)

### Phase 0 — Vérifier l'existant
- Lire et intégrer les migrations de commissions non commitées ; ne rien écraser.
- Confirmer les contraintes et RLS de `supplier_ledger`, `inventory_movements`, `expenses`, `orders`.
- **Livrable** : état des lieux confirmé. **Critère** : aucune régression des commissions existantes.

### Phase 1 — Contrat de calcul validé
- Figer les définitions du §4 et les faire valider avant toute UI.
- **Livrable** : référentiel de calcul. **Critère** : chaque chiffre a une formule + sources.

### Phase 2 — Registres de règlements (agents puis fournisseurs)
- **Agents** : registre de versements (store, agent, montant, devise, date effective, mode,
  référence, note, auteur, date de création) + **imputation** aux commissions dues + **régularisations** motivées.
- **Fournisseurs** : référence d'achat identifiable (montant dû, devise, date, échéance,
  référence facture, lien mouvements de stock) + écritures de dette/paiement/avance/avoir
  **rattachées à cet achat**. Étendre `supplier_ledger` (ou table associée) sans créer deux sources de vérité.
- **Critère** : `dû − payé = restant` explicable ligne par ligne ; un retour/avoir post-paiement
  laisse une régularisation visible, jamais un effacement.

### Phase 3 — Actions de paiement dans l'UI existante
- **Personnel** : colonnes *acquis / versé / restant* + historique + bouton « Enregistrer un versement ».
- **Fournisseurs** : colonnes *dus / payé / restant / avances* + détail par achat + « Enregistrer un paiement ».
- Paiements partiels autorisés ; jamais de paiement sans store explicite en mode « Tous les stores ».
- **Critère** : deux paiements partiels donnent exactement leur somme + bon reliquat.

### Phase 4 — Rapprochement transporteurs (sans inventer)
- Rapprochement **manuel** : montant reçu, date, transporteur, référence, commandes couvertes.
- Distinguer *vente reconnue* / *théorique à reverser* / *versement constaté*.
- Aucun « solde réel » sans solde initial daté et vérifié. Étiqueter « déclaré » vs « rapproché ».

### Phase 5 — Page Finances `/finances`
- Vues : **Synthèse**, **Rentabilité**, **Règlements**, **Rapprochement**, **À vérifier**.
- Mention visible « estimé / à rapprocher » partout où une donnée manque.
- Multi-store : conversion de devises explicite, jamais d'addition de devises différentes.

### Phase 6 — Permissions & sécurité
- Créer des permissions financières distinctes (voir §7) ; contrôles UI + route serveur + RLS.
- Vérifier à chaque écriture : store du demandeur, appartenance active, store de la cible.

### Phase 7 — Aligner le dashboard, puis valider
- Mettre à jour les libellés du dashboard **uniquement après** cohérence avec `/finances`.
- Clarifier « Profit » (résultat opérationnel de gestion, pas un bénéfice net comptable).
- Ne pas créer de fichier de test ; valider sur les scénarios du §8.

---

## 7. Permissions & sécurité (matrice cible)

| Rôle | Voir Finances | Enregistrer paiement | Modifier règle de commission | Corriger / annuler écriture |
|---|---|---|---|---|
| Propriétaire | Oui | Oui | Oui | Oui, avec motif |
| Admin | Oui | Oui | Selon permissions existantes | Oui, avec motif |
| Comptable | **Oui** | **Oui** | Non par défaut | Non par défaut (validation admin) |
| Autres rôles | Non par défaut | Non | Selon droits métier actuels | Non |

### Règles

- Créer des permissions dédiées (ex. `finance.view`, `finance.payments`, `finance.corrections`)
  plutôt que de réutiliser `suppliers.manage` / `expenses.manage` pour les paiements.
- Ajouter `suppliers.view` au rôle **comptable** (écart constaté) pour l'accès aux paiements fournisseurs.
- Contrôle **UI + route serveur + RLS**. Vérifier à chaque écriture le store, l'appartenance active
  et l'appartenance de la cible (agent/fournisseur/achat) au même store.
- Les corrections sont des **écritures compensatoires motivées**, jamais une modification invisible d'un historique.

---

## 8. Cas limites à valider (avant de conclure « terminé »)

1. **Paiement partiel** d'une commission ou d'une facture fournisseur.
2. **Commande annulée / retournée après commission acquise** : régularisation visible, trop-versé éventuel.
3. **Avoir fournisseur** après paiement : réduction de dette + trace distincte.
4. **Avance** non imputée : reste visible, jamais « achat négatif ».
5. **Paiement couvrant plusieurs commandes / factures** : chaque imputation enregistrée.
6. **Publicité** importée puis synchronisée : aucun double comptage.
7. **Dépense** qui est déjà un coût compté ailleurs (publicité ressaisie, commission en salaire, livraison en dépense) : détectée dans « À vérifier ».
8. **Multi-store et devises différentes** : conversion explicite, pas d'addition de devises.
9. **Données historiques manquantes** : étiquetées « estimé / à qualifier », jamais « réel ».
10. **Mode « Tous les stores »** : tout paiement exige un store explicite.

---

## 9. Interdictions absolues (à respecter par l'agent IA)

- Ne jamais marquer un montant « payé » à partir d'un statut de commande ou de livraison.
- Ne jamais présenter la trésorerie comme « réelle » sans solde initial vérifié et reversements fiables.
- Ne jamais effacer un historique de règlement ; toujours compenser par une écriture motivée.
- Ne jamais dupliquer un coût entre résultat et trésorerie.
- Ne jamais écraser les migrations de commissions non commitées.
- Ne jamais créer de fichier de test séparé (règle projet).
- Ne jamais additionner des devises différentes sans conversion explicite.

---

## 10. Critère de validation finale

Pour un store donné :
- `dû − payé = restant` est explicable ligne par ligne (agents et fournisseurs).
- Aucune livraison seule n'augmente la trésorerie ; aucun solde « réel » sans socle vérifié.
- Chaque catégorie de coût n'est déduite qu'une seule fois ; le détail explique le total.
- Les montants multi-stores n'additionnent jamais des devises différentes sans conversion.
- Aucune ancienne donnée incertaine n'est devenue un paiement « confirmé » par migration.
- Les droits sont vérifiés en UI, côté serveur et en base.



---

## 11. Lot B — contrat de calcul implémenté (26/09/2026)

Référentiel appliqué par `public.rpc_finance_overview` — migration
`20260926191350_finance_pnl_contract.sql` (le retour de la fonction expose chaque
composante séparément pour rendre le total justifiable).

### Publicité — arbitrage par jour
- Journée couverte par au moins une ligne `ad_spend_daily` → cette table est **la** source
  de la journée, **même si le montant du jour vaut 0** (la ligne prouve que la journée est suivie).
- Journée non couverte → repli sur `orders.ads_cost_allocated` des commandes **de cette journée**,
  jamais sur le total de période (ancien repli qui perdait les journées non suivies).
- Aucune journée comptée deux fois. Colonnes d'information : `ad_spend_daily`,
  `ads_from_orders`, `ads_daily_days`, `ads_fallback_days`, `ads_fallback_orders`.

### Ventes reconnues
- Reconnaissance **à la livraison** : `coalesce(delivered_at, order_date)` dans la période.
- `revenue_reliable` = somme des lignes produits (`order_items`).
- `revenue_estimated` = `total_selling_price` des commandes livrées **sans** `order_items` :
  le CA connu n'est jamais perdu, mais n'est jamais présenté comme fiable.
- `cost_of_goods` retombe sur `buy_price` quand les lignes manquent (valeur à vérifier).

### Fiabilité affichée
- `data_issues` : commandes livrées sans lignes, écart lignes/total > 0,01, ou coût produit nul avec CA > 0.
- `result_is_reliable` = `estimated_orders = 0 ET data_issues = 0`.
  Sinon l'UI affiche « **Estimé** » (CA estimé présent) ou « **À vérifier** » (anomalie seule).

### Charges
- `other_expenses` = toutes les charges actives (décision `20260926182058_finance_audit_fixes.sql` conservée).
- `ads_expense_overlap` (+ `ads_expense_overlap_count`) expose les charges de catégorie `ads`
  pour signaler un double comptage possible avec la ligne Publicité — aucun montant déduit en silence.
- `commission` = `orders.confirmation_cost_allocated` des commandes livrées.

### Résultat
`operating_result = (revenue_reliable + revenue_estimated) − cost_of_goods − delivery_cost
− ad_spend − commission − other_expenses`.

---

## 12. Lot B (suite) — fuseau d'affaires, journées coupées, privilèges (26/09/2026)

Corrections issues de l'audit en lecture seule du Lot B. Migrations
`20260926192926_finance_pnl_timezone.sql`, `20260926192933_finance_rpc_grants.sql`
et `20260926193328_finance_timezone_search_path.sql`.

### Fuseau d'affaires — règle fixée
- **Une seule source de vérité** : `public.finance_business_timezone()` = `Africa/Casablanca`
  (fonction interne, `EXECUTE` réservé à `postgres`/`service_role`). Toute clé de
  journée du module Finances doit passer par elle — charges, ventes et publicité
  doivent désormais être lus avec le même fuseau (lots C–E).
- **Journée = journée locale marocaine**, jamais la journée UTC. L'interface envoie
  des bornes de période calculées dans le fuseau du navigateur : comparer des clés
  de journée UTC à ces bornes créait un décalage d'une heure.
- Effet constaté avant correction : une commande passée entre 00:00 et 01:00 (heure
  marocaine) était rangée dans la journée UTC précédente ; quand cette journée UTC
  n'était pas suivie par `ad_spend_daily`, son `ads_cost_allocated` était recompté
  en repli **en plus** de la journée réellement suivie. Mesure et correction sur le
  store principal : repli 706,15 → 141,37 MAD, soit **564,78 MAD de double comptage
  éliminés** (8 commandes en repli → 1).
- Aucune donnée existante ne change de journée : les lignes `ad_spend_daily` sont
  écrites à 00:00 UTC, soit la même date locale en `Africa/Casablanca`.

### Journées coupées — règle fixée
- `ad_spend_daily` est une donnée de **journée entière** : elle n'est pas proratisable.
- La fenêtre publicitaire (suivi quotidien **et** repli `orders.ads_cost_allocated`)
  est donc élargie aux **journées locales complètes** touchées par la période
  demandée. Les deux côtés partagent la même fenêtre : plus d'asymétrie en bord de
  période, aucune journée comptée deux fois.
- `ads_partial_days` expose le nombre de journées **suivies** seulement partiellement
  couvertes par la période (montant compté en entier) : l'interface le signale sous
  la ligne Publicité. Aucun montant n'est ajusté en silence et
  `result_is_reliable` reste déterminé par `estimated_orders` / `data_issues`.
- Les autres composantes (CA, coût produits, livraison, commissions, autres charges)
  restent bornées aux **instants** exacts de la période : la granularité journalière
  ne concerne que la publicité.

### Privilèges
- `EXECUTE` retiré **nommément** à `anon` sur toutes les fonctions du module
  (`rpc_finance_*`, `rpc_finance_overview` inclus, `rpc_record_*`,
  `can_view_store_finances`, `can_record_store_payments`) ; `authenticated` et
  `service_role` conservent le privilège.
- Raison : les privilèges par défaut du schéma `public` (`pg_default_acl`) accordent
  `EXECUTE` à `anon`, `authenticated` et `service_role` à **chaque** création de
  fonction. Un `revoke all ... from public` ne suffit donc pas — erreur commise dans
  les migrations du Lot A/B. **Toute nouvelle fonction du module Finances doit
  révoquer `anon` explicitement.**
- La garde applicative (`can_view_store_finances` sur `auth.uid()`) reste la
  protection réelle des données : sans JWT, les RPC retournent 0 ligne.

---

## 13. Réconciliation des versions de migration (26/09/2026)

Les 13 fichiers du module Finances portaient des versions locales différentes de
celles réellement enregistrées par Supabase (décalage d'horodatage), et la
dernière version distante (`20260926193328`) était postérieure à la plus ancienne
version locale décalée : un `supabase db push` les aurait **rejoués**.
Correction retenue — **la moins risquée** : renommer uniquement les fichiers
locaux sur les versions présentes dans `supabase_migrations.schema_migrations`,
sans toucher à l'historique distant (pas de `supabase migration repair`, pas de
réécriture du nom pollué en base, pas d'élargissement aux préfixes « date seule »
plus anciens — hors périmètre).

| Nom local (avant) | Nom aligné sur l'historique distant (retenu) |
| --- | --- |
| `20260926190000_finance_payment_registries.sql` | `20260926174248_finance_payment_registries.sql` |
| `20260926190001_finance_read_helpers.sql` | `20260926174451_finance_read_helpers.sql` |
| `20260926190002_finance_security_hardening.sql` | `20260926180201_finance_security_hardening.sql` |
| `20260926190003_finance_pnl_overview.sql` | `20260926180307_finance_pnl_overview.sql` |
| `20260926190004_finance_fixes.sql` | `20260926181211_finance_fixes.sql` |
| `20260926190005_finance_audit_fixes.sql` | `20260926182058_finance_audit_fixes.sql` |
| `20260926190006_finance_history_preservation.sql` | `20260926182907_finance_history_preservation.sql` |
| `20260926190007_finance_block_store_delete.sql` | `20260926183753_finance_block_store_delete.sql` |
| `20260926190008_finance_store_delete_trigger.sql` | `20260926185429_20260926190008_finance_store_delete_trigger.sql` |
| `20260926200000_finance_pnl_contract.sql` | `20260926191350_finance_pnl_contract.sql` |
| `20260926210000_finance_pnl_timezone.sql` | `20260926192926_finance_pnl_timezone.sql` |
| `20260926210001_finance_rpc_grants.sql` | `20260926192933_finance_rpc_grants.sql` |
| `20260926210002_finance_timezone_search_path.sql` | `20260926193328_finance_timezone_search_path.sql` |

- **Contenu SQL inchangé** : seuls les noms de fichiers changent, pour que le
  dépôt et l'historique distant coïncident. Les commentaires SQL internes qui
  citent d'anciennes versions locales (`20260926190005`, `20260926200000`,
  `20260926210000`) sont laissés tels quels afin de préserver l'égalité exacte
  avec ce qui a été appliqué en base.
- Le 9ᵉ nom reste volontairement « pollué » (`20260926185429_20260926190008_…`) :
  c'est littéralement ce que contient l'historique distant.
- **Constat hors périmètre** : 72 fichiers plus anciens portent un préfixe « date
  seule » (`20260916_*`, `20260430_*`, `20260611_*`…) absent tel quel de
  l'historique distant. Inchangé volontairement ; à traiter séparément si un
  `db push` complet est un jour utilisé.
- **Vérification en base (26/09/2026)** : `select version, name from
  supabase_migrations.schema_migrations order by version desc limit 20` renvoie
  exactement les 17 couples retenus (version `20260926185429` incluse, avec son
  nom « pollué »). Dépôt et historique distant coïncident donc pour ce module :
  **aucun `supabase db push` n'est requis**, et il ne faut pas en lancer tant que
  le point ci-dessus (72 fichiers « date seule ») n'est pas traité.


---

## 14. Phase 3 — actions de paiement dans l'UI existante (26/09/2026)

Le règlement n'est plus confiné à `/finances` : il est disponible là où le travail se
fait, sans nouvelle table ni nouveau RPC — réutilisation stricte des registres du Lot A.

### Personnel — `/staff`
- Nouveau bloc « Règlements des agents de confirmation »
  (`components/dashboard/staff/confirmation-agents-payments.tsx`) : *Acquis / Versé /
  Restant* par agent (`rpc_finance_agent_balances`), ligne **Total**, historique des
  10 derniers versements (`confirmation_agent_payments`, lecture protégée par la RLS
  `can_view_store_finances`) et bouton « Enregistrer un versement » ouvrant
  `AgentPaymentDialog` (imputation commande par commande, paiements partiels autorisés).

### Fournisseurs — `/suppliers`
- Colonnes *Dû / Payé / Restant* (`rpc_finance_supplier_balances`) ajoutées au tableau
  existant, plus un détail par achat dépliable
  (`components/dashboard/finance/supplier-purchases-detail.tsx` →
  `rpc_finance_supplier_purchases`) montrant *dû − payé = reste* facture par facture,
  et les actions « Achat » / « Payer » réutilisant `SupplierPurchaseDialog` /
  `SupplierPaymentDialog`.

### Garde-fous respectés
- **Store explicite obligatoire** : aucun bouton de paiement en mode « Tous les
  stores » (`canRecordPayment = finance.payments && !!currentStoreId`). Les colonnes
  financières, le détail et les actions sont réservés à `finance.view` ; les autres
  rôles conservent l'UI d'origine.

### Critère de la phase — validé
Sous JWT simulé, transaction annulée :
- **Agents** : 2 commandes à 100 → versements 50 (30 + 20) puis 40 → *acquis 200 ·
  versé 90 · restant 110* ; détail par commande 30 + 80 = 110 ; trop-versé refusé
  (`ALLOCATION_EXCEEDS_REMAINING`).
- **Fournisseurs** : achats 1 000 + 500 → paiements 400 (300 + 100) puis 200 →
  *dû 1 500 · payé 600 · restant 900* ; détail par facture 500 + 400 = 900 ;
  trop-payé refusé.
- `npx tsc --noEmit` et `next build` sans erreur.

### Restes constatés — état revérifié sur les migrations
1. **BLOQUÉ — Avances fournisseur impossibles** : `rpc_record_supplier_payment` impose
   toujours `somme(imputations) = montant` (`ALLOCATION_TOTAL_MISMATCH`, dernière
   définition de la fonction en `20260926182058:268` — vérifié : aucune migration
   postérieure ne la redéfinit). La colonne « avances » demandée par la Phase 3 n'a donc
   **pas** été affichée et le cas limite §8.4 reste ouvert. Décision de gestion requise
   (un paiement peut-il dépasser le dû, et comment l'imputer ensuite ?) : **aucune
   modification d'écriture tant que ce n'est pas tranché**.
2. ~~Garde en base plus permissive que l'UI~~ — **constat périmé, corrigé**. Preuves :
   `20260926180201:37,78` (dernières définitions de `rpc_finance_agent_balances` et de
   `rpc_finance_supplier_balances`) ne filtrent plus sur `store_members` mais appellent
   `public.can_view_store_finances(store_id)` ; le corps de ce helper
   (`20260926174248:6–19`) exige `sm.status = 'active'` **et**
   `sm.role in ('owner','admin','accountant')`. Un membre `confirmation`/`viewer` est
   donc refusé au même titre qu'en UI. `20260926192933` ne fait que révoquer `anon`
   (aucun corps de fonction) : rien ne rouvre la garde.
