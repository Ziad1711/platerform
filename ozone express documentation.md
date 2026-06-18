# Documentation API Ozone Express

## Ajouter un colis

**POST** `https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}/add-parcel`

### Paramètres (form-data)

| Paramètre | Requis | Description |
|-----------|--------|-------------|
| `tracking-number` | ❌ Optionnel | Numéro de suivi personnalisé |
| `parcel-receiver` | ✅ Requis | Nom complet du destinataire |
| `parcel-phone` | ✅ Requis | Téléphone du destinataire |
| `parcel-city` | ✅ Requis | ID de la ville |
| `parcel-address` | ✅ Requis | Adresse complète |
| `parcel-note` | ❌ Optionnel | Instructions spéciales |
| `parcel-price` | ✅ Requis | Prix du colis en MAD |
| `parcel-declared-value` | ⚠️ Requis si prix vide, 0 ou > 5000 | Valeur déclarée en MAD (min: 50) |
| `parcel-nature` | ❌ Optionnel | Description du contenu |
| `parcel-stock` | ✅ Requis | `1` = stock, `0` = ramassage |
| `parcel-open` | ❌ Optionnel | `1` = Ouvrir le colis, `2` = Ne pas ouvrir (default: `1`) |
| `parcel-fragile` | ❌ Optionnel | `1` = Oui, `0` = Non (default: `0`) |
| `parcel-replace` | ❌ Optionnel | `1` = Oui, `0` = Non (default: `0`) |
| `products` | ❌ Optionnel | JSON: `[{"ref": "PROD001", "qnty": 2}]` |

### Exemple cURL

```bash
curl -X POST "https://api.ozonexpress.ma/customers/12345/your-api-key/add-parcel" \
  -F "parcel-receiver=Mohammed Alami" \
  -F "parcel-phone=0612345678" \
  -F "parcel-city=1" \
  -F "parcel-address=123 Rue Hassan II" \
  -F "parcel-price=250" \
  -F "parcel-stock=1"
```

### Exemple PHP

```php
$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL => "https://api.ozonexpress.ma/customers/12345/your-api-key/add-parcel",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => [
        "parcel-receiver" => "Mohammed Alami",
        "parcel-phone"    => "0612345678",
        "parcel-city"     => "1",
        "parcel-address"  => "123 Rue Hassan II",
        "parcel-price"    => "250",
        "parcel-stock"    => "1"
    ]
]);
$response = curl_exec($curl);
curl_close($curl);
echo $response;
```

### Réponse JSON

```json
{
    "TRACKING-NUMBER": "OZE123456789",
    "RECEIVER": "Mohammed Alami",
    "PHONE": "0612345678",
    "CITY_ID": "1",
    "CITY_NAME": "Casablanca",
    "ADDRESS": "123 Rue Hassan II",
    "PRICE": "250",
    "DELIVERED-PRICE": "25",
    "RETURNED-PRICE": "15",
    "REFUSED-PRICE": "15"
}
```

---

## Informations d'un colis

**POST** `https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}/parcel-info`

### Paramètres

| Paramètre | Requis | Description |
|-----------|--------|-------------|
| `tracking-number` | ✅ Requis | Numéro de suivi du colis |

### Exemple cURL

```bash
curl -X POST "https://api.ozonexpress.ma/customers/12345/your-api-key/parcel-info" \
  -F "tracking-number=OZE123456789"
```

### Exemple PHP

```php
$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL => "https://api.ozonexpress.ma/customers/12345/your-api-key/parcel-info",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => ["tracking-number" => "OZE123456789"]
]);
$response = curl_exec($curl);
$data = json_decode($response, true);
print_r($data);
```

### Données retournées

Même format que lors de la création du colis.

---

## Tracking d'un colis

**POST** `https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}/tracking`

### Paramètres

| Paramètre | Requis | Description |
|-----------|--------|-------------|
| `tracking-number` | ✅ Requis | Numéro de suivi |

### Exemple cURL

```bash
curl -X POST "https://api.ozonexpress.ma/customers/12345/your-api-key/tracking" \
  -F "tracking-number=OZE123456789"
```

### Exemple PHP

```php
$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL => "https://api.ozonexpress.ma/customers/12345/your-api-key/tracking",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => ["tracking-number" => "OZE123456789"]
]);
echo curl_exec($curl);
curl_close($curl);
```

### Exemple JavaScript

```javascript
const formData = new FormData();
formData.append("tracking-number", "OZE123456789");

fetch("https://api.ozonexpress.ma/customers/12345/your-api-key/tracking", {
    method: "POST",
    body: formData
})
    .then(response => response.json())
    .then(data => console.log(data));
```

### Tracking multiple colis (Bulk)

```bash
curl --location --request POST "https://api.ozonexpress.ma/customers/12345/your-api-key/tracking" \
  --header "Content-Type: application/json" \
  --data '{
    "tracking-number": [
        "OZE123456789",
        "OZE987654321",
        "OZE111111111"
    ]
}'
```

---

## Bon de livraison

Processus en 4 étapes :

### 1. Créer un Bon de Livraison

**POST** `https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}/add-delivery-note`

```bash
curl -X POST "https://api.ozonexpress.ma/customers/12345/your-api-key/add-delivery-note"
```

### 2. Ajouter des colis au BL

**POST** `https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}/add-parcel-to-delivery-note`

#### Paramètres

| Paramètre | Description |
|-----------|-------------|
| `Ref` | Référence du BL |
| `Codes[]` | Liste des tracking numbers |

```bash
curl -X POST "https://api.ozonexpress.ma/customers/12345/your-api-key/add-parcel-to-delivery-note" \
  -F "Ref=BL240115001" \
  -F "Codes[0]=OZE123456789" \
  -F "Codes[1]=OZE987654321"
```

### 3. Sauvegarder le BL

**POST** `https://api.ozonexpress.ma/customers/{YOUR_ID}/{YOUR_API_KEY}/save-delivery-note`

```bash
curl -X POST "https://api.ozonexpress.ma/customers/12345/your-api-key/save-delivery-note" \
  -F "Ref=BL240115001"
```

### 4. Télécharger les PDFs

- **PDF Standard :** `https://client.ozoneexpress.ma/pdf-delivery-note?dn-ref={BL_REF}`
- **Étiquettes A4 :** `https://client.ozoneexpress.ma/pdf-delivery-note-tickets?dn-ref={BL_REF}`
- **Étiquettes 10×10cm :** `https://client.ozoneexpress.ma/pdf-delivery-note-tickets-4-4?dn-ref={BL_REF}`

### Script PHP complet

```php
// 1. Créer BL
$response1 = file_get_contents("https://api.ozonexpress.ma/customers/12345/your-api-key/add-delivery-note");
$bl_ref = json_decode($response1, true)["ref"];

// 2. Ajouter colis
$postdata = http_build_query([
    "Ref"   => $bl_ref,
    "Codes" => ["OZE123456789", "OZE987654321"]
]);
$context = stream_context_create(["http" => ["method" => "POST", "content" => $postdata]]);
file_get_contents("https://api.ozonexpress.ma/customers/12345/your-api-key/add-parcel-to-delivery-note", false, $context);

// 3. Sauvegarder
$save_data = http_build_query(["Ref" => $bl_ref]);
$save_context = stream_context_create(["http" => ["method" => "POST", "content" => $save_data]]);
file_get_contents("https://api.ozonexpress.ma/customers/12345/your-api-key/save-delivery-note", false, $save_context);

// 4. Lien PDF
echo "PDF: https://client.ozoneexpress.ma/pdf-delivery-note?dn-ref=" . $bl_ref;
```

---

## Liste des villes

**GET** `https://api.ozonexpress.ma/cities`

---

## Note

Trouvez votre clé API dans la section **Compte** → **Generate your API key**.
