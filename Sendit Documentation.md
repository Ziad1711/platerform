# Sendit API Documentation

Bienvenue à l'API Sendit, votre solution complète pour la gestion de la livraison.

---

## Authentification

Pour accéder à notre API, vous aurez besoin d'un jeton d'authentification.

Vous pouvez l'obtenir en envoyant une requête POST à l'endpoint `/login` avec vos identifiants. Après avoir obtenu le jeton, assurez-vous de l'inclure dans l'en-tête `Authorization` de chaque requête sous la forme `Bearer [votre jeton]`.

### POST /login

Login de l'utilisateur et renvoie un token.

**Request Body**

```json
{
  "public_key": "",
  "secret_key": ""
}
```

**Responses**

| Code | Description |
|------|-------------|
| 200 | Connexion réussie |
| 401 | Accès non autorisé à Utilisateur |
| 500 | Une erreur s'est produite côté serveur |

**Exemple de réponse (200)**

```json
{
  "success": true,
  "message": "Connexion effectuée avec succès.",
  "data": {
    "token": "",
    "name": ""
  }
}
```

---

## Codes d'erreur

Notre API renvoie des codes d'état HTTP appropriés et des messages descriptifs en cas d'erreur.

| Code | Description |
|------|-------------|
| 200 | Succès |
| 250 | Le champ produits est incorrect ! |
| 251 | Les produits suivants P1,P2... n'existent pas |
| 252 | La quantité sélectionnée de ces produits P1,P2... n'est pas suffisante |
| 401 | Accès non autorisé |
| 403 | Vous n'avez pas les autorisations nécessaires |
| 404 | Page non trouvée |
| 422 | Les données fournies sont invalides |
| 500 | Une erreur s'est produite côté serveur |

**Exemple de réponse non autorisée :**

```json
{
  "error": "Vous n'avez pas les autorisations nécessaires"
}
```

---

## Limites de taux

Nous limitons le nombre de requêtes à notre API pour assurer la qualité du service.

- **Limite :** 1000 requêtes par heure

---

## Rétrocompatibilité

Chez Sendit, nous nous engageons à améliorer continuellement notre service. Tout en nous efforçant de maintenir la rétrocompatibilité de notre API, nous publierons des notifications anticipées et des instructions de migration pour tous les changements majeurs.

---

## Webhooks

Sendit notifie votre système en temps réel via des webhooks : à chaque événement important (changement de statut d'un colis, livraison effectuée, etc.), nous envoyons une requête POST vers l'URL que vous avez configurée.

Pour la liste des événements, le format des payloads et la vérification de signature, consultez la **Documentation des Webhooks** (PDF).

---

## Serveurs

| Environnement | URL |
|---------------|-----|
| Production | `https://app.sendit.ma/api/v1/` |

---

## Colis

### GET /deliveries

Liste des colis.

**Paramètres**

| Nom | Type | Description |
|------|------|-------------|
| page | integer (query) | Page |
| querystring | string (query) | Recherche par code, nom du client, téléphone et adresse |

**Réponse (200)**

```json
{
  "success": true,
  "message": "Liste des colis.",
  "data": [
    {
      "code": "DXXXXXXX",
      "name": "",
      "fee": 35,
      "phone": "",
      "amount": 199,
      "district": {
        "id": 1,
        "ville": "Casablanca",
        "name": "Casablanca - Ain sebaa",
        "arabic_name": "",
        "price": "X",
        "delais": "24h",
        "active": 1
      },
      "status": "PENDING",
      "comment": "",
      "reference": "ref-01",
      "last_action_at": "",
      "status_return": "RETOUR_PENDING",
      "products": [
        {
          "reference": "ref_X",
          "code": "PXXXXXX",
          "name": "Produit X",
          "quantity": 1
        }
      ],
      "products_from_stock": 0,
      "packaging": {
        "id": 1,
        "code": "K628FA72A",
        "reference": "C1",
        "name": "Carton box 1",
        "type": "Carton",
        "size": "18cm - 10cm - 12cm",
        "buying_price": 1
      },
      "option_exchange": 0
    }
  ],
  "total": 10,
  "per_page": 10,
  "current_page": 1,
  "last_page": 10,
  "next_page_url": "http://example.com/api/v1/deliveries?page=2",
  "prev_page_url": "http://example.com/api/v1/deliveries?page=1"
}
```

---

### POST /deliveries

Ajouter un nouveau colis. Ajoute un nouveau colis et retourne les détails du colis créé.

**Request Body**

```json
{
  "pickup_district_id": "",
  "district_id": 1,
  "name": "",
  "amount": "",
  "address": "",
  "phone": "",
  "comment": "",
  "reference": "",
  "allow_open": 1,
  "allow_try": 1,
  "products_from_stock": 0,
  "products": "",
  "packaging_id": 1,
  "option_exchange": 0,
  "delivery_exchange_id": ""
}
```

**Réponse (200)**

```json
{
  "success": true,
  "message": "Detail de colis.",
  "data": {
    "code": "DXXXXXXX",
    "status": "PENDING",
    "fee": 35,
    "name": "Anonyme",
    "phone": "XXXXXXXXXX",
    "address": "Adresse de client",
    "amount": 199,
    "comment": "",
    "reference": "ref-01",
    "products": [
      {
        "reference": "ref_X",
        "code": "PXXXXXXX",
        "name": "Produit X",
        "quantity": 1
      }
    ],
    "products_from_stock": 0,
    "district": {
      "id": 1,
      "ville": "Casablanca",
      "name": "Casablanca - Ain sebaa",
      "arabic_name": "الدار البيضاء - عين السبع",
      "price": 19,
      "delais": "24h",
      "active": 1
    },
    "last_action_at": "YYYY-MM-DD HH:MM:SS",
    "allow_open": 1,
    "allow_try": 1,
    "status_return": "RETOUR_PENDING",
    "option_exchange": 1,
    "labelUrl": "https://app.sendit.ma/files/ZnVuZHMvU2VwdGVtYmVyMjAyNS84REs3UjBVa3lHSlBTdDM4MjZ",
    "audits": [
      {
        "data": {
          "code": "DXXXXXXX",
          "name": "Anonyme",
          "amount": 199,
          "phone": "XXXXXXXXXX",
          "district": 1,
          "products_from_stock": 0,
          "address": "Adresse de client",
          "comment": "",
          "reference": "ref-01",
          "allow_open": 1,
          "allow_try": 1,
          "products": "",
          "option_exchange": 1,
          "status": "PENDING",
          "fee": 35,
          "last_action_at": "YYYY-MM-DD HH:MM:SS",
          "status_return": "RETOUR_PENDING"
        },
        "event": "updated",
        "user": "Sendit",
        "created_at": "l j F Y, à H:i"
      }
    ]
  }
}
```

---

### GET /deliveries/{code}

Détails d'un colis.

**Paramètres**

| Nom | Type | Description |
|------|------|-------------|
| code * | string (path) | Code du colis |

**Réponse (200)**

```json
{
  "success": true,
  "message": "Detail de colis.",
  "data": {
    "code": "DXXXXXXX",
    "status": "PENDING",
    "fee": 35,
    "name": "Anonyme",
    "phone": "XXXXXXXXXX",
    "address": "Adresse de client",
    "amount": 199,
    "comment": "",
    "reference": "ref-01",
    "products": [
      {
        "reference": "ref_X",
        "code": "PXXXXXXX",
        "name": "Produit X",
        "quantity": 1
      }
    ],
    "products_from_stock": 0,
    "district": {
      "id": 1,
      "ville": "Casablanca",
      "name": "Casablanca - Ain sebaa",
      "arabic_name": "الدار البيضاء - عين السبع",
      "price": 19,
      "delais": "24h",
      "active": 1
    },
    "last_action_at": "YYYY-MM-DD HH:MM:SS",
    "allow_open": 1,
    "allow_try": 1,
    "status_return": "RETOUR_PENDING",
    "option_exchange": 1,
    "labelUrl": "https://app.sendit.ma/files/ZnVuZHMvU2VwdGVtYmVyMjAyNS84REs3UjBVa3lHSlBTdDM4MjZ",
    "audits": [
      {
        "data": {
          "code": "DXXXXXXX",
          "name": "Anonyme",
          "amount": 199,
          "phone": "XXXXXXXXXX",
          "district": 1,
          "products_from_stock": 0,
          "address": "Adresse de client",
          "comment": "",
          "reference": "ref-01",
          "allow_open": 1,
          "allow_try": 1,
          "products": "",
          "option_exchange": 1,
          "status": "PENDING",
          "fee": 35,
          "last_action_at": "YYYY-MM-DD HH:MM:SS",
          "status_return": "RETOUR_PENDING"
        },
        "event": "updated",
        "user": "Sendit",
        "created_at": "l j F Y, à H:i"
      }
    ]
  }
}
```

---

### PUT /deliveries/{code}

Modifier un colis.

**Paramètres**

| Nom | Type | Description |
|------|------|-------------|
| code * | string (path) | Code du colis |

**Request Body**

```json
{
  "pickup_district_id": "",
  "district_id": 1,
  "name": "",
  "amount": "",
  "address": "",
  "phone": "",
  "comment": "",
  "reference": "",
  "allow_open": 1,
  "allow_try": 1,
  "products_from_stock": 0,
  "products": "",
  "packaging_id": 1,
  "option_exchange": 0,
  "delivery_exchange_id": ""
}
```

**Réponse (200)**

```json
{
  "success": true,
  "message": "Detail de colis.",
  "data": {
    "code": "DXXXXXXX",
    "status": "PENDING",
    "fee": 35,
    "name": "Anonyme",
    "phone": "XXXXXXXXXX",
    "address": "Adresse de client",
    "amount": 199,
    "comment": "",
    "reference": "ref-01",
    "products": [
      {
        "reference": "ref_X",
        "code": "PXXXXXXX",
        "name": "Produit X",
        "quantity": 1
      }
    ],
    "products_from_stock": 0,
    "district": {
      "id": 1,
      "ville": "Casablanca",
      "name": "Casablanca - Ain sebaa",
      "arabic_name": "الدار البيضاء - عين السبع",
      "price": 19,
      "delais": "24h",
      "active": 1
    },
    "last_action_at": "YYYY-MM-DD HH:MM:SS",
    "allow_open": 1,
    "allow_try": 1,
    "status_return": "RETOUR_PENDING",
    "option_exchange": 1,
    "labelUrl": "https://app.sendit.ma/files/ZnVuZHMvU2VwdGVtYmVyMjAyNS84REs3UjBVa3lHSlBTdDM4MjZ",
    "audits": [
      {
        "data": {
          "code": "DXXXXXXX",
          "name": "Anonyme",
          "amount": 199,
          "phone": "XXXXXXXXXX",
          "district": 1,
          "products_from_stock": 0,
          "address": "Adresse de client",
          "comment": "",
          "reference": "ref-01",
          "allow_open": 1,
          "allow_try": 1,
          "products": "",
          "option_exchange": 1,
          "status": "PENDING",
          "fee": 35,
          "last_action_at": "YYYY-MM-DD HH:MM:SS",
          "status_return": "RETOUR_PENDING"
        },
        "event": "updated",
        "user": "Sendit",
        "created_at": "l j F Y, à H:i"
      }
    ]
  }
}
```

---

### DELETE /deliveries/{code}

Supprimer un colis.

**Paramètres**

| Nom | Type | Description |
|------|------|-------------|
| code * | string (path) | Code du colis |

**Réponse (200)**

```json
{
  "success": true,
  "message": "Colis supprimé avec succes."
}
```

---

### POST /deliveries/getlabels

Impression des étiquettes.

**Request Body**

```json
{
  "codesToPrint": "DH1,DH2,DH3",
  "printFormat": 1
}
```

**Réponse (200)**

```json
{
  "success": true,
  "message": "Impression des étiquettes.",
  "data": {
    "filePrint": true,
    "fileUrl": "http://app.sendit.ma/pdf/labels_colis_UXXXXXXXXX.pdf"
  }
}
```

---

## Contact

**Sendit Support**
