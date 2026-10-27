# Ledger API reference

Base URL: `http://localhost:3000/api`

- Request bodies must be JSON (`Content-Type: application/json`).
- Successful responses: `{ "data": ..., "meta"?: ... }`
- Error responses: `{ "error": { "code", "message", "details"? } }`
- IDs are UUIDs. Timestamps are ISO-8601 (UTC). Money values are JSON numbers with up to 2 decimal places.

| Method | Path                              | Description                          |
| ------ | --------------------------------- | ------------------------------------ |
| POST   | `/accounts`                       | Create an account                    |
| GET    | `/accounts`                       | List accounts (paginated)            |
| GET    | `/accounts/:id`                   | Get an account and its balance       |
| GET    | `/accounts/:id/transactions`      | Transaction history, latest first (paginated) |
| POST   | `/transactions`                   | Create a credit or debit             |
| GET    | `/transactions/:id`               | Get one transaction                  |
| POST   | `/transfers`                      | Transfer money between accounts (bonus) |
| GET    | `/transfers/:id`                  | Get a transfer and its two legs      |
| GET    | `/health` (no `/api` prefix)      | Liveness check                       |

`PUT`, `PATCH` and `DELETE` on `/transactions/:id` and `/transfers/:id` return
`405 TRANSACTION_IMMUTABLE` / `405 TRANSFER_IMMUTABLE`. Other unsupported methods return
`405 METHOD_NOT_ALLOWED`. Each 405 response includes an `Allow` header.

---

## Accounts

### `POST /accounts`

| Field  | Type   | Rules                       |
| ------ | ------ | --------------------------- |
| `name` | string | required, 1–255 chars after trimming |

No other fields are accepted. In particular, there is no initial `balance`: accounts start at 0.

```http
POST /api/accounts
{ "name": "Alice" }
```

`201 Created`

```json
{
  "data": {
    "id": "7f1c2a3e-5b6d-4c8e-9f01-23456789abcd",
    "name": "Alice",
    "balance": 0,
    "created_at": "2026-10-27T10:00:00.000+00:00"
  }
}
```

Errors: `400 VALIDATION_ERROR` (missing, empty, or non-string name, or an unknown field) · `400 INVALID_REQUEST_BODY` · `400 INVALID_JSON`

### `GET /accounts/:id`

`200 OK` returns `{ "data": <account> }`.

Errors: `400 INVALID_ID` (not a UUID) · `404 ACCOUNT_NOT_FOUND`

### `GET /accounts?page=1&limit=20`

Lists accounts, newest first. Pagination works the same as below.

### `GET /accounts/:id/transactions?page=1&limit=20`

Returns the account's transactions sorted by `created_at` descending (latest first).

| Query   | Default | Rules              |
| ------- | ------- | ------------------ |
| `page`  | 1       | integer ≥ 1        |
| `limit` | 20      | integer 1–100      |

`200 OK`

```json
{
  "data": [
    {
      "id": "c1d2…",
      "account_id": "7f1c…",
      "type": "debit",
      "amount": 20,
      "description": null,
      "reference_id": "r4",
      "balance_after": 100,
      "transfer_id": null,
      "created_at": "2026-10-27T10:00:04.000+00:00"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total_records": 4,
    "total_pages": 1,
    "has_next_page": false,
    "has_previous_page": false
  }
}
```

A page beyond `total_pages` returns `"data": []` with the same `meta`.

Errors: `400 INVALID_ID` · `400 INVALID_PAGINATION` (e.g. `page=0`, `page=abc`, `limit=101`, `limit=2.5`, or a repeated parameter) · `404 ACCOUNT_NOT_FOUND`

---

## Transactions

### `POST /transactions`

| Field          | Type            | Rules                                                     |
| -------------- | --------------- | --------------------------------------------------------- |
| `account_id`   | string (UUID)   | required; the account must exist                          |
| `type`         | string          | required; `"credit"` or `"debit"`                         |
| `amount`       | number \| string| required; > 0, at most 2 decimals, ≤ 1,000,000,000        |
| `reference_id` | string          | required; 1–255 chars; unique per account                 |
| `description`  | string \| null  | optional; ≤ 500 chars                                     |

The transaction insert and the balance update run in a single database transaction.

```http
POST /api/transactions
{
  "account_id": "7f1c2a3e-5b6d-4c8e-9f01-23456789abcd",
  "type": "credit",
  "amount": 100,
  "reference_id": "deposit-001",
  "description": "Initial deposit"
}
```

`201 Created` (new transaction) or `200 OK` (identical retry of an existing `reference_id`)

```json
{
  "data": {
    "transaction": {
      "id": "b5f0c1d2-1111-4222-8333-444455556666",
      "account_id": "7f1c2a3e-5b6d-4c8e-9f01-23456789abcd",
      "type": "credit",
      "amount": 100,
      "description": "Initial deposit",
      "reference_id": "deposit-001",
      "balance_after": 100,
      "transfer_id": null,
      "created_at": "2026-10-27T10:00:01.000+00:00"
    },
    "account": {
      "id": "7f1c2a3e-5b6d-4c8e-9f01-23456789abcd",
      "name": "Alice",
      "balance": 100,
      "created_at": "2026-10-27T10:00:00.000+00:00"
    }
  },
  "meta": { "replayed": false }
}
```

| Status | Code                       | When                                                        |
| ------ | -------------------------- | ----------------------------------------------------------- |
| 400    | `INVALID_TRANSACTION_TYPE` | `type` isn't `credit` or `debit`                            |
| 400    | `INVALID_AMOUNT`           | amount missing, ≤ 0, non-numeric, more than 2 decimals, or too large |
| 400    | `VALIDATION_ERROR`         | other or multiple field problems (`details` lists each field) |
| 400    | `INVALID_REQUEST_BODY`     | body missing or not a JSON object                           |
| 400    | `INVALID_JSON`             | malformed JSON                                              |
| 404    | `ACCOUNT_NOT_FOUND`        | `account_id` doesn't exist                                  |
| 409    | `DUPLICATE_TRANSACTION`    | `reference_id` already used on this account with a different payload |
| 415    | `UNSUPPORTED_MEDIA_TYPE`   | Content-Type isn't JSON                                     |
| 422    | `INSUFFICIENT_BALANCE`     | debit is larger than the current balance                    |

Example error:

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for this debit",
    "details": { "account_id": "7f1c…", "balance": 100, "requested": 1000 }
  }
}
```

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "account_id", "message": "account_id is required and must be a string" },
      { "field": "reference_id", "message": "reference_id is required and must be a string" }
    ]
  }
}
```

### `GET /transactions/:id`

`200 OK` returns `{ "data": <transaction> }`. Errors: `400 INVALID_ID` · `404 TRANSACTION_NOT_FOUND`

---

## Transfers (bonus)

### `POST /transfers`

| Field             | Type           | Rules                                         |
| ----------------- | -------------- | --------------------------------------------- |
| `from_account_id` | string (UUID)  | required; must exist                          |
| `to_account_id`   | string (UUID)  | required; must exist; different from source   |
| `amount`          | number \| string | same rules as transactions                  |
| `reference_id`    | string         | required; unique per source account           |
| `description`     | string \| null | optional                                      |

The debit, the credit, and the transfer record are written in one database transaction.
If any step fails, nothing is persisted.

```http
POST /api/transfers
{
  "from_account_id": "7f1c2a3e-…",
  "to_account_id": "0a1b2c3d-…",
  "amount": 30,
  "reference_id": "transfer-001"
}
```

`201 Created` (or `200 OK` on an identical retry)

```json
{
  "data": {
    "transfer": {
      "id": "e9…",
      "from_account_id": "7f1c…",
      "to_account_id": "0a1b…",
      "amount": 30,
      "description": null,
      "reference_id": "transfer-001",
      "created_at": "…"
    },
    "debit":  { "type": "debit",  "account_id": "7f1c…", "amount": 30, "balance_after": 70, "transfer_id": "e9…", "…": "…" },
    "credit": { "type": "credit", "account_id": "0a1b…", "amount": 30, "balance_after": 80, "transfer_id": "e9…", "…": "…" },
    "from_account": { "id": "7f1c…", "name": "Alice", "balance": 70, "created_at": "…" },
    "to_account":   { "id": "0a1b…", "name": "Bob",   "balance": 80, "created_at": "…" }
  },
  "meta": { "replayed": false }
}
```

Errors: `400 VALIDATION_ERROR` (including same source and destination) · `400 INVALID_AMOUNT` ·
`404 ACCOUNT_NOT_FOUND` (`details.account_id` says which account) · `409 DUPLICATE_TRANSACTION` ·
`422 INSUFFICIENT_BALANCE`

### `GET /transfers/:id`

`200 OK` returns `{ "data": { "transfer", "debit", "credit" } }`. Errors: `400 INVALID_ID` · `404 TRANSFER_NOT_FOUND`

---

## Error codes

| HTTP | Code                       | Meaning                                              |
| ---- | -------------------------- | ---------------------------------------------------- |
| 400  | `VALIDATION_ERROR`         | Request fields are invalid (see `details[]`)         |
| 400  | `INVALID_TRANSACTION_TYPE` | `type` must be `credit` or `debit`                   |
| 400  | `INVALID_AMOUNT`           | Amount isn't a positive value with at most 2 decimals |
| 400  | `INVALID_PAGINATION`       | `page` / `limit` are invalid                         |
| 400  | `INVALID_ID`               | Path id isn't a UUID                                 |
| 400  | `INVALID_REQUEST_BODY`     | Body is missing or isn't a JSON object               |
| 400  | `INVALID_JSON`             | Body isn't valid JSON                                |
| 404  | `ACCOUNT_NOT_FOUND`        | Account doesn't exist                                |
| 404  | `TRANSACTION_NOT_FOUND`    | Transaction doesn't exist                            |
| 404  | `TRANSFER_NOT_FOUND`       | Transfer doesn't exist                               |
| 404  | `ROUTE_NOT_FOUND`          | Unknown URL                                          |
| 405  | `TRANSACTION_IMMUTABLE`    | Transactions can't be updated or deleted             |
| 405  | `TRANSFER_IMMUTABLE`       | Transfers can't be updated or deleted                |
| 405  | `METHOD_NOT_ALLOWED`       | HTTP method not supported on this path               |
| 409  | `DUPLICATE_TRANSACTION`    | `reference_id` already used for this account         |
| 413  | `PAYLOAD_TOO_LARGE`        | Body larger than 10 KB                               |
| 415  | `UNSUPPORTED_MEDIA_TYPE`   | Body isn't `application/json`                        |
| 422  | `INSUFFICIENT_BALANCE`     | Debit or transfer exceeds the available balance      |
| 500  | `INTERNAL_ERROR`           | Unexpected server or database error                  |
