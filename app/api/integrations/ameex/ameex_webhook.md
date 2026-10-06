Webhook
Le webhook recevra le suivi uniquement pour les colis ajoutés par API

https://…

Enregistrer
Overview
This document describes the structure of the webhook data and the process used to send parcel delivery status updates to customers. This webhook allows customers to receive real-time updates about the delivery status of their parcels.

Endpoint
The webhook data is sent to the customer's provided URL using an HTTP POST request.

Request Format
The request payload is encoded as application/x-www-form-urlencoded and includes delivery status details in the following JSON structure:

Example Payloads
Example 1: Parcel In Progress
{
  "CODE": "TGR1223B1EL127",
  "STATUT": "IN_PROGRESS",
  "COMMENT": "",
  "STATUT_S": "NO_ANSWER_TEAM",
  "STATUT_NAME": "En cours",
  "STATUT_COLOR": "#fdac41",
  "STATUT_S_NAME": "Pas de réponse ( Suivi )",
  "STATUT_S_COLOR": "#ffba57"
}
Example 2: Parcel Delivered
{
  "CODE": "BSK0224B34RN3412",
  "STATUT": "DELIVERED",
  "COMMENT": "",
  "STATUT_NAME": "Livré",
  "STATUT_COLOR": "#24d651"
}
Example 3: Parcel Distribution
{
  "CODE": "BSK0224B34SI6512",
  "STATUT": "DISTRIBUTION",
  "COMMENT": " Livreur Casa3 | Téléphone: 0808080808  ",
  "STATUT_NAME": "Mise en distribution",
  "STATUT_COLOR": "#25a0d7"
}
Example 4: Parcel ( Postponed || Scheduled )
{
  "CODE": "BSK0224B34BV8312",
  "DATE": "2024-06-27",
  "STATUT": "IN_PROGRESS",
  "COMMENT": "",
  "STATUT_S": "POSTPONED",
  "STATUT_NAME": "En cours",
  "STATUT_COLOR": "#fdac41",
  "STATUT_S_NAME": "Reporté",
  "STATUT_S_COLOR": "#25a0d7"
}
Field Descriptions
CODE: A unique Tracking Number for the parcel.
DATE (optional): The date associated with the parcel status update.
STATUT: The current status of the parcel (e.g. IN_PROGRESS, DELIVERED, DISTRIBUTION). You get list of status from here
COMMENT: Additional information or notes about the parcel (e.g., delivery person details).
STATUT_S (optional): Sub-status providing further details about the main status.
STATUT_NAME: A user-friendly name for the status (e.g. "En cours", "Livré").
STATUT_COLOR: The associated color for the main status, typically used in UI elements.
STATUT_S_NAME (optional): A user-friendly name for the sub-status.
STATUT_S_COLOR (optional): The associated color for the sub-status.
Example Usage
Customers can configure their system to receive and process the webhook payload. For example:

PHP Example
$webhookPayload = $_POST;
$parcelCode = $webhookPayload['CODE'];
$status = $webhookPayload['STATUT'];
// Process the payload as needed
Notes
Customers should ensure their endpoint can handle application/x-www-form-urlencoded payloads.
Webhooks are retried in case of failure (retry logic to be discussed separately).
Fields marked as "optional" may not always be present in the payload.