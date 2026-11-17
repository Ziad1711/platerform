-- Lot 4 (correctif) : la fonction trigger ne doit pas être exécutable directement
-- par les rôles applicatifs (elle est invoquée par le déclencheur, pas par le client).
begin;
set local lock_timeout='5s';
revoke all on function public.enqueue_payment_email() from public,anon,authenticated,service_role;
commit;
