-- Périmètres (scopes) des clés API publiques utilisées par le site web personnalisé.
-- products:read -> lecture du catalogue (produits + variantes + prix)
-- stock:read    -> lecture du stock disponible
-- orders:write  -> envoi des commandes vers Jisra

alter table public.public_api_keys
  add column if not exists scopes text[] not null
  default array['products:read', 'stock:read', 'orders:write']::text[];

comment on column public.public_api_keys.scopes is
  'Périmètres autorisés de la clé API publique : products:read, stock:read, orders:write.';

-- Une clé existante sans scope explicite conserve un accès complet (rétro-compatibilité).
update public.public_api_keys
set scopes = array['products:read', 'stock:read', 'orders:write']::text[]
where scopes is null or cardinality(scopes) = 0;

alter table public.public_api_keys
  drop constraint if exists public_api_keys_scopes_check;

alter table public.public_api_keys
  add constraint public_api_keys_scopes_check
  check (
    cardinality(scopes) > 0
    and scopes <@ array['products:read', 'stock:read', 'orders:write']::text[]
  );

create index if not exists idx_public_api_keys_scopes
  on public.public_api_keys using gin (scopes);
