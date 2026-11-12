-- Lot 4C. Comptabilité de gestion Jisra, jamais les finances des boutiques.
begin;
set local lock_timeout='5s';
insert into saas_admin.role_permissions(role,permission) values
 ('platform_owner','finance.read'),('platform_owner','finance.write'),('platform_owner','finance.export');
create table saas_admin.expense_categories (
 id uuid primary key default gen_random_uuid(),
 name text not null unique check(length(trim(name)) between 2 and 120),
 active boolean not null default true,created_at timestamptz not null default now()
);
insert into saas_admin.expense_categories(name) values
 ('Hébergement Contabo / Vercel'),('Services et APIs IA'),('Publicité et marketing'),
 ('Domaines et outils'),('Prestataires et services'),('Autres charges');
create table saas_admin.cash_accounts (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check(code=upper(trim(code)) and length(code) between 2 and 80),
 name text not null check(length(trim(name)) between 2 and 120),
 currency text not null check(currency in ('MAD','EUR','USD','GBP','CAD','AED')),
 minor_units integer not null default 2 check(minor_units=2),
 created_at timestamptz not null default now(),created_by uuid not null
);
create table saas_admin.expenses (
 id uuid primary key default gen_random_uuid(),
 category_id uuid not null references saas_admin.expense_categories(id),
 beneficiary text not null check(length(trim(beneficiary)) between 2 and 200),
 description text not null check(length(trim(description)) between 2 and 500),
 invoice_reference text not null check(length(trim(invoice_reference)) between 1 and 120),
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 tax_minor bigint not null default 0 check(tax_minor>=0 and tax_minor<=amount_minor),
 currency text not null check(currency in ('MAD','EUR','USD','GBP','CAD','AED')),
 incurred_on date not null,
 status text not null default 'draft' check(status in ('draft','posted','cancelled')),
 kind text not null default 'charge' check(kind in ('charge','credit')),
 reverses_id uuid unique references saas_admin.expenses(id),
 version integer not null default 1,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null,
 unique(beneficiary,invoice_reference,currency,kind),
 check((kind='charge' and reverses_id is null) or (kind='credit' and reverses_id is not null))
);
create table saas_admin.cash_movements (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references saas_admin.cash_accounts(id),
 amount_minor bigint not null check(amount_minor between 1 and 9007199254740991),
 direction integer not null check(direction in (-1,1)),
 kind text not null check(kind in ('opening','expense','expense_refund','transfer','contribution','withdrawal','payment_refund','correction')),
 occurred_on date not null,
 reference text not null check(length(trim(reference)) between 2 and 120),
 reason text not null check(length(trim(reason)) between 10 and 500),
 operation_id uuid not null,
 reverses_id uuid unique references saas_admin.cash_movements(id),
 payment_id uuid references saas_admin.payments(id),
 created_at timestamptz not null default now(),created_by uuid not null,
 unique(account_id,reference),
 check((kind='correction' and reverses_id is not null) or (kind<>'correction' and reverses_id is null)),
 check(kind<>'payment_refund' or payment_id is not null)
);
create unique index cash_opening_once on saas_admin.cash_movements(account_id) where kind='opening';
create table saas_admin.expense_settlements (
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null references saas_admin.expenses(id),
 movement_id uuid not null unique references saas_admin.cash_movements(id),
 amount_minor bigint not null check(amount_minor>0),
 direction integer not null check(direction in (-1,1)),
 reverses_id uuid references saas_admin.expense_settlements(id),
 created_at timestamptz not null default now()
);
create table saas_admin.finance_operations (
 id uuid primary key,actor_id uuid not null,action text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now()
);
create table saas_admin.expense_proofs (
 id uuid primary key,expense_id uuid not null references saas_admin.expenses(id),
 object_path text not null unique,mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes integer not null check(size_bytes between 1 and 5242880),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid not null,created_at timestamptz not null default now(),unique(expense_id,sha256)
);
create index finance_expenses_period on saas_admin.expenses(incurred_on desc,id);
create index finance_expenses_category on saas_admin.expenses(category_id,currency,status,incurred_on);
create index finance_cash_period on saas_admin.cash_movements(account_id,occurred_on,id);
create index finance_settlements_expense on saas_admin.expense_settlements(expense_id);
create index finance_payment_value on saas_admin.payments(value_date,bank_account);
-- Union de lecture : un encaissement 4B n'est JAMAIS recopié dans cash_movements.
create view saas_admin.cash_ledger as
 select m.id,m.account_id,a.currency,m.amount_minor,m.direction,m.kind,m.occurred_on,m.reference,m.reason,m.created_at
 from saas_admin.cash_movements m join saas_admin.cash_accounts a on a.id=m.account_id
 union all
 select p.id,a.id,p.currency,p.amount_minor,1,'subscription_receipt',p.value_date,p.bank_reference,
 'Encaissement bancaire vérifié (Lot 4B)',p.verified_at
 from saas_admin.payments p left join saas_admin.cash_accounts a on a.code=p.bank_account and a.currency=p.currency;

create function saas_admin.protect_posted_expense() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' or old.status<>'draft' then raise exception 'FINANCE_IMMUTABLE'; end if;
 if new.id<>old.id or new.created_by<>old.created_by or new.kind<>old.kind or new.reverses_id is distinct from old.reverses_id then raise exception 'FINANCE_IMMUTABLE'; end if;
 return new;
end $$;
create trigger expense_protect before update or delete on saas_admin.expenses for each row execute function saas_admin.protect_posted_expense();
create trigger cash_append_only before update or delete on saas_admin.cash_movements for each row execute function saas_admin.append_only();
create trigger settlement_append_only before update or delete on saas_admin.expense_settlements for each row execute function saas_admin.append_only();
create trigger finance_operations_append_only before update or delete on saas_admin.finance_operations for each row execute function saas_admin.append_only();
create trigger expense_proof_append_only before update or delete on saas_admin.expense_proofs for each row execute function saas_admin.append_only();
alter table saas_admin.expense_categories enable row level security;
alter table saas_admin.cash_accounts enable row level security;
alter table saas_admin.expenses enable row level security;
alter table saas_admin.cash_movements enable row level security;
alter table saas_admin.expense_settlements enable row level security;
alter table saas_admin.finance_operations enable row level security;
alter table saas_admin.expense_proofs enable row level security;
revoke all on all tables in schema saas_admin from public,anon,authenticated,service_role;
revoke all on all sequences in schema saas_admin from public,anon,authenticated,service_role;
revoke all on all functions in schema saas_admin from public,anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('saas-expense-proofs','saas-expense-proofs',false,5242880,array['application/pdf','image/png','image/jpeg']);
-- Aucune politique utilisateur Storage : seul le backend après RPC autorisée.
commit;