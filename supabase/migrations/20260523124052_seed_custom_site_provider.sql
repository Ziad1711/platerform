INSERT INTO integration_providers (name, slug, description, category, is_active)
VALUES ('Site web personnalisé', 'custom-site', 'Importez les commandes de votre site e-commerce via une API simple', 'api', true)
ON CONFLICT (slug) DO NOTHING;
