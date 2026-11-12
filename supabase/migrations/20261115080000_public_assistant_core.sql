-- Lot 6. Assistant commercial public : admission, budget et usage anonymes.
begin;
create table saas_admin.public_chat_usage (
 day date primary key,
 requests integer not null default 0 check(requests>=0),
 input_tokens bigint not null default 0 check(input_tokens>=0),
 output_tokens bigint not null default 0 check(output_tokens>=0),
 cost_micro_usd bigint not null default 0 check(cost_micro_usd>=0),
 updated_at timestamptz not null default now()
);
create table saas_admin.public_chat_admission (
 key_hash text not null check(key_hash ~ '^[a-f0-9]{64}$'),
 window_start timestamptz not null,
 hits integer not null check(hits>=0),
 in_flight integer not null default 0 check(in_flight between 0 and 1),
 primary key(key_hash,window_start)
);
create table saas_admin.public_chat_contacts (
 id uuid primary key default gen_random_uuid(),
 message text not null check(length(trim(message)) between 10 and 1000),
 email text check(email is null or (length(email)<=254 and email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$')),
 preferred_channel text not null default 'email' check(preferred_channel in ('email','phone')),
 locale text not null default 'fr' check(locale in ('fr','ar','ary')),
 created_at timestamptz not null default now(),
 handled_at timestamptz,
 status text not null default 'new' check(status in ('new','handled'))
);
create table saas_admin.public_chat_events (
 id bigint generated always as identity primary key,
 outcome text not null check(outcome in ('allowed','denied','quota','budget','provider_error','reply')),
 reason text,
 created_at timestamptz not null default now()
);
create index public_chat_events_time on saas_admin.public_chat_events(created_at desc);
alter table saas_admin.public_chat_usage enable row level security;
alter table saas_admin.public_chat_admission enable row level security;
alter table saas_admin.public_chat_contacts enable row level security;
alter table saas_admin.public_chat_events enable row level security;
revoke all on saas_admin.public_chat_usage,saas_admin.public_chat_admission,
 saas_admin.public_chat_contacts,saas_admin.public_chat_events from public,anon,authenticated,service_role;
grant select,insert,update on saas_admin.public_chat_usage to service_role;
grant select,insert,update on saas_admin.public_chat_admission to service_role;
grant select,insert,update on saas_admin.public_chat_contacts to service_role;
grant select,insert on saas_admin.public_chat_events to service_role;
revoke all on all sequences in schema saas_admin from public,anon,authenticated;
grant usage,select on all sequences in schema saas_admin to service_role;
comment on table saas_admin.public_chat_contacts is
 'Demandes humaines sans SMTP. Aucune donnée bancaire, aucun justificatif, aucun contenu de boutique.';
comment on table saas_admin.public_chat_admission is
 'Clés pseudonymisées (HMAC côté serveur). Jamais d’adresse IP brute ni d’identité visiteur.';
commit;
