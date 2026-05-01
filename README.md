# Platerform - SaaS e-commerce/ERP

Plateforme SaaS pour e-commerçants orientée pilotage business, conçue pour le marché marocain avec interface en français.

## 🎯 Objectif

Fournir une plateforme complète pour gérer :
- Ventes et commandes
- Produits et stock
- Fournisseurs et dépenses
- Coûts publicitaires
- Personnel et livraison
- Assistant IA connecté aux données business
- Dashboard analytique avec KPIs

## 🚀 Stack Technique

- **Next.js 15** avec App Router
- **TypeScript** pour la sécurité des types
- **Tailwind CSS** pour le styling
- **shadcn/ui** pour les composants UI
- **Supabase** pour database, auth et RLS
- **Recharts** pour les graphiques
- **React Query** pour la gestion d'état

## 📁 Architecture

```
/app
  /dashboard          # Pages du dashboard
    /ventes
    /produits
    /stock
    /fournisseurs
    /publicite
    /depenses
    /livraison
    /personnel
    /abonnement
    /assistant-ia
    /parametres
  layout.tsx         # Layout racine
  page.tsx           # Page d'accueil (auth)
  globals.css        # Styles globaux

/components
  /auth              # Composants d'authentification
  /dashboard         # Composants du dashboard
  /providers.tsx     # Fournisseurs de contexte

/lib
  /supabase          # Clients Supabase
    client.ts        # Client navigateur
    server.ts        # Client serveur

/services           # Logique métier et appels API
/hooks              # Hooks personnalisés
/types              # Types TypeScript
```

## 🔐 Authentification

Système d'authentification complet avec :
- Login/Register avec Supabase Auth
- Middleware pour la protection des routes
- Redirection automatique vers le dashboard
- Gestion des sessions côté serveur

## 📊 Dashboard

Le dashboard principal affiche :
- 6 KPIs principaux (commandes, CA, coûts, profit)
- Graphique d'évolution du chiffre d'affaires
- Liste des produits les plus performants
- Commandes récentes
- Filtres par période

## 🏪 Architecture Multi-tenant

- Système multi-store via `store_id`
- Sécurité RLS (Row Level Security) avec Supabase
- Sélecteur de magasin actif
- Toutes les données filtrées par store_id

## 🚀 Démarrage

1. **Cloner le projet**
   ```bash
   git clone <repository>
   cd platerform
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Configurer les variables d'environnement**
   ```bash
   cp .env.local.example .env.local
   ```
   Remplir avec vos credentials Supabase

4. **Lancer le serveur de développement**
   ```bash
   npm run dev
   ```

5. **Ouvrir dans le navigateur**
   ```
   http://localhost:3000
   ```

## 📦 Déploiement

Prêt pour déploiement sur **Vercel** :

1. Connecter votre repository GitHub à Vercel
2. Configurer les variables d'environnement
3. Déployer automatiquement

## 🔧 Développement

### Règles de code
- Maximum 200-300 lignes par fichier
- Séparation stricte UI/logique
- Composants réutilisables
- Types TypeScript stricts
- Architecture modulaire

### Structure recommandée
- `/components` pour l'UI
- `/services` pour la logique métier
- `/lib` pour les utilitaires
- `/hooks` pour les hooks personnalisés

## 📈 Roadmap

### Phase 1 (MVP)
- [x] Initialisation du projet
- [x] Configuration Supabase
- [x] Authentification
- [x] Layout et sidebar
- [x] Dashboard de base

### Phase 2
- [ ] Gestion des stores actifs
- [ ] Dashboard avec données réelles
- [ ] Page Ventes
- [ ] Page Produits

### Phase 3
- [ ] Gestion du stock
- [ ] Gestion des fournisseurs
- [ ] Suivi des dépenses
- [ ] Suivi publicitaire

### Phase 4
- [ ] Assistant IA
- [ ] Gestion des abonnements
- [ ] Paramètres utilisateur

## 📄 Licence

Propriétaire - Développé pour le marché marocain