-- ============================================================================
-- Crédits IA : le solde n'est plus modifiable par le client.
--
-- Le portefeuille est alimenté et débité exclusivement par des fonctions
-- serveur (SECURITY DEFINER), avec recharge mensuelle alignée sur
-- `plans.ai_credits_monthly` du plan effectif et débit atomique.
-- ============================================================================

alter table public.ai_credit_wallets enable row level security;

revoke all on public.ai_credit_wallets from anon;
revoke insert, update, delete on public.ai_credit_wallets from authenticated;
grant select on public.ai_credit_wallets to authenticated;

drop policy if exists "Users can insert their credit wallet" on public.ai_credit_wallets;
drop policy if exists "Users can update their credit wallet" on public.ai_credit_wallets;
drop policy if exists "Users can view their credit wallet" on public.ai_credit_wallets;
drop policy if exists ai_credit_wallets_select_own on public.ai_credit_wallets;
create policy ai_credit_wallets_select_own on public.ai_credit_wallets
  for select to authenticated
  using (user_id = auth.uid());

-- ---------- Portefeuille : création et recharge mensuelle ----------
create or replace function public.rpc_ensure_ai_credit_wallet()
returns table (wallet_id uuid, monthly_credits integer, credits_used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan public.plans;
  v_wallet public.ai_credit_wallets;
begin
  if v_user is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  v_plan := public.resolve_effective_plan(v_user);

  select w.* into v_wallet
  from public.ai_credit_wallets w
  where w.user_id = v_user
  for update;

  if v_wallet.id is null then
    insert into public.ai_credit_wallets (user_id, monthly_credits, credits_used, reset_date)
    values (v_user, coalesce(v_plan.ai_credits_monthly, 0), 0, date_trunc('month', now())::date)
    returning * into v_wallet;
  elsif v_wallet.reset_date is null
     or v_wallet.reset_date < date_trunc('month', now())::date
     or (v_wallet.monthly_credits = 0 and v_wallet.credits_used = 0) then
    update public.ai_credit_wallets w
    set monthly_credits = coalesce(v_plan.ai_credits_monthly, 0),
        credits_used = 0,
        reset_date = date_trunc('month', now())::date,
        updated_at = now()
    where w.id = v_wallet.id
    returning * into v_wallet;
  end if;

  return query select v_wallet.id, v_wallet.monthly_credits, v_wallet.credits_used;
end;
$$;

-- ---------- Débit atomique ----------
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

  select w.* into v_wallet
  from public.ai_credit_wallets w
  where w.user_id = v_user
  for update;

  if v_wallet.id is null then
    raise exception 'WALLET_NOT_FOUND' using errcode = 'P0001';
  end if;

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

revoke all on function public.rpc_ensure_ai_credit_wallet() from public, anon;
revoke all on function public.rpc_debit_ai_credits(integer) from public, anon;
grant execute on function public.rpc_ensure_ai_credit_wallet() to authenticated;
grant execute on function public.rpc_debit_ai_credits(integer) to authenticated;
