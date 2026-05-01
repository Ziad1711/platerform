create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (
    id,
    first_name,
    last_name,
    full_name,
    language,
    timezone
  )
  values (
    new.id,
    nullif(trim(meta->>'first_name'), ''),
    nullif(trim(meta->>'last_name'), ''),
    nullif(trim(meta->>'full_name'), ''),
    coalesce(nullif(trim(meta->>'language'), ''), 'fr'),
    coalesce(nullif(trim(meta->>'timezone'), ''), 'Africa/Casablanca')
  )
  on conflict (id) do update
  set
    first_name = coalesce(excluded.first_name, profiles.first_name),
    last_name = coalesce(excluded.last_name, profiles.last_name),
    full_name = coalesce(excluded.full_name, profiles.full_name),
    language = coalesce(excluded.language, profiles.language),
    timezone = coalesce(excluded.timezone, profiles.timezone),
    updated_at = now();

  return new;
end;
$$;