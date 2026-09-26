-- Un admin révoqué ne doit plus pouvoir modifier un store via l'API directe.
-- La politique UPDATE "Owner or admin can update stores" vérifiait le rôle
-- owner/admin sans exiger status='active' : un membre révoqué conservait la
-- possibilité de renommer un store ou d'en changer la devise en accès direct.
drop policy if exists "Owner or admin can update stores" on public.stores;
create policy "Owner or admin can update stores" on public.stores
  for update to public
  using (
    exists (
      select 1 from public.store_members sm
      where sm.store_id = stores.id
        and sm.user_id = auth.uid()
        and sm.role = any(array['owner','admin'])
        and sm.status = 'active'
    )
  );
