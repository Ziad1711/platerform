-- ============================================================================
-- Abonnements Jisra : droits côté serveur uniquement (lecture seule côté client)
-- et application des limites d'offre (commandes, stores, crédits IA).
--
-- Règle unique de plan effectif : `public.resolve_effective_plan(user_id)`.
-- Convention « illimité » du catalogue d'offres : 999999 (voir
-- `public.plan_limit_is_unlimited`), identique à l'affichage marketing.
-- ============================================================================

-- ---------- 1. Source unique du plan effectif ----------
-- Abonnement ACTIF et NON expiré le plus élevé, sinon l'offre gratuite.
-- Une ligne active dont `expires_at` est passé n'ouvre donc plus aucun droit.
create or replace function public.resolve_effective_plan(p_user_id uuid)
returns public.plans
language sql
stable
security definer
set search_path = public
as $$
  with active as (
    select s.plan_id, s.started_at, s.created_at
    from public.subscriptions s
    where s.user_id = p_user_id
      and s.status = 'active'
      and (s.expires_at is null or s.expires_at > now())
  ),
  chosen as (
    select p.id
    from active a
    join public.plans p on p.id = a.plan_id
    order by p.price desc, a.started_at desc, a.created_at desc
    limit 1
  )
  select p
  from public.plans p
  where p.id = coalesce(
    (select c.id from chosen c),
    (select f.id from public.plans f where f.price = 0 order by f.price asc limit 1)
  )
$$;

comment on function public.resolve_effective_plan(uuid) is
  'Plan effectif d''un utilisateur : abonnement actif non expiré le plus élevé, sinon offre gratuite.';

-- Convention « illimité » unique, alignée sur l'affichage marketing.
create or replace function public.plan_limit_is_unlimited(p_limit integer)
returns boolean
language sql
immutable
as $$
  select p_limit is null or p_limit >= 999999
$$;

comment on function public.plan_limit_is_unlimited(integer) is
  'Convention unique du catalogue : 999999 (ou plus) signifie « illimité ».';

-- ---------- 2. Abonnements : lecture seule pour le client ----------
-- Le plan, le statut, l'échéance et le montant ne doivent jamais être modifiables
-- depuis le navigateur. Seules les opérations serveur (trigger d'inscription,
-- paiement vérifié, service role) écrivent dans cette table.
alter table public.subscriptions enable row level security;

revoke all on public.subscriptions from anon;
revoke insert, update, delete on public.subscriptions from authenticated;
grant select on public.subscriptions to authenticated;

drop policy if exists "Users can insert their own subscriptions" on public.subscriptions;
drop policy if exists "Users can update their own subscriptions" on public.subscriptions;
drop policy if exists "Users can view their own subscriptions" on public.subscriptions;
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (user_id = auth.uid());

-- Le catalogue d'offres reste public en lecture, mais n'est plus modifiable
-- par les clients (aucune politique d'écriture, droits retirés).
revoke insert, update, delete on public.plans from anon, authenticated;
