-- Catalogue public des intégrations (page marketing /catalogue-integrations).
-- Seuls les fournisseurs actifs sont exposés en lecture anonyme ; aucune
-- colonne d'identification (clés, tokens) ne vit dans cette table.
drop policy if exists "integration_providers_anon_read_active" on public.integration_providers;

create policy "integration_providers_anon_read_active"
  on public.integration_providers
  for select
  to anon
  using (is_active = true);
