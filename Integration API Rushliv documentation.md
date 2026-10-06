# Documentation — Intégration API Rushliv

Documentation de l'API Rushliv pour les plateformes externes (ajout et suivi de commandes, liste des villes).

---

## 📦 Add Order — Ajouter une commande

### Méthode

`POST`

### URL

```
https://clients.rushliv.com/api-parcels
```

### formData

```
[
  "action"        => "add",
  "token"         => "YOUR_API_KEY",
  "tracking"      => "CODE123",       // optional
  "name"          => "John Doe",
  "phone"         => "0600000000",
  "product"       => "Chaussures",
  "qty"           => "2",
  "ville"         => "Casablanca",
  "ville_type"    => "name",          // use "name" if ville is a city name; otherwise use city code from api-cities
  "adresse"       => "123 Rue Exemple",
  "note"          => "Livraison rapide SVP",
  "stock"         => 0,
  "open_package"  => 0,
  "parcel_replace"=> 0,
  "price"         => "150",
  "user"          => "username123"    // optional
]
```

> **Important** : utilisez les villes Rushliv exactement comme elles existent dans la liste officielle.

### ✅ Success Response

```json
{
  "status": 200,
  "msg": "Commande ajoutée avec succès",
  "tracking": "RL-DEMO-000123"
}
```

### ❌ Error Response

```json
{
  "status": 401,
  "msg": "Token invalide ou ville introuvable"
}
```

---

## 🔎 Track Order — Suivre une commande

### Méthode

`POST`

### URL

```
https://clients.rushliv.com/api-parcels
```

### formData

```
[
  "action"   => "track",
  "token"    => "YOUR_API_KEY",
  "tracking" => "RL-DEMO-000123"
]
```

### ✅ Success Response

```json
{
  "status": true,
  "tracking": "RL-DEMO-000123",
  "msg": [
    {
      "code": "RL-DEMO-000123",
      "etat": "Non Payé",
      "status": "En cours",
      "time": "2026-05-20 09:15:00"
    }
  ],
  "delivery": {
    "phone": "0611111111",
    "name": "Livreur Rushliv"
  }
}
```

---

## 🌍 Villes Rushliv

Les plateformes externes doivent utiliser les villes disponibles dans Rushliv.

### Méthode

`GET`

### URL

```
https://clients.rushliv.com/api-cities
```

Endpoint actif : retourne automatiquement toutes les villes disponibles dans Rushliv avec ID, code, nom et statut actif.

### ✅ Exemple Response

```json
{
  "status": 200,
  "success": true,
  "count": 445,
  "cities": [
    {
      "id": 6873,
      "code": "C",
      "name": "Casablanca",
      "active": 1
    }
  ]
}
```
