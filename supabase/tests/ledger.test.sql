-- Database-level integrity checks for the ledger functions.
-- Run in the Supabase SQL editor or with psql. Everything is rolled back.
-- Success prints "NOTICE: ledger tests passed"; any failure raises an exception.

begin;

do $$
declare
  a uuid;
  b uuid;
  r jsonb;

begin
  insert into accounts (name) values ('Test A') returning id into a;
  insert into accounts (name) values ('Test B') returning id into b;

  -- Spec example: 0 +100 +50 -30 -20 = 100
  perform create_transaction(a, 'credit', 100, 't1');
  perform create_transaction(a, 'credit', 50, 't2');
  perform create_transaction(a, 'debit', 30, 't3');
  r := create_transaction(a, 'debit', 20, 't4');
  assert (r->'account'->>'balance')::numeric = 100, 'balance should be 100 after spec example';
  assert (r->'transaction'->>'balance_after')::numeric = 100, 'balance_after should be 100';

  -- Insufficient balance: rejected and balance unchanged.
  begin
    perform create_transaction(a, 'debit', 100.01, 't5');
    raise exception 'expected INSUFFICIENT_BALANCE';
  exception when others then
    assert sqlerrm = 'INSUFFICIENT_BALANCE', 'got ' || sqlerrm;
  end;
  assert (select balance from accounts where id = a) = 100, 'failed debit must not change balance';
  assert not exists (select 1 from transactions where reference_id = 't5'), 'failed debit must not be stored';

  -- Duplicate reference_id: identical retry is replayed, different payload rejected.
  r := create_transaction(a, 'credit', 100, 't1');
  assert (r->>'replayed')::boolean, 'identical retry should be replayed';
  assert (select balance from accounts where id = a) = 100, 'replay must not change balance';
  begin
    perform create_transaction(a, 'credit', 999, 't1');
    raise exception 'expected DUPLICATE_TRANSACTION';
  exception when others then
    assert sqlerrm = 'DUPLICATE_TRANSACTION', 'got ' || sqlerrm;
  end;

  -- Same reference_id on a different account is allowed.
  perform create_transaction(b, 'credit', 50, 't1');

  -- Unknown account.
  begin
    perform create_transaction(gen_random_uuid(), 'credit', 1, 'x');
    raise exception 'expected ACCOUNT_NOT_FOUND';
  exception when others then
    assert sqlerrm = 'ACCOUNT_NOT_FOUND', 'got ' || sqlerrm;
  end;

  -- Immutability.
  begin
    update transactions set amount = 1 where account_id = a;
    raise exception 'expected IMMUTABLE_RECORD';
  exception when others then
    assert sqlerrm like 'IMMUTABLE_RECORD%', 'got ' || sqlerrm;
  end;
  begin
    delete from transactions where account_id = a;
    raise exception 'expected IMMUTABLE_RECORD';
  exception when others then
    assert sqlerrm like 'IMMUTABLE_RECORD%', 'got ' || sqlerrm;
  end;

  -- Balance can't be edited directly.
  begin
    update accounts set balance = 1000000 where id = a;
    raise exception 'expected BALANCE_UPDATE_FORBIDDEN';
  exception when others then
    assert sqlerrm like 'BALANCE_UPDATE_FORBIDDEN%', 'got ' || sqlerrm;
  end;

  -- Transfer spec example: A=100, B=50, move 30 -> A=70, B=80.
  r := create_transfer(a, b, 30, 'tr1');
  assert (r->'from_account'->>'balance')::numeric = 70, 'A should be 70';
  assert (r->'to_account'->>'balance')::numeric = 80, 'B should be 80';

  -- Failed transfer leaves no trace.
  begin
    perform create_transfer(a, b, 1000, 'tr2');
    raise exception 'expected INSUFFICIENT_BALANCE';
  exception when others then
    assert sqlerrm = 'INSUFFICIENT_BALANCE', 'got ' || sqlerrm;
  end;
  assert not exists (select 1 from transfers where reference_id = 'tr2'), 'failed transfer must not be stored';
  assert (select balance from accounts where id = a) = 70, 'A unchanged after failed transfer';
  assert (select balance from accounts where id = b) = 80, 'B unchanged after failed transfer';

  -- Stored balance always equals the sum of the ledger.
  assert not exists (
    select 1
      from accounts acc
     where acc.id in (a, b)
       and acc.balance <> (
         select coalesce(sum(case t.type when 'credit' then t.amount else -t.amount end), 0)
           from transactions t
          where t.account_id = acc.id)
  ), 'stored balance must equal the sum of transactions';

  raise notice 'ledger tests passed';
end;
$$;

rollback;
