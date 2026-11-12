begin;
-- Table privée : le backend (service_role) alimente le cache, aucun client direct.
grant select,insert,update on saas_admin.analytics_reports to service_role;
commit;
