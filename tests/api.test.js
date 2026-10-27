const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const createApp = require('../src/app');
const createServices = require('../src/services');
const createFakeDb = require('./helpers/fakeDb');

const ACCOUNT_ID = '7f1c2a3e-5b6d-4c8e-9f01-23456789abcd';
const OTHER_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NOW = '2026-10-27T10:00:00.000Z';

const account = (overrides = {}) => ({ id: ACCOUNT_ID, name: 'Alice', balance: 0, created_at: NOW, ...overrides });
const txn = (overrides = {}) => ({
  id: 'b5f0c1d2-1111-4222-8333-444455556666',
  account_id: ACCOUNT_ID,
  type: 'credit',
  amount: 100,
  description: null,
  reference_id: 'ref-1',
  balance_after: 100,
  transfer_id: null,
  created_at: NOW,
  ...overrides,
});
const ledgerError = (message, details) => ({
  data: null,
  error: { code: 'P0001', message, details: details ? JSON.stringify(details) : null },
});

let db;
let app;

beforeEach(() => {
  db = createFakeDb();
  app = createApp(createServices(db));
});

describe('accounts', () => {
  test('creates an account with zero balance', async () => {
    db.respond({ data: account(), error: null });
    const res = await request(app).post('/api/accounts').send({ name: '  Alice ' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.data, account());
    assert.deepEqual(db.calls[0].ops[0], ['insert', { name: 'Alice' }]);
  });

  test('rejects missing / empty name', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }]) {
      const res = await request(app).post('/api/accounts').send(body);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.equal(res.body.error.details[0].field, 'name');
    }
  });

  test('rejects attempts to set an initial balance', async () => {
    const res = await request(app).post('/api/accounts').send({ name: 'Alice', balance: 1000 });
    assert.equal(res.status, 400);
    assert.match(res.body.error.details[0].message, /balance/);
  });

  test('returns 404 for an unknown account', async () => {
    db.respond({ data: null, error: null });
    const res = await request(app).get(`/api/accounts/${ACCOUNT_ID}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ACCOUNT_NOT_FOUND');
  });

  test('returns 400 for a malformed account id', async () => {
    const res = await request(app).get('/api/accounts/not-a-uuid');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_ID');
  });
});

describe('transactions: create', () => {
  const body = { account_id: ACCOUNT_ID, type: 'credit', amount: 100, reference_id: 'ref-1' };

  test('creates a transaction through the atomic RPC', async () => {
    db.respond({ data: { transaction: txn(), account: account({ balance: 100 }), replayed: false }, error: null });
    const res = await request(app).post('/api/transactions').send(body);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.account.balance, 100);
    assert.equal(res.body.meta.replayed, false);
    assert.deepEqual(db.calls[0], {
      rpc: 'create_transaction',
      params: {
        p_account_id: ACCOUNT_ID,
        p_type: 'credit',
        p_amount: '100.00',
        p_reference_id: 'ref-1',
        p_description: null,
      },
    });
  });

  test('identical retry returns the original transaction with 200', async () => {
    db.respond({ data: { transaction: txn(), account: account({ balance: 100 }), replayed: true }, error: null });
    const res = await request(app).post('/api/transactions').send(body);
    assert.equal(res.status, 200);
    assert.equal(res.body.meta.replayed, true);
  });

  test('accepts numeric strings and normalizes to 2 decimals', async () => {
    db.respond({ data: { transaction: txn(), account: account(), replayed: false }, error: null });
    await request(app).post('/api/transactions').send({ ...body, amount: '10.5' });
    assert.equal(db.calls[0].params.p_amount, '10.50');
  });

  test('invalid type -> INVALID_TRANSACTION_TYPE', async () => {
    const res = await request(app).post('/api/transactions').send({ ...body, type: 'refund' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_TRANSACTION_TYPE');
  });

  test('invalid amounts -> INVALID_AMOUNT', async () => {
    for (const amount of [0, -5, '0', 'abc', 1.005, '1e3', null, 2_000_000_000]) {
      const res = await request(app).post('/api/transactions').send({ ...body, amount });
      assert.equal(res.status, 400, `amount=${amount}`);
      assert.equal(res.body.error.code, 'INVALID_AMOUNT', `amount=${amount}`);
    }
  });

  test('missing fields -> VALIDATION_ERROR listing each field', async () => {
    const res = await request(app).post('/api/transactions').send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ['account_id', 'amount', 'reference_id', 'type']);
  });

  test('blank reference_id is rejected', async () => {
    const res = await request(app).post('/api/transactions').send({ ...body, reference_id: '  ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'reference_id');
  });

  test('maps database business errors to HTTP statuses', async () => {
    const cases = [
      ['ACCOUNT_NOT_FOUND', 404],
      ['INSUFFICIENT_BALANCE', 422],
      ['DUPLICATE_TRANSACTION', 409],
    ];
    for (const [code, status] of cases) {
      db.respond(ledgerError(code, { account_id: ACCOUNT_ID }));
      const res = await request(app).post('/api/transactions').send(body);
      assert.equal(res.status, status, code);
      assert.equal(res.body.error.code, code);
      assert.deepEqual(res.body.error.details, { account_id: ACCOUNT_ID });
    }
  });

  test('unique-constraint race fallback -> 409', async () => {
    db.respond({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const res = await request(app).post('/api/transactions').send(body);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_TRANSACTION');
  });

  test('malformed JSON -> INVALID_JSON', async () => {
    const res = await request(app).post('/api/transactions').set('Content-Type', 'application/json').send('{"a":');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });

  test('missing body -> INVALID_REQUEST_BODY', async () => {
    const res = await request(app).post('/api/transactions');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_REQUEST_BODY');
  });

  test('non-JSON content type -> 415', async () => {
    const res = await request(app).post('/api/transactions').type('form').send('a=1');
    assert.equal(res.status, 415);
  });

  test('unknown database failure -> 500 without leaking internals', async (t) => {
    t.mock.method(console, 'error', () => {});
    db.respond({ data: null, error: { code: 'XX000', message: 'connection reset' } });
    const res = await request(app).post('/api/transactions').send(body);
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'Unexpected database error' } });
  });
});

describe('transactions: immutability', () => {
  for (const method of ['put', 'patch', 'delete']) {
    test(`${method.toUpperCase()} /transactions/:id -> 405`, async () => {
      const res = await request(app)[method](`/api/transactions/${txn().id}`).send({ amount: 1 });
      assert.equal(res.status, 405);
      assert.equal(res.body.error.code, 'TRANSACTION_IMMUTABLE');
      assert.equal(res.headers.allow, 'GET');
    });
  }
});

describe('transactions: list for account', () => {
  test('returns latest-first page with pagination meta', async () => {
    db.respond(
      { data: account(), error: null },
      { data: [txn({ reference_id: 'ref-3' }), txn({ reference_id: 'ref-2' })], count: 5, error: null },
    );
    const res = await request(app).get(`/api/accounts/${ACCOUNT_ID}/transactions?page=2&limit=2`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 2);
    assert.deepEqual(res.body.meta, {
      page: 2,
      limit: 2,
      total_records: 5,
      total_pages: 3,
      has_next_page: true,
      has_previous_page: true,
    });
    const ops = db.calls[1].ops;
    assert.deepEqual(ops.find((o) => o[0] === 'order'), ['order', 'created_at', { ascending: false }]);
    assert.deepEqual(ops.find((o) => o[0] === 'range'), ['range', 2, 3]);
  });

  test('defaults to page=1, limit=20', async () => {
    db.respond({ data: account(), error: null }, { data: [], count: 0, error: null });
    const res = await request(app).get(`/api/accounts/${ACCOUNT_ID}/transactions`);
    assert.equal(res.body.meta.page, 1);
    assert.equal(res.body.meta.limit, 20);
    assert.equal(res.body.meta.total_pages, 0);
  });

  test('page past the end returns an empty page, not an error', async () => {
    db.respond(
      { data: account(), error: null },
      { data: null, count: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
      { data: [], count: 3, error: null },
    );
    const res = await request(app).get(`/api/accounts/${ACCOUNT_ID}/transactions?page=9&limit=2`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
    assert.equal(res.body.meta.total_records, 3);
    assert.equal(res.body.meta.total_pages, 2);
  });

  test('invalid pagination params -> INVALID_PAGINATION', async () => {
    for (const qs of ['page=0', 'page=-1', 'page=abc', 'limit=0', 'limit=101', 'limit=2.5', 'page=1&page=2']) {
      const res = await request(app).get(`/api/accounts/${ACCOUNT_ID}/transactions?${qs}`);
      assert.equal(res.status, 400, qs);
      assert.equal(res.body.error.code, 'INVALID_PAGINATION', qs);
    }
  });

  test('unknown account -> 404', async () => {
    db.respond({ data: null, error: null });
    const res = await request(app).get(`/api/accounts/${ACCOUNT_ID}/transactions`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ACCOUNT_NOT_FOUND');
  });
});

describe('transfers', () => {
  const body = { from_account_id: ACCOUNT_ID, to_account_id: OTHER_ID, amount: 30, reference_id: 'tr-1' };

  test('creates a transfer via the atomic RPC', async () => {
    db.respond({
      data: {
        transfer: { id: 't1', from_account_id: ACCOUNT_ID, to_account_id: OTHER_ID, amount: 30, reference_id: 'tr-1', description: null, created_at: NOW },
        debit: txn({ type: 'debit', amount: 30, balance_after: 70, transfer_id: 't1' }),
        credit: txn({ account_id: OTHER_ID, amount: 30, balance_after: 80, transfer_id: 't1' }),
        from_account: account({ balance: 70 }),
        to_account: account({ id: OTHER_ID, name: 'Bob', balance: 80 }),
        replayed: false,
      },
      error: null,
    });
    const res = await request(app).post('/api/transfers').send(body);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.from_account.balance, 70);
    assert.equal(res.body.data.to_account.balance, 80);
    assert.equal(db.calls[0].rpc, 'create_transfer');
  });

  test('same source and destination -> 400', async () => {
    const res = await request(app).post('/api/transfers').send({ ...body, to_account_id: ACCOUNT_ID.toUpperCase() });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'to_account_id');
  });

  test('insufficient balance -> 422', async () => {
    db.respond(ledgerError('INSUFFICIENT_BALANCE', { account_id: ACCOUNT_ID, balance: 10, requested: 30 }));
    const res = await request(app).post('/api/transfers').send(body);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INSUFFICIENT_BALANCE');
  });
});

test('unknown route -> 404 ROUTE_NOT_FOUND', async () => {
  const res = await request(app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
});
