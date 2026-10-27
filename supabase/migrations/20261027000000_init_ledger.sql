-- =============================================================================
-- Ledger schema
--
-- All balance-changing operations go through the plpgsql functions below so
-- that "insert transaction + update balance" always happens inside a single
-- database transaction (atomic). Each function locks the affected account rows
-- with SELECT ... FOR UPDATE, so concurrent requests against the same account
-- are serialized and can never overdraw it or double-apply a reference_id.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 255),
  balance     numeric(18, 2) not null default 0 check (balance >= 0),
  created_at  timestamptz not null default clock_timestamp()
);

create table if not exists public.transfers (
  id               uuid primary key default gen_random_uuid(),
  from_account_id  uuid not null references public.accounts(id) on delete restrict,
  to_account_id    uuid not null references public.accounts(id) on delete restrict,
  amount           numeric(18, 2) not null check (amount > 0),
  reference_id     text not null check (length(btrim(reference_id)) between 1 and 255),
  description      text check (description is null or length(description) <= 500),
  created_at       timestamptz not null default clock_timestamp(),
  constraint transfers_distinct_accounts check (from_account_id <> to_account_id),
  constraint transfers_reference_unique unique (from_account_id, reference_id)
);

create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete restrict,
  type           text not null check (type in ('credit', 'debit')),
  amount         numeric(18, 2) not null check (amount > 0),
  description    text check (description is null or length(description) <= 500),
  reference_id   text not null check (length(btrim(reference_id)) between 1 and 255),
  balance_after  numeric(18, 2) not null check (balance_after >= 0),
  transfer_id    uuid references public.transfers(id) on delete restrict,
  created_at     timestamptz not null default clock_timestamp(),
  -- Duplicate protection: a reference_id can be used only once per account.
  constraint transactions_account_reference_unique unique (account_id, reference_id)
);

-- Supports "latest first" pagination per account.
create index if not exists transactions_account_created_idx
  on public.transactions (account_id, created_at desc, id desc);

create index if not exists transactions_transfer_idx
  on public.transactions (transfer_id) where transfer_id is not null;

-- -----------------------------------------------------------------------------
-- Integrity guards
-- -----------------------------------------------------------------------------

-- Transactions and transfers are append-only: no UPDATE / DELETE, ever.
create or replace function public.ledger_reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'IMMUTABLE_RECORD: % rows cannot be modified or deleted', tg_table_name
    using errcode = 'P0001';
end;
$$;

drop trigger if exists transactions_immutable on public.transactions;
create trigger transactions_immutable
  before update or delete on public.transactions
  for each row execute function public.ledger_reject_mutation();

drop trigger if exists transfers_immutable on public.transfers;
create trigger transfers_immutable
  before update or delete on public.transfers
  for each row execute function public.ledger_reject_mutation();

-- Account balances may only be changed by the ledger functions (which set a
-- transaction-local flag). A direct "UPDATE accounts SET balance = ..." fails.
-- New accounts must start at 0; their balance is built purely from transactions.
create or replace function public.ledger_guard_account_balance()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.balance <> 0 then
      raise exception 'INVALID_INITIAL_BALANCE: accounts must be created with a zero balance'
        using errcode = 'P0001';
    end if;
  elsif new.balance is distinct from old.balance
        and coalesce(current_setting('ledger.balance_update_allowed', true), '') <> 'on' then
    raise exception 'BALANCE_UPDATE_FORBIDDEN: balance can only change via a ledger transaction'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_balance_guard on public.accounts;
create trigger accounts_balance_guard
  before insert or update on public.accounts
  for each row execute function public.ledger_guard_account_balance();

-- Accounts are referenced by immutable history, so they cannot be deleted.
drop trigger if exists accounts_no_delete on public.accounts;
create trigger accounts_no_delete
  before delete on public.accounts
  for each row execute function public.ledger_reject_mutation();

-- -----------------------------------------------------------------------------
-- Row Level Security: the tables are only reachable with the service role key
-- (used by the Express server). anon / authenticated keys see nothing.
-- -----------------------------------------------------------------------------

alter table public.accounts     enable row level security;
alter table public.transactions enable row level security;
alter table public.transfers    enable row level security;

-- -----------------------------------------------------------------------------
-- Ledger operations
-- -----------------------------------------------------------------------------

-- Applies a single credit/debit to an already-locked account and returns the
-- inserted transaction. Internal helper; callers must hold the row lock.
create or replace function public.ledger_apply_entry(
  p_account_id   uuid,
  p_type         text,
  p_amount       numeric,
  p_description  text,
  p_reference_id text,
  p_transfer_id  uuid
)
returns public.transactions
language plpgsql
as $$
declare
  v_balance     numeric(18, 2);
  v_new_balance numeric(18, 2);
  v_txn         public.transactions;
begin
  select balance into v_balance from public.accounts where id = p_account_id;

  if p_type = 'credit' then
    v_new_balance := v_balance + p_amount;
  else
    if v_balance < p_amount then
      raise exception 'INSUFFICIENT_BALANCE'
        using errcode = 'P0001',
              detail = json_build_object(
                'account_id', p_account_id,
                'balance', v_balance,
                'requested', p_amount
              )::text;
    end if;
    v_new_balance := v_balance - p_amount;
  end if;

  insert into public.transactions
    (account_id, type, amount, description, reference_id, balance_after, transfer_id)
  values
    (p_account_id, p_type, p_amount, p_description, p_reference_id, v_new_balance, p_transfer_id)
  returning * into v_txn;

  perform set_config('ledger.balance_update_allowed', 'on', true);
  update public.accounts set balance = v_new_balance where id = p_account_id;
  perform set_config('ledger.balance_update_allowed', 'off', true);

  return v_txn;
end;
$$;

-- Creates a credit/debit transaction and updates the balance atomically.
-- Returns { "transaction": {...}, "account": {...}, "replayed": bool }.
--
-- Duplicate handling: if (account_id, reference_id) already exists and the
-- request is identical (type, amount, description) the original transaction is
-- returned with replayed=true (idempotent retry). Otherwise DUPLICATE_TRANSACTION.
create or replace function public.create_transaction(
  p_account_id   uuid,
  p_type         text,
  p_amount       numeric,
  p_reference_id text,
  p_description  text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_account  public.accounts;
  v_existing public.transactions;
  v_txn      public.transactions;
begin
  if p_type is null or p_type not in ('credit', 'debit') then
    raise exception 'INVALID_TRANSACTION_TYPE' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- Lock the account row: serializes all writers for this account.
  select * into v_account from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'ACCOUNT_NOT_FOUND'
      using errcode = 'P0001', detail = json_build_object('account_id', p_account_id)::text;
  end if;

  select * into v_existing
    from public.transactions
   where account_id = p_account_id and reference_id = p_reference_id;

  if found then
    if v_existing.type = p_type
       and v_existing.amount = p_amount
       and v_existing.description is not distinct from p_description
       and v_existing.transfer_id is null then
      return jsonb_build_object(
        'transaction', to_jsonb(v_existing),
        'account', to_jsonb(v_account),
        'replayed', true
      );
    end if;
    raise exception 'DUPLICATE_TRANSACTION'
      using errcode = 'P0001',
            detail = json_build_object(
              'account_id', p_account_id,
              'reference_id', p_reference_id,
              'existing_transaction_id', v_existing.id
            )::text;
  end if;

  v_txn := public.ledger_apply_entry(p_account_id, p_type, p_amount, p_description, p_reference_id, null);

  select * into v_account from public.accounts where id = p_account_id;

  return jsonb_build_object(
    'transaction', to_jsonb(v_txn),
    'account', to_jsonb(v_account),
    'replayed', false
  );
end;
$$;

-- Moves money between two accounts atomically: one debit on the source, one
-- credit on the destination, both linked to a transfers row. Any failure
-- (missing account, insufficient funds, duplicate reference) rolls back all of it.
create or replace function public.create_transfer(
  p_from_account_id uuid,
  p_to_account_id   uuid,
  p_amount          numeric,
  p_reference_id    text,
  p_description     text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_locked_count int;
  v_existing     public.transfers;
  v_transfer     public.transfers;
  v_debit        public.transactions;
  v_credit       public.transactions;
begin
  if p_from_account_id = p_to_account_id then
    raise exception 'SAME_ACCOUNT_TRANSFER' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  -- Lock both accounts in a deterministic (id) order to avoid deadlocks when
  -- A->B and B->A transfers run concurrently.
  perform 1
     from public.accounts
    where id in (p_from_account_id, p_to_account_id)
    order by id
    for update;

  if not exists (select 1 from public.accounts where id = p_from_account_id) then
    raise exception 'ACCOUNT_NOT_FOUND'
      using errcode = 'P0001', detail = json_build_object('account_id', p_from_account_id)::text;
  end if;
  if not exists (select 1 from public.accounts where id = p_to_account_id) then
    raise exception 'ACCOUNT_NOT_FOUND'
      using errcode = 'P0001', detail = json_build_object('account_id', p_to_account_id)::text;
  end if;

  select * into v_existing
    from public.transfers
   where from_account_id = p_from_account_id and reference_id = p_reference_id;

  if found then
    if v_existing.to_account_id = p_to_account_id
       and v_existing.amount = p_amount
       and v_existing.description is not distinct from p_description then
      return jsonb_build_object(
        'transfer', to_jsonb(v_existing),
        'debit', (select to_jsonb(t) from public.transactions t
                   where t.transfer_id = v_existing.id and t.type = 'debit'),
        'credit', (select to_jsonb(t) from public.transactions t
                    where t.transfer_id = v_existing.id and t.type = 'credit'),
        'from_account', (select to_jsonb(a) from public.accounts a where a.id = p_from_account_id),
        'to_account', (select to_jsonb(a) from public.accounts a where a.id = p_to_account_id),
        'replayed', true
      );
    end if;
    raise exception 'DUPLICATE_TRANSACTION'
      using errcode = 'P0001',
            detail = json_build_object(
              'account_id', p_from_account_id,
              'reference_id', p_reference_id,
              'existing_transfer_id', v_existing.id
            )::text;
  end if;

  -- Reference id must also be free on both accounts' transaction ledgers.
  if exists (select 1 from public.transactions
              where reference_id = p_reference_id
                and account_id in (p_from_account_id, p_to_account_id)) then
    raise exception 'DUPLICATE_TRANSACTION'
      using errcode = 'P0001',
            detail = json_build_object('reference_id', p_reference_id)::text;
  end if;

  insert into public.transfers (from_account_id, to_account_id, amount, reference_id, description)
  values (p_from_account_id, p_to_account_id, p_amount, p_reference_id, p_description)
  returning * into v_transfer;

  v_debit  := public.ledger_apply_entry(p_from_account_id, 'debit',  p_amount, p_description, p_reference_id, v_transfer.id);
  v_credit := public.ledger_apply_entry(p_to_account_id,   'credit', p_amount, p_description, p_reference_id, v_transfer.id);

  return jsonb_build_object(
    'transfer', to_jsonb(v_transfer),
    'debit', to_jsonb(v_debit),
    'credit', to_jsonb(v_credit),
    'from_account', (select to_jsonb(a) from public.accounts a where a.id = p_from_account_id),
    'to_account', (select to_jsonb(a) from public.accounts a where a.id = p_to_account_id),
    'replayed', false
  );
end;
$$;

-- Only the backend (service_role) may call the ledger functions.
revoke all on function public.ledger_apply_entry(uuid, text, numeric, text, text, uuid) from public, anon, authenticated;
revoke all on function public.create_transaction(uuid, text, numeric, text, text)     from public, anon, authenticated;
revoke all on function public.create_transfer(uuid, uuid, numeric, text, text)        from public, anon, authenticated;
grant execute on function public.create_transaction(uuid, text, numeric, text, text)  to service_role;
grant execute on function public.create_transfer(uuid, uuid, numeric, text, text)     to service_role;
grant execute on function public.ledger_apply_entry(uuid, text, numeric, text, text, uuid) to service_role;
