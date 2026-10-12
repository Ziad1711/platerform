-- ============================================================
-- Lightfunnels : reprise progressive de la synchronisation du catalogue
-- ============================================================
-- Constat : l'import du catalogue repartait systématiquement de la première page (curseur
-- remis à zéro à chaque exécution). Sur un catalogue dépassant la limite de pages d'une
-- exécution, les dernières pages n'étaient donc jamais atteintes, même en relançant la
-- synchronisation : les résultats annonçaient « il reste des produits » sans qu'aucune
-- relance ne progresse.
--
-- La progression est désormais enregistrée par boutique liée, comme celle des commandes
-- (`import_cursor` / `has_more`), et une erreur de synchronisation du catalogue est
-- conservée pour être affichée (`last_products_error`).
--
-- Idempotent.
-- ============================================================

alter table public.lightfunnels_store_bindings
  add column if not exists products_cursor text,
  add column if not exists products_has_more boolean not null default true,
  add column if not exists last_products_at timestamptz,
  add column if not exists last_products_scanned integer not null default 0,
  add column if not exists last_products_created integer not null default 0,
  add column if not exists last_products_updated integer not null default 0,
  add column if not exists last_products_error text;

comment on column public.lightfunnels_store_bindings.products_cursor is
  'Curseur de reprise du catalogue : la synchronisation suivante reprend à cette page au lieu de repartir du début.';
comment on column public.lightfunnels_store_bindings.products_has_more is
  'true tant que le catalogue n''a pas été parcouru jusqu''à la dernière page.';
comment on column public.lightfunnels_store_bindings.last_products_error is
  'Dernière erreur de synchronisation du catalogue (visible dans l''assistant, effacée au succès suivant).';
