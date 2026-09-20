-- Durcissement des clés API publiques (site web personnalisé).
-- 1) Suppression de l'ancienne politique anonyme qui exposait la table.
-- 2) Seuls les rôles habilités à gérer les intégrations peuvent lire/créer/révoquer une clé.

create or replace function public.can_manage_store_integrations(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.store_members m
    where m.store_id = p_store_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner', 'admin', 'marketer')
  );
$$;

comment on function public.can_manage_store_integrations(uuid) is
  'Vrai si l''utilisateur courant peut gérer les intégrations (clés API) du store : owner, admin ou marketer actif.';

revoke all on function public.can_manage_store_integrations(uuid) from public;
grant execute on function public.can_manage_store_integrations(uuid) to authenticated, service_role;

-- L'accès anonyme direct à la table des clés n'est plus nécessaire :
-- la validation des clés passe uniquement par le client administrateur côté serveur.
drop policy if exists "public_api_keys_select_key_hash_anon" on public.public_api_keys;
revoke all on public.public_api_keys from anon;

drop policy if exists "public_api_keys_select_store_members" on public.public_api_keys;
drop policy if exists "public_api_keys_select_managers" on public.public_api_keys;
create policy "public_api_keys_select_managers"
on public.public_api_keys for select
using (public.can_manage_store_integrations(store_id));

drop policy if exists "public_api_keys_insert_store_members" on public.public_api_keys;
drop policy if exists "public_api_keys_insert_managers" on public.public_api_keys;
create policy "public_api_keys_insert_managers"
on public.public_api_keys for insert
with check (public.can_manage_store_integrations(store_id));

drop policy if exists "public_api_keys_update_store_members" on public.public_api_keys;
drop policy if exists "public_api_keys_update_managers" on public.public_api_keys;
create policy "public_api_keys_update_managers"
on public.public_api_keys for update
using (public.can_manage_store_integrations(store_id))
with check (public.can_manage_store_integrations(store_id));

drop policy if exists "public_api_keys_delete_store_members" on public.public_api_keys;
drop policy if exists "public_api_keys_delete_managers" on public.public_api_keys;
create policy "public_api_keys_delete_managers"
on public.public_api_keys for delete
using (public.can_manage_store_integrations(store_id));
