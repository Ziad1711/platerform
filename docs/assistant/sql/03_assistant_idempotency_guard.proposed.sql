-- ============================================================================
-- PROPOSITION — NE PAS EXÉCUTER SANS VALIDATION EXPLICITE
-- Objet : idempotence inter-instances sur `requestId`.
--
-- Aujourd'hui la clé vit dans `chat_messages.metadata.request_id` (message
-- utilisateur et réponse assistant) et le rejeu est détecté après persistance.
-- Deux instances traitant le même requestId en parallèle peuvent donc appeler
-- le modèle et débiter deux fois.
--
-- IMPACT CODE OBLIGATOIRE AVANT APPLICATION :
--   POST /api/assistant/chat doit intercepter l'erreur PostgreSQL 23505
--   (unique_violation) à l'insertion de la réponse assistant, relire la
--   réponse existante et retourner un rejeu (`credit_status: 'not_charged'`).
--   Sans ce traitement, un retry concurrent produirait une erreur 500.
--
-- Prérequis : aucun doublon existant (voir la requête de contrôle ci-dessous).
-- ============================================================================

-- Contrôle préalable (lecture seule) :
--   select thread_id, metadata->>'request_id' as request_id, count(*)
--     from public.chat_messages
--    where role = 'assistant' and metadata ? 'request_id'
--    group by 1, 2
--   having count(*) > 1;

begin;

create unique index if not exists chat_messages_request_id_uniq
  on public.chat_messages (thread_id, (metadata->>'request_id'))
  where role = 'assistant' and metadata ? 'request_id';

commit;

-- Rollback 03 :
--   drop index if exists public.chat_messages_request_id_uniq;
