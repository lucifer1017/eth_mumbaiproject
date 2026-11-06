# Backend Changes: Agent Marketplace (Daemon)

Handoff spec for aligning the backend with the Daemon marketplace architecture.
Product context: `../PRD.md`. Contract changes: `../contracts/CONTRACT_CHANGES.md`.
This pass focuses on the **database schema, the indexer, and the backend architecture**.
The detailed per-endpoint request/response contract lives in `../frontend/API_SPEC.md`
and is updated separately.

No em dashes anywhere in this repo's docs, please.

The backend is the orchestration, indexing, and BFF layer. It is **non-custodial**: it never
holds user funds. It reads chain state, mirrors it into Postgres, serves the frontend, and
drives recurring execution. Stack today: Express + raw `pg` (no ORM) + viem + `ulid` + pino,
under `src/{api/routes, chain, contracts/abis, indexer, db, prices, utils}`.

---

## 1. Current state and the gap

- Schema (`src/db/schema.sql`): `users`, `auth_nonces`, `agents`, `plans`, `subscriptions`,
  `invoices`, `payouts`. `agents` already has `param_schema` + `payment_frequency`;
  `subscriptions` has `onchain_sub_id` + `param_values`.
- Indexer (`src/indexer/indexer.ts`): watches the old `SubscriptionCreated` (no `params`) and
  `SubscriptionCancelled` only.
- **Bug to fix:** the indexer resolves an agent with
  `SELECT agent_id FROM agents WHERE $1 = ANY(services)` where `$1` is the on-chain Service
  address, but `services` is the array of display name chips ("uptime-checks"), not addresses.
  There is no `service_address` column, so this never matches. The schema below adds
  `service_address` and the indexer must match on it.
- The contracts changed (see CONTRACT_CHANGES): events now carry `params`, plus new
  ERC-8004 identity, scoring, `ServiceCreated` (with `agentId`), and `Withdrawn` events. The
  indexer ABIs and event signatures must be updated to the redeployed contracts.

---

## 2. Target database schema

Write these as migrations. Every `CREATE TABLE` and `CREATE INDEX` uses `IF NOT EXISTS`, and
every seed or backfill insert must be idempotent (`INSERT ... ON CONFLICT ... DO NOTHING`, or
an upsert with `ON CONFLICT ... DO UPDATE`), so the migration and a restarting indexer are
safe to re-run. One agent has exactly one subscription price and one interval (no tiers), so
`plans` folds into `agents`. There is no platform fee and no scheduled payout, so `payouts` is
gone and every payment is recorded in a single `runs` ledger (which also replaces `invoices`).

### Drop
`plans`, `payouts`, `invoices`.

### `agents` (folds in price + interval, adds on-chain identity and scoring)
```sql
CREATE TABLE IF NOT EXISTS agents (
  agent_id              TEXT PRIMARY KEY,            -- ulid
  slug                  TEXT UNIQUE NOT NULL,
  publisher_user_id     TEXT REFERENCES users(user_id),
  publisher_name        TEXT,
  name                  TEXT NOT NULL,
  icon                  TEXT,
  logo                  TEXT,
  category              TEXT NOT NULL,
  tagline               TEXT,
  short_description     TEXT,
  description           TEXT,
  services              TEXT[] NOT NULL DEFAULT '{}',   -- display chips, not addresses
  mode                  TEXT NOT NULL DEFAULT 'subscription', -- subscription | one_time | both
  sub_price_amount      NUMERIC(18,6),                 -- subscription price per cycle
  sub_price_currency    TEXT NOT NULL DEFAULT 'USDC',
  interval_seconds      INT,                           -- on-chain interval; null for one_time-only
  payment_frequency     TEXT,                          -- display label (weekly/monthly)
  one_time_price_amount NUMERIC(18,6),                 -- x402 price; null unless one_time/both
  param_schema          JSONB NOT NULL DEFAULT '[]',   -- field definitions subscribers must supply
  service_address       TEXT,                          -- Service contract; null for one_time-only
  onchain_agent_id      NUMERIC,                       -- ERC-8004 agentId (uint256)
  agent_card_uri        TEXT,                          -- AgentCard JSON URL (token URI)
  endpoint_url          TEXT,                          -- creator-hosted agent endpoint
  trust_score           INT NOT NULL DEFAULT 0,        -- cached from ValidationRegistry (0..100)
  rating                NUMERIC(3,2) NOT NULL DEFAULT 0, -- subscriber reviews (future, keep)
  rating_count          INT NOT NULL DEFAULT 0,
  base_subscriber_count INT NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'live',
  onchain               BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agents_service       ON agents(service_address);
CREATE INDEX IF NOT EXISTS idx_agents_onchain_agent ON agents(onchain_agent_id);
```
Dropped from the old `agents`: `pricing_model`, `usage_label` (folded / unused).

### `subscriptions` (drop the plan link, store raw params bytes)
```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,               -- ulid (internal)
  user_id             TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id            TEXT NOT NULL REFERENCES agents(agent_id),
  service_address     TEXT,
  status              TEXT NOT NULL DEFAULT 'active', -- active | cancelled | expired
  onchain_sub_id      TEXT,                           -- bytes32 id from the chain
  amount_per_cycle    NUMERIC(18,6),
  interval_seconds    INT,
  params              BYTEA,                          -- raw subscriber params from the event
  usage_count         INT NOT NULL DEFAULT 0,
  last_payment_amount NUMERIC(18,6),
  last_payment_time   TIMESTAMPTZ,
  next_payment_amount NUMERIC(18,6),
  next_payment_time   TIMESTAMPTZ,
  tx_hash             TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at        TIMESTAMPTZ,
  UNIQUE (user_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
```
`param_values JSONB` is replaced by `params BYTEA`. The bytes are stored verbatim and relayed
to the agent endpoint, which decodes them against the agent's `param_schema`. The backend
does not interpret them.

### `runs` (new): the single money + status ledger
Every subscription cycle and every one-time run is one row here. It powers subscriber
spendings, creator earnings, and the activity/status feed.
```sql
CREATE TABLE IF NOT EXISTS runs (
  run_id          TEXT PRIMARY KEY,                  -- ulid
  agent_id        TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL, -- null for one_time
  kind            TEXT NOT NULL,                     -- subscription | one_time
  amount          NUMERIC(18,6) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USDC',
  status_message  TEXT,                              -- e.g. "mail sent", "DCA bought"
  link            TEXT,                              -- optional result link / tx
  success         BOOLEAN NOT NULL DEFAULT true,
  tx_hash         TEXT,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_runs_user         ON runs(user_id);
CREATE INDEX IF NOT EXISTS idx_runs_agent        ON runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_runs_subscription ON runs(subscription_id);
```

### `withdrawals` (new): creator self-withdrawals
```sql
CREATE TABLE IF NOT EXISTS withdrawals (
  withdrawal_id   TEXT PRIMARY KEY,                  -- ulid
  agent_id        TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
  service_address TEXT NOT NULL,
  amount          NUMERIC(18,6) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'USDC',
  tx_hash         TEXT,
  withdrawn_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_agent ON withdrawals(agent_id);
```

`users` and `auth_nonces` are unchanged.

---

## 3. Indexer changes

Use the event signatures from the redeployed contracts in `src/`. topic0 is derived from the
exact signature, so it must match the deployed event precisely. Add ABIs under
`src/contracts/abis/` for ServiceFactory, Service, and IdentityRegistry alongside the
existing Subscriptions and ValidationRegistry.

Events to index and the writes they drive:

- **Subscriptions `SubscriptionCreated(id, subscriber, service, spendToken, amountPerCycle, interval, permitExpiry, params)`**
  Upsert the subscription: resolve the agent by `service_address = service` (the fix), store
  `onchain_sub_id`, `amount_per_cycle`, `interval_seconds`, `params` (the raw bytes), set
  `status = 'active'`, `next_payment_time = now + interval`, and `tx_hash`.
- **Subscriptions `SubscriptionCancelled(id)`**: set `status = 'cancelled'`, `cancelled_at`.
- **Subscriptions `Executed(id, subscriber, service, amount, executedAt, params)`**: reconcile
  payment. Update the subscription `last_payment_*` and `next_payment_*`. Ensure a `runs` row
  exists for this cycle (see section 4: the scheduler is the primary writer of the run with
  its status; the indexer is the backstop that guarantees a row for every on-chain execution).
- **ServiceFactory `ServiceCreated(agent, service, spendToken, amount, feeReceiver, agentId)`**:
  backstop for registration. Fill `agents.service_address` and `agents.onchain_agent_id` if a
  matching agent exists (primary source is the register API in section 4); otherwise log.
- **Service `Withdrawn(token, to, amount)`**: insert a `withdrawals` row, mapping the emitting
  Service address to its agent.
- **ValidationRegistry `ScoreUpdated(agentId, validator, score)`**: update `agents.trust_score`
  where `onchain_agent_id = agentId`.

Multi-contract scanning: the indexer currently filters logs by the single Subscriptions
address. It now needs Subscriptions, ServiceFactory, and ValidationRegistry (fixed addresses),
plus `Withdrawn` from the set of Service addresses. For `Withdrawn`, query by the event filtered
to the known `service_address` set (read from `agents`), since Service contracts are many and
created over time. Keep the chunked `getLogs` + `withRetry` + `lastBlock` cursor pattern.

---

## 4. Backend architecture

### Agent registration
The frontend deploys the Service via `ServiceFactory.createService(...)`, reads `service` and
`agentId` from `ServiceCreated`, then calls `POST /creator/agents/register` with the metadata
plus `service_address`, `onchain_agent_id`, `agent_card_uri`, `endpoint_url`, `mode`, prices,
`interval_seconds` / `payment_frequency`, and `param_schema`. The backend stores the agent.
The indexer's `ServiceCreated` handler is a backstop in case the POST is missed. A
one-time-only agent calls `POST /creator/agents/register` with `mode = 'one_time'`, no
`service_address`, an `onchain_agent_id` (from `registerAgent`), an `endpoint_url`, and a
`one_time_price_amount`.

### AgentCard hosting
Serve `GET /agents/{onchain_agent_id}/card.json` (the `agent_card_uri` target) returning the
AgentCard JSON: `agentId`, name, description, `capabilities`, `serviceEndpoints` (the
`endpoint_url`), `x402PaymentAddress` (the agent payout wallet), and `service_address` when
present.

### Scheduler / executor
A loop (replacing the old DCA executor) that:
1. Finds due subscriptions: `status = 'active' AND next_payment_time <= now()`.
2. Calls `Subscriptions.execute(onchain_sub_id, execParams)` signed by the executor EOA.
   `execParams` is empty (`0x`) for generic agents (the base `Service.execute` just records
   payment). For a DCA-style agent like `SIPService`, `execParams` is the swap calldata the
   agent computes. The subscriber's stored `params` are not used here; they go to the endpoint.
3. After the tx confirms, POSTs a **signed work request** to `agents.endpoint_url`:
   ```json
   { "subscriber": "0x..", "params": "0x..(hex of the stored bytes)",
     "subscription_id": "0x..(onchain_sub_id)", "tx_hash": "0x..", "signature": "0x.." }
   ```
   The signature is an ECDSA signature by a platform signing key over the canonical request
   body; creators verify it against the platform public key (published in docs / the AgentCard
   issuer field). The endpoint does the work and returns `{ status_message, link, success }`.
4. Writes a `runs` row (kind `subscription`, the cycle amount, the returned status, `tx_hash`)
   and updates the subscription `last_payment_*` / `next_payment_*`.

Use the existing `withRetry` for both the chain call and the endpoint call. The executor EOA
key and the platform signing key come from config (section 6); never commit them.

### One-time runs
The one-time x402 flow is direct (browser to the creator endpoint), so the backend is not in
the payment path. The frontend POSTs the completed run to `POST /runs` (or
`POST /agents/{agent_id}/runs`) with `{ subscriber, amount, status_message, link, tx_hash,
success }`; the backend inserts a `runs` row with kind `one_time`. The backend also lists
one-time-capable agents for discovery.

### Scoring
Centralized for the POC. An operator script or admin endpoint calls
`ValidationRegistry.setScore(agentId, score)`; the indexer reflects it into
`agents.trust_score`. The API only reads `trust_score` for display. It gates nothing.

### Earnings and spendings (from the ledger + chain)
- Subscriber spendings: rows in `runs` where `user_id = the user`, grouped by agent and time.
- Creator earnings (gross, there is no fee): sum of `runs.amount` for the creator's agents,
  minus `withdrawals`, plus the live withdrawable balance read on-chain via
  `USDC.balanceOf(service_address)` (viem). Lifetime earned can also be cross-checked against
  `Service.totalEarned()`.

### Auth
Keep the existing wallet nonce / sign / verify flow (`src/api/routes/auth.ts`). Unchanged.

---

## 5. API alignment (detail in API_SPEC.md)

- **Agent serialization**: add `service_address`, `onchain_agent_id`, `trust_score`, `mode`,
  `sub_price`, `one_time_price`, `interval_seconds` / `payment_frequency`. Remove `plans[]`
  (folded). Do not expose `endpoint_url` publicly unless intended.
- **`POST /creator/agents/register`**: accept the on-chain fields above plus `endpoint_url`,
  `agent_card_uri`, `mode`, prices, interval, `param_schema`.
- **`POST /subscriptions`**: accept `onchain_sub_id` and `tx_hash`; `params` arrive via the
  indexer from the event, not the API.
- **New**: `POST /runs` (one-time result), run/activity reads for the portfolio and the
  creator console, and a creator earnings endpoint computed as in section 4.
- **Removed**: the `/user/invoices` endpoints (replaced by `runs`).
- Update `../frontend/API_SPEC.md` to match.

---

## 6. Config / env

Add to `.env` (and `.env.example`): the Arbitrum RPC URL and start block; addresses for
`Subscriptions`, `ServiceFactory`, `IdentityRegistry`, `ValidationRegistry`, and `USDC`; the
executor EOA key (scheduler `execute` signer); and the platform signing key (work-request
signer). Keys come from a secrets store, never from committed files.

---

## 7. Scope and build

- Deliver the migration, the indexer updates (events + the service-address fix + new tables),
  the scheduler with signed work requests, AgentCard hosting, the scoring reflection, and the
  earnings/spendings reads. Update the API serializers and routes to the new schema.
- Tests are out of scope for this pass; ensure the service builds and `npm run db:migrate`
  applies cleanly. The detailed endpoint I/O contract is API_SPEC.md.
