-- Auto-assign the Free plan subscription when a new user signs up
-- Uses the same pattern as handle_new_user() trigger on auth.users

create or replace function public.assign_free_plan_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_free_plan_id constant uuid := '6b5dd0ac-1a8c-48d6-9d6a-edfda8aeac15';
begin
  -- Only insert if the user doesn't already have a subscription (idempotent)
  if not exists (
    select 1 from public.subscriptions
    where user_id = new.id
  ) then
    insert into public.subscriptions (
      user_id,
      plan_id,
      status,
      amount_paid,
      currency,
      started_at
    )
    values (
      new.id,
      v_free_plan_id,
      'active',
      0,
      'MAD',
      now()
    );
  end if;

  return new;
end;
$$;

-- Drop existing trigger if any (idempotent)
drop trigger if exists on_auth_user_created_assign_free_plan on auth.users;

-- Create trigger on auth.users AFTER INSERT
create trigger on_auth_user_created_assign_free_plan
  after insert on auth.users
  for each row
  execute function public.assign_free_plan_on_signup();

-- Backfill: assign Free plan to existing users who don't have a subscription yet
insert into public.subscriptions (
  user_id,
  plan_id,
  status,
  amount_paid,
  currency,
  started_at
)
select
  p.id,
  '6b5dd0ac-1a8c-48d6-9d6a-edfda8aeac15'::uuid,
  'active',
  0,
  'MAD',
  now()
from public.profiles p
where not exists (
  select 1 from public.subscriptions s
  where s.user_id = p.id
);
