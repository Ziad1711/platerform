-- ============================================================================
-- PROPOSITION — REVUE DE DONNÉES (LECTURE SEULE)
-- Objet : conversations de l'assistant sans boutique (`store_id IS NULL`).
--
-- Constat en production : 13 conversations sur 26 n'ont aucune boutique.
-- Cause probable : `chat_threads.store_id` est nullable avec
-- `ON DELETE SET NULL` ; la suppression d'une boutique détache ses
-- conversations au lieu de les supprimer. Les anciennes créations d'API sans
-- `storeId` produisent le même effet.
--
-- Ces conversations restent lisibles par leur propriétaire : leur portée métier
-- n'est plus vérifiable, donc elles ne doivent pas servir de base à une analyse.
-- Aucun nettoyage n'est exécuté ici : la décision produit est requise.
-- ============================================================================

-- 1. Inventaire (lecture seule)
select
  ct.id                          as thread_id,
  ct.user_id,
  ct.title,
  ct.created_at,
  ct.updated_at,
  (select count(*) from public.chat_messages m where m.thread_id = ct.id) as messages_count,
  (select count(*) from public.chat_messages m
    where m.thread_id = ct.id and m.role = 'assistant')                 as assistant_messages
from public.chat_threads ct
where ct.store_id is null
order by ct.updated_at desc;

-- 2. Vérifier si la boutique d'origine existe encore (corrélation impossible
--    en l'état : l'information est perdue). Croisement utile avec les
--    appartenances actuelles pour repérer les conversations sans aucune
--    boutique accessible à leur propriétaire :
select
  ct.id as thread_id,
  ct.user_id,
  count(sm.store_id) as accessible_stores
from public.chat_threads ct
left join public.store_members sm
       on sm.user_id = ct.user_id and sm.status = 'active'
where ct.store_id is null
group by ct.id, ct.user_id
having count(sm.store_id) = 0;

-- ============================================================================
-- OPTIONS DE REMÉDIATION — AUCUNE N'EST ACTIVÉE
-- Choisir après revue de l'inventaire ci-dessus, puis appliquer hors de ce
-- fichier, avec sauvegarde préalable (`pg_dump` ciblé des deux tables).
-- ============================================================================

-- OPTION A — Archiver côté application (recommandé) :
--   aucune suppression, les conversations restent visibles mais ne sont plus
--   proposées comme périmètre d'analyse. Nécessite un champ/flag applicatif.

-- OPTION B — Supprimer les conversations orphelines les plus anciennes :
--   delete from public.chat_threads
--    where store_id is null
--      and updated_at < now() - interval '90 days';

-- OPTION C — Empêcher la création de nouvelles conversations sans boutique :
--   contrainte applicative déjà en place dans l'API du Lot 1 (création liée à
--   la boutique analysée) ; aucune contrainte SQL n'est ajoutée pour ne pas
--   casser `ON DELETE SET NULL`.

-- OPTION D — Nettoyage automatique à la suppression d'une boutique :
--   trigger `before delete on public.stores` supprimant les conversations de
--   la boutique. Impact : perte d'historique pour les membres ; à valider
--   produit avant toute mise en œuvre.
