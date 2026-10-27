# Ledger System

A transaction ledger REST API built with **Express 5** and **Supabase (PostgreSQL)**.

Accounts hold a balance that changes only through immutable credit/debit transactions. Each
write is atomic, safe under concurrent requests, and protected against duplicate `reference_id`s.
The API also supports transfers between accounts (the bonus task).

- API reference: [docs/API.md](docs/API.md)
- Database schema and ledger functions: [supabase/migrations/20261027000000_init_ledger.sql](supabase/migrations/20261027000000_init_ledger.sql)

---

## Tech stack

| Concern    | Choice                                                               |
| ---------- | -------------------------------------------------------------------- |
| Runtime    | Node.js ≥ 20                                                        |
| HTTP       | Express 5 (async errors are forwarded to the error handler natively) |
| Database   | Supabase / PostgreSQL, accessed with `@supabase/supabase-js`       |
| Validation | Zod 4                                                                |
| Tests      | `node:test` + Supertest (HTTP layer), plain SQL (database layer)   |

## Project structure

```
src/
  server.js              # entry point: wires Supabase client -> services -> app
  app.js                 # Express app factory (services injected, so it's testable)
  config/env.js          # environment variables
  db/supabase.js         # Supabase client (service role)
  routes/                # URL -> middleware -> controller mapping (+ 405 handling)
  controllers/           # HTTP in/out: status codes and response shape
  services/              # data access: Supabase queries and RPC calls
  validators/            # Zod schemas for body / params / query
  middleware/            # validate, requireJson, errorHandler, notFound, methodNotAllowed
  errors/                # AppError + Postgres -> HTTP error mapping
  utils/                 # pagination, serializers, money helpers
supabase/
  migrations/            # schema, constraints, triggers, ledger functions
  tests/ledger.test.sql  # database-level integrity tests (rolled back)
tests/                   # API tests (no database required)
docs/API.md              # API documentation
```

---

## Running locally

### 1. Prerequisites

- Node.js 20 or newer
- A Supabase project. Either:
  - **Hosted:** a free project at [supabase.com](https://supabase.com), or
  - **Local:** the [Supabase CLI](https://supabase.com/docs/guides/cli) with Docker running

### 2. Install dependencies

```bash
npm install
```

### 3. Create the database schema

**Option A: hosted Supabase**

1. Open your project's **SQL Editor**.
2. Paste in the contents of `supabase/migrations/20261027000000_init_ledger.sql` and click **Run**.
3. Optional: paste in and run `supabase/tests/ledger.test.sql`. It should print
   `NOTICE: ledger tests passed`. Everything it does is rolled back.

Alternatively, with the CLI: `npx supabase link --project-ref <ref>`, then `npx supabase db push`.

**Option B: local Supabase (Docker)**

```bash
npx supabase init        # creates supabase/config.toml; existing migrations are kept
npx supabase start       # starts Postgres, PostgREST, etc. and applies the migrations
npx supabase status      # shows the API URL and service_role key
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

| Variable                      | Description                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `SUPABASE_URL`              | Project URL (`https://<ref>.supabase.co`, or `http://127.0.0.1:54321` for local) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (**Project Settings → API**). Server-side only.              |
| `PORT`                      | HTTP port (default `3000`)                                                         |

### 5. Start the server

```bash
npm start        # or: npm run dev   (restarts on file changes)
```

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### 6. Try it

```bash
# Create two accounts
A=$(curl -s -X POST localhost:3000/api/accounts -H 'Content-Type: application/json' \
      -d '{"name":"Alice"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')
B=$(curl -s -X POST localhost:3000/api/accounts -H 'Content-Type: application/json' \
      -d '{"name":"Bob"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')

# Spec example: +100 +50 -30 -20 = 100
for t in "credit 100 r1" "credit 50 r2" "debit 30 r3" "debit 20 r4"; do
  set -- $t
  curl -s -X POST localhost:3000/api/transactions -H 'Content-Type: application/json' \
    -d "{\"account_id\":\"$A\",\"type\":\"$1\",\"amount\":$2,\"reference_id\":\"$3\"}" > /dev/null
done
curl -s localhost:3000/api/accounts/$A                      # balance: 100

# Transfer 30 from Alice to Bob
curl -s -X POST localhost:3000/api/transfers -H 'Content-Type: application/json' \
  -d "{\"from_account_id\":\"$A\",\"to_account_id\":\"$B\",\"amount\":30,\"reference_id\":\"tr-1\"}"

# History, latest first
curl -s "localhost:3000/api/accounts/$A/transactions?page=1&limit=10"
```

### 7. Run the tests

```bash
npm test                         # API tests; no database needed
```

To run the database tests, execute `supabase/tests/ledger.test.sql` against your database
(SQL Editor, or `psql "$DATABASE_URL" -f supabase/tests/ledger.test.sql`).

---

## Design

### Why the ledger logic lives in Postgres functions

supabase-js talks to the database through PostgREST, which runs each HTTP request as its own
SQL statement. A client-side sequence like "insert transaction, then update balance" therefore
can't be atomic. All balance-changing operations are plpgsql functions called through `rpc()`:

| Function               | What it does atomically                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `create_transaction` | lock account → duplicate check → balance check → insert transaction → update balance |
| `create_transfer`    | lock both accounts → checks → insert transfer → debit source → credit destination    |

PostgREST runs each RPC call inside one database transaction. If any step raises an
exception, every change rolls back, so a partial transaction or transfer can't happen.

### Concurrency

- `SELECT … FOR UPDATE` on the account row serializes all writers for that account. Two
  simultaneous debits can't both pass the balance check, and two requests with the same
  `reference_id` can't both insert. In a test, 20 concurrent debits of 10 against a
  balance of 100 produced exactly 10 successes and a final balance of 0.
- Transfers lock both accounts **in id order**, so an A→B and a B→A transfer running at the
  same time can't deadlock.

### Data integrity enforced by the database

These rules hold even if someone bypasses the API and writes SQL directly:

| Rule                                  | Mechanism                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `type` is `credit` or `debit`   | `CHECK` constraint                                                                     |
| `amount > 0`, 2 decimal places      | `numeric(18,2)` + `CHECK (amount > 0)`                                               |
| Balance never negative                | `CHECK (balance >= 0)` on accounts and `balance_after`                               |
| Unique `reference_id` per account   | `UNIQUE (account_id, reference_id)`                                                    |
| Transaction belongs to a real account | Foreign key, `ON DELETE RESTRICT`                                                      |
| Transactions/transfers are immutable  | `BEFORE UPDATE OR DELETE` trigger raises `IMMUTABLE_RECORD`                          |
| Balance only changes via the ledger   | Trigger rejects direct `UPDATE accounts SET balance`, and new accounts must start at 0 |
| Accounts cannot be deleted            | Trigger (they're referenced by immutable history)                                        |
| No access from anon/browser keys      | RLS enabled with no policies; functions granted to `service_role` only                 |

Each transaction row also stores `balance_after`, so you can audit an account's history
row by row. The invariant `balance = Σ credits − Σ debits` is checked in `ledger.test.sql`.

### Duplicate `reference_id` handling

`reference_id` works as an **idempotency key**, scoped to the account:

- **Same `reference_id`, identical request** (same type, amount, description): returns the
  original transaction with `200 OK` and `meta.replayed: true`. Nothing is applied twice,
  so clients can safely retry after a timeout.
- **Same `reference_id`, different request:** `409 DUPLICATE_TRANSACTION`, with the existing
  transaction id in `details`.
- The same `reference_id` on **different accounts** is allowed.

Transfers follow the same rule: a transfer's `reference_id` is scoped to the source account.

### Error handling

Every error uses the same shape:

```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance for this debit", "details": { } } }
```

Validation errors are caught by Zod before reaching the database. Business-rule errors are
raised in plpgsql with a stable code (for example `RAISE EXCEPTION 'INSUFFICIENT_BALANCE'`) and
mapped to HTTP statuses in [src/errors/dbErrors.js](src/errors/dbErrors.js). Unexpected errors
return a generic `500` and are logged on the server; internal details never reach the client.
The full list of codes is in [docs/API.md](docs/API.md#error-codes).

---

## Assumptions

1. **Accounts always start with a balance of 0.** The spec says the balance must always equal
   the result of all transactions, so an "initial balance" field would break that rule. To
   fund an account, post a `credit`. A request with a `balance` field gets `400`.
2. **Money** uses `numeric(18,2)`: at most 2 decimal places, single currency. Amounts with
   more decimals (e.g. `1.005`) are rejected, not rounded. The maximum single amount is
   1,000,000,000. Amounts are accepted as JSON numbers or numeric strings and returned as
   JSON numbers.
3. **Duplicate `reference_id`:** an identical retry is treated as a replay (200) and a
   conflicting reuse as an error (409). See above.
4. **Status codes:** malformed IDs return `400`. Well-formed IDs that don't exist return `404`,
   including `account_id` in a request body. Insufficient balance is `422` (the request is
   valid, but business rules reject it). Duplicates are `409`. `PUT`/`PATCH`/`DELETE` on
   transactions return `405`.
5. **Pagination:** `page` defaults to 1 and `limit` to 20, with a maximum `limit` of 100.
   Values that aren't positive integers, or a `limit` over 100, return `400 INVALID_PAGINATION`.
   A page past the end returns an empty `data` array with correct metadata, not an error.
6. **Ordering:** "latest first" means `created_at DESC`, with `id DESC` as a tie-breaker so
   pages stay stable. `created_at` uses `clock_timestamp()`, so rows written in the same
   database transaction still get distinct timestamps.
7. A transfer creates one `transfers` row plus two linked `transactions` rows (a debit on the
   source, a credit on the destination) that share its `reference_id` and `transfer_id`. Both
   appear in the accounts' transaction histories.
8. **No authentication.** The assessment doesn't mention auth, so the API is open. In
   production it would sit behind auth, and account access would be scoped to the caller.
9. **Accounts can't be deleted or renamed through the API.** Deleting would orphan immutable
   history, and renaming wasn't required.
