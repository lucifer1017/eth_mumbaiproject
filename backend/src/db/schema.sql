-- Daemon API v1 — PostgreSQL schema
-- Run via `npm run db:migrate` (src/db/migrate.ts)

CREATE TABLE IF NOT EXISTS users (
  user_id      TEXT PRIMARY KEY,
  user_address TEXT UNIQUE NOT NULL,
  handle       TEXT UNIQUE,
  roles        TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  user_address TEXT PRIMARY KEY,
  nonce        TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);

-- Drop tables from the pre-v2 schema that are no longer used.
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS plans CASCADE;

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

-- Platform's cut of one_time_price_amount for one_time/both agents (smallest
-- units in USDC decimal terms, e.g. 0.05). The executor pays the agent's own
-- x402 /v1/invoke demand out of this cut; the remainder goes to the creator.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_invoke_fee NUMERIC(18,6);

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

-- DCA runs: the output token + amount the subscriber actually received from
-- the swap (in addition to the USDC `amount` spent).
ALTER TABLE runs ADD COLUMN IF NOT EXISTS output_token_address TEXT;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS output_amount NUMERIC(36,18);

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

CREATE TABLE IF NOT EXISTS system_constants (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
