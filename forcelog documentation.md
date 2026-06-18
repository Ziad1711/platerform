# Documentation API ForceLog

## Clé API

Toutes les requêtes à l'API ForceLog nécessitent une authentification à l'aide d'un en-tête HTTP personnalisé nommé `X-API-Key`. Vous devez inclure votre clé API unique dans cet en-tête pour accéder aux points de terminaison de l'API.

Vous pouvez toujours vérifier l'état de l'API ForceLog à l'aide du point de terminaison suivant : `api.forcelog.ma/health`

### Obtention de votre clé API

Vous pouvez générer une nouvelle clé API ci-dessous :

| Clé API | Actions |
|---------|---------|
|         |         |

### Utilisation de votre clé API

Pour inclure votre clé API dans vos requêtes API, vous devez définir l'en-tête HTTP `X-API-Key` avec la valeur de votre clé API. Par exemple, si votre clé API est fournie, vous pouvez utiliser l'en-tête suivant dans votre requête :

```
X-API-Key: votre_clé_API_unique_ici
```

### Importance de l'authentification

L'authentification est essentielle pour garantir la sécurité et l'intégrité de vos données. En exigeant une clé API pour chaque requête, l'API ForceLog s'assure que seules les utilisateurs autorisés peuvent accéder à ses fonctionnalités.

### Conseils pour la sécurité de votre clé API

- Ne partagez jamais votre clé API avec personne d'autre.
- Conservez votre clé API en lieu sûr et confidentiel.
- Ne stockez pas votre clé API dans le code source de vos applications.
- Si vous pensez que votre clé API a été compromise, changez-la immédiatement.

En suivant ces conseils, vous pouvez vous assurer que votre clé API est utilisée en toute sécurité et que vos données sont protégées.

### Réponse en cas de succès

```json
{
    "AUTH": {
        "RESULT": "SUCCESS",
        "MESSAGE": "Customer Authenticated, Welcome to Forcelog API"
    }
}
```

---

## Ajouter un nouveau colis

### Méthode

`POST`

### URL

```
https://api.forcelog.ma/customer/Parcels/AddParcel
```

### Paramètres

| Paramètre | Type | Description | Obligatoire | Valeur par défaut | Max caractères |
|-----------|------|-------------|-------------|-------------------|----------------|
| `ORDER_NUM` | string | Numéro de commande associé au colis | Oui | | 20 |
| `RECEIVER` | string | Nom du destinataire du colis | Oui | | 50 |
| `PHONE` | string | Téléphone du destinataire du colis | Oui | | 14 |
| `CITY` | string | Ville de destination du colis (code ou nom de la ville) | Oui | | 50 |
| `ADDRESS` | string | Adresse de destination du colis | Oui | | 100 |
| `COMMENT` | string | Commentaire facultatif relatif au colis | Non | Vide | 100 |
| `PRODUCT_NATURE` | string | Nature du produit contenu dans le colis | Non | Vide | 100 |
| `COD` | nombre | Montant du contre-remboursement (facultatif) | Non | 0 | |
| `CAN_OPEN` | boolean | Indique si le colis peut être ouvert avant livraison | Non | 1 | |
| `STOCK` | string | Références et quantités de produits en stock à inclure (séparés par des virgules, format "référence:quantité"). La quantité est facultative | Non | Vide | |
| `FRAGILE` | boolean | Indique si le colis est fragile. À envoyer si le contenu nécessite une manipulation avec précaution. | Non | 0 | |
| `CARTON` | string | Taille du carton souhaité pour l'emballage du colis. À envoyer si le colis nécessite un carton fourni par ForceLog. | Non | Vide | |

### Réponse

La réponse de l'API sera au format JSON. Le format de la réponse dépend du succès ou de l'échec de l'opération d'ajout de colis.

#### Réponse en cas de succès

```json
{
    "ADD-PARCEL": 
    {
        "RESULT": "SUCCESS",
        "MESSAGE": "New Parcel Added Successfully",
        "NEW-PARCEL": {
            "TRACKING_NUMBER": "CODE_SUIVI_COLIS",
            "ORDER_NUM": "NUMERO_COMMANDE",
            "RECEIVER": "NOM_DESTINATAIRE",
            "PHONE": "TELEPHONE_DESTINATAIRE",
            "CITY_NAME": "NOM_VILLE",
            "ADDRESS": "ADRESSE_DESTINATAIRE",
            "PRICE": "MONTANT_COD",
            "COMMENT": "COMMENTAIRE",
            "PRODUCT_NATURE": "NATURE_PRODUIT"
        }
    }
}
```

#### Réponse en cas d'erreur

```json
{
    "ADD-PARCEL": {
        "RESULT": "ERROR",
        "MESSAGE": "Message d'erreur"
    }
}
```

---

## Récupérer un colis

### Méthode

`GET`

### URL

```
https://api.forcelog.ma/customer/Parcels/GetParcel
```

### Paramètres

| Paramètre | Type | Description | Obligatoire |
|-----------|------|-------------|-------------|
| `Code` | string | Code de suivi unique du colis à récupérer. | Oui |

### Réponse

La réponse de l'API sera au format JSON. Le format de la réponse dépend du succès ou de l'échec de récupération de colis.

#### Réponse en cas de succès

| Paramètre | Type | Description |
|-----------|------|-------------|
| `RESULT` | string | Résultat de la requête ("SUCCESS" ou "ERROR") |
| `MESSAGE` | string | Message d'information supplémentaire (en cas d'erreur) |
| `PARCEL` | object | Informations détaillées sur le colis |
| `- TRACKING_NUMBER` | string | Code de suivi du colis |
| `- ORDER_NUM` | string | Numéro de commande associé au colis (facultatif) |
| `- RECEIVER` | string | Nom du destinataire du colis |
| `- PHONE` | string | Téléphone du destinataire du colis |
| `- CITY_NAME` | string | Ville de destination du colis |
| `- ADDRESS` | string | Adresse de destination du colis |
| `- PRICE` | string | Montant du contre-remboursement |
| `- COMMENT` | string | Commentaire facultatif sur le colis |
| `- PRODUCT_NATURE` | string | Nature du produit contenu dans le colis |
| `- CAN_OPEN` | string | Indique si le colis peut être ouvert avant livraison |
| `- CREATION_TIME` | string | Date et heure de création du colis (format lisible) |
| `- STATUS` | string | Statut de livraison du colis (en français) |
| `- SITUATION` | string | Statut de paiement, Payé/Non Payé (en français) |
| `- DELIVERY_FEES` | number | Frais de livraison |

#### Réponse en cas d'erreur

**Exemple de réponse (colis non trouvé) :**

```json
{
    "RESULT": "ERROR",
    "MESSAGE": "Parcel Not Found"
}
```

---

## Relancement vers un nouveau client

### Méthode

`POST`

### URL

```
https://api.forcelog.ma/customer/Parcels/Relaunch
```

### Paramètres

| Paramètre | Type | Description | Obligatoire | Valeur par défaut | Max caractères |
|-----------|------|-------------|-------------|-------------------|----------------|
| `CODE` | string | Code de suivi du colis | Oui | | 20 |
| `RECEIVER` | string | Nom du destinataire du colis | Oui | | 50 |
| `PHONE` | string | Téléphone du destinataire du colis | Oui | | 14 |
| `ADDRESS` | string | Adresse de destination du colis | Oui | | 100 |
| `COD` | nombre | Montant du contre-remboursement (prix) | Oui | 0 | |
| `COMMENT` | string | Commentaire facultatif relatif au colis | Non | Vide | 100 |

### Réponse

La réponse de l'API sera au format JSON. Le format de la réponse dépend du succès ou de l'échec de l'opération.

#### Réponse en cas de succès

```json
{
    "RELAUNCH": 
    {
        "RESULT": "SUCCESS",
        "MESSAGE": "Parcel relaunched successfully"
    }
}
```

#### Réponse en cas d'erreur

```json
{
    "RELAUNCH": {
        "RESULT": "ERROR",
        "MESSAGE": "Message d'erreur"
    }
}
```

---

## Relancement vers une nouvelle ville

### Méthode

`POST`

### URL

```
https://api.forcelog.ma/customer/Parcels/RelaunchZone
```

### Paramètres

| Paramètre | Type | Description | Obligatoire | Valeur par défaut | Max caractères |
|-----------|------|-------------|-------------|-------------------|----------------|
| `CODE` | string | Code de suivi du colis | Oui | | 20 |
| `CITY` | string | Ville de destination du colis (ID de la ville) | Oui | | 50 |
| `RECEIVER` | string | Nom du destinataire du colis | Oui | | 50 |
| `PHONE` | string | Téléphone du destinataire du colis | Oui | | 14 |
| `ADDRESS` | string | Adresse de destination du colis | Oui | | 100 |
| `COD` | nombre | Montant du contre-remboursement (prix) | Oui | 0 | |
| `COMMENT` | string | Commentaire facultatif relatif au colis | Non | Vide | 100 |

### Réponse

La réponse de l'API sera au format JSON. Le format de la réponse dépend du succès ou de l'échec de l'opération.

#### Réponse en cas de succès

```json
{
    "RELAUNCH": 
    {
        "RESULT": "SUCCESS",
        "MESSAGE": "Parcel relaunched successfully"
    }
}
```

#### Réponse en cas d'erreur

```json
{
    "RELAUNCH": {
        "RESULT": "ERROR",
        "MESSAGE": "Message d'erreur"
    }
}
```

---

## Étiquetage

### Méthode

`GET`

### URL

```
https://api.forcelog.ma/customer/PDF/ParcelSticker?parcelCode=PARCEL_CODE
```

### Paramètres

| Paramètre | Type | Description | Obligatoire | Valeur par défaut | Max caractères |
|-----------|------|-------------|-------------|-------------------|----------------|
| `parcelCode` | string | Code de suivi du colis | Oui | | 20 |

### Réponse

La réponse de l'API sera au format PDF.

---

## Ajouter une nouvelle demande de ramassage

### Méthode

`POST`

### URL

```
https://api.forcelog.ma/customer/Pickups/CreateRequest
```

### Paramètres

| Paramètre | Type | Description | Obligatoire | Valeur par défaut | Max caractères |
|-----------|------|-------------|-------------|-------------------|----------------|
| `PHONE` | string | Téléphone | Oui | | 14 |
| `CITY` | string | Ville de ramassage (code ou nom de la ville) | Oui | | 50 |
| `ADDRESS` | string | Adresse de ramassage | Oui | | 100 |
| `COMMENT` | string | Commentaire facultatif | Non | Vide | 100 |
| `STICKERS` | boolean | Définissez si vous avez des stickers ou non | Non | False | |

### Réponse

La réponse de l'API sera au format JSON. Le format de la réponse dépend du succès ou de l'échec de l'opération d'ajout de demande.

#### Réponse en cas de succès

```json
{
    "ADD-PICKUP": 
    {
        "RESULT": "SUCCESS",
        "MESSAGE": "New Pickup request created successfully"
    }
}
```

#### Réponse en cas d'erreur

```json
{
    "ADD-PICKUP": {
        "RESULT": "ERROR",
        "MESSAGE": "Message d'erreur"
    }
}
```
