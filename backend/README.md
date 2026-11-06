# backend

The off chain brain of Daemon. It serves the REST API the frontend talks to and
runs the indexer that keeps the database in sync with chain state. PostgreSQL is
the shared source of truth that the API, the indexer, and the executor all read
from and write to.

## Why this matters

The contracts hold the money, but the chain is a poor place to query "show me all
agents in the finance category, sorted by rating" or "what did this subscriber
spend last month." The backend turns raw chain events into the marketplace:
discovery, agent metadata, subscriber portfolios, creator earnings, and a clean
API surface. The indexer is what guarantees that what the UI shows always
reflects what actually happened on chain.

## Two processes, one codebase

The backend ships as two long running processes that share the same source and
the same database:

- API server (`npm run api:start`, entry `src/api/server.ts`): the Express REST
  API on port 3001.
- Indexer (`npm run start`, entry `src/index.ts`): watches `Subscriptions`
  events and writes them into Postgres.

In Docker these are the `backend` and `indexer` services.

## API surface

Routes live in `src/api/routes/`:

| Route file          | Responsibility                                                   |
|---------------------|------------------------------------------------------------------|
| `auth.ts`           | Wallet nonce and signature verification                          |
| `marketplace.ts`    | Public agent discovery, listing and detail                       |
| `subscriptions.ts`  | Recording subscriptions and cancellations against on chain ids   |
| `user.ts`           | Subscriber scoped reads: subscriptions, runs, spendings          |
| `creator.ts`        | Agent registration and updates, subscribers, and earnings        |

Every response uses a single envelope (`{ success, data: { code, message, details } }`)
and the schema is published as Swagger at `/docs`. The serializers in
`src/api/serializers.ts` keep the wire format (snake_case) in one place.

## Indexer

`src/indexer/indexer.ts` polls the chain in block ranges from a configured start
block and translates Daemon events into database rows: new services and agent
identities, new subscriptions (including the encoded subscriber params), executed
cycles (which become run and payment records), cancellations, and withdrawals.
All writes are idempotent, so replaying a block range never duplicates data.

## Layout

```
src/
  api/         Express app, routes, serializers, swagger, server entry
  indexer/     Event indexer (chain to Postgres)
  chain/       viem client setup
  contracts/   ABIs the backend reads against
  db/          Postgres pool, schema.sql, migrate, seed
  prices/      Price feed helper (coincap)
  x402/        x402 client helpers
  config.ts    Env backed config
  index.ts     Indexer entry
```

## Database

The schema is in `src/db/schema.sql` and is applied by `src/db/migrate.ts`. Every
table and index uses `CREATE ... IF NOT EXISTS`, so migration is safe to run on
every boot. The Docker entrypoint waits for Postgres, runs the migration, then
starts the API. The main tables are `agents`, `subscriptions`, `runs` (the money
and status ledger), `withdrawals`, and `users`.

## Running locally

```bash
npm install
npm run db:migrate          # apply schema
npm run api:dev             # API with watch reload (port 3001)
npm run dev                 # indexer with watch reload (separate terminal)
npm run db:seed             # optional sample data
npm run typecheck
```

Configuration comes from environment variables (database URL, RPC URL, chain id,
the deployed contract addresses, the indexer start block and poll interval, and
the Anthropic key). In Docker these are set on the `backend` and `indexer`
services from the shared `x-backend-env` anchor in `docker-compose.yml`.
