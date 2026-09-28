-- ============================================================================
-- Crédits IA : le plafond du portefeuille suit toujours le plan effectif.
--
-- Avant cette migration, un changement d'offre en cours de mois laissait
-- l'ancien plafond utilisable jusqu'au mois suivant : une rétrogradation
-- conservait les crédits de l'offre supérieure, une montée d'offre ne
-- s'appliquait qu'au mois suivant. Le portefeuille mémorise désormais l'offre
-- qui a fixé son plafond (`plan_id`).
--
-- Règle de synchronisation :
--   * nouveau mois          : plafond du plan courant, consommation remise à 0 ;
--   * changement d'offre    : plafond du plan courant, consommation déjà faite
--                             conservée (aucune remise à zéro, donc pas d'abus
--                             par va-et-vient entre offres) ;
--   * première utilisation  : création avec le plafond du plan courant.
-- ============================================================================

alter table public.ai_credit_wallets
  add column if not exists plan_id uuid references public.plans(id) on delete set null;

comment on column public.ai_credit_wallets.plan_id is
  'Offre qui a fixé `monthly_credits` (permet de suivre un changement d''offre en cours de mois).';

-- Reprise des portefeuilles existants : on aligne le plafond sur l'offre effective.
update public.ai_credit_wallets w
set plan_id = pe.id,
    monthly_credits = coalesce(pe.ai_credits_monthly, 0),
    updated_at = now()
from public.ai_credit_wallets w2
cross join lateral public.resolve_effective_plan(w2.user_id) pe
where w.id = w2.id
  and (
    w.plan_id is distinct from pe.id
    or w.monthly_credits is distinct from coalesce(pe.ai_credits_monthly, 0)
  );

-- ---------- Synchronisation interne (réservée au serveur) ----------
create or replace function public.sync_ai_credit_wallet_for_plan(
  p_user_id uuid,
  p_plan public.plans
)
returns public.ai_credit_wallets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.ai_credit_wallets;
  v_entitlement integer := coalesce(p_plan.ai_credits_monthly, 0);
  v_month_start date := date_trunc('month', now())::date;
begin
  select w.* into v_wallet
  from public.ai_credit_wallets w
  where w.user_id = p_user_id
  for update;

  if v_wallet.id is null then
    insert into public.ai_credit_wallets (user_id, plan_id, monthly_credits, credits_used, reset_date)
    values (p_user_id, p_plan.id, v_entitlement, 0, v_month_start)
    returning * into v_wallet;

    return v_wallet;
  end if;

  if v_wallet.reset_date is null or v_wallet.reset_date < v_month_start then
    update public.ai_credit_wallets w
    set plan_id = p_plan.id,
        monthly_credits = v_entitlement,
        credits_used = 0,
        reset_date = v_month_start,
        updated_at = now()
    where w.id = v_wallet.id
    returning * into v_wallet;

    return v_wallet;
  end if;

  if v_wallet.plan_id is distinct from p_plan.id
     or v_wallet.monthly_credits is distinct from v_entitlement then
    update public.ai_credit_wallets w
    set plan_id = p_plan.id,
        monthly_credits = v_entitlement,
        updated_at = now()
    where w.id = v_wallet.id
    returning * into v_wallet;
  end if;

  return v_wallet;
end;
$$;

comment on function public.sync_ai_credit_wallet_for_plan(uuid, public.plans) is
  'Portefeuille de crédits IA aligné sur le plan effectif : recharge mensuelle, suivi du changement d''offre, débit réservé au serveur.';

-- ---------- Recharge / création ----------
create or replace function public.rpc_ensure_ai_credit_wallet()
returns table (wallet_id uuid, monthly_credits integer, credits_used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.ai_credit_wallets;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  v_wallet := public.sync_ai_credit_wallet_for_plan(v_user, public.resolve_effective_plan(v_user));

  return query select v_wallet.id, v_wallet.monthly_credits, v_wallet.credits_used;
end;
$$;

-- ---------- Débit atomique ----------
-- Le plafond est resynchronisé sur l'offre effective avant le contrôle, sinon un
-- plafond périmé autoriserait un débit au-delà des droits réels.
create or replace function public.rpc_debit_ai_credits(p_credits integer)
returns table (wallet_id uuid, monthly_credits integer, credits_used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_credits integer := greatest(0, coalesce(p_credits, 0));
  v_wallet public.ai_credit_wallets;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  v_wallet := public.sync_ai_credit_wallet_for_plan(v_user, public.resolve_effective_plan(v_user));

  if (v_wallet.monthly_credits - v_wallet.credits_used) < v_credits then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.ai_credit_wallets w
  set credits_used = w.credits_used + v_credits,
      updated_at = now()
  where w.id = v_wallet.id
  returning * into v_wallet;

  return query select v_wallet.id, v_wallet.monthly_credits, v_wallet.credits_used;
end;
$$;

-- La synchronisation n'est appelée que par les fonctions serveur ci-dessus.
revoke all on function public.sync_ai_credit_wallet_for_plan(uuid, public.plans) from public, anon, authenticated;
revoke all on function public.rpc_ensure_ai_credit_wallet() from public, anon;
revoke all on function public.rpc_debit_ai_credits(integer) from public, anon;
grant execute on function public.rpc_ensure_ai_credit_wallet() to authenticated;
grant execute on function public.rpc_debit_ai_credits(integer) to authenticated;
