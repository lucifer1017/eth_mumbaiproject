# executor

The off chain scheduler that drives recurring subscriptions. It is the heartbeat
of Daemon: on a fixed interval it finds subscriptions that are due and triggers
their on chain execution, then has the agent do the cycle's work.

## Why this matters

A subscription is only useful if something pulls the payment and runs the work
each cycle, on time, without the subscriber lifting a finger. The chain cannot
schedule itself, so the executor is the piece that turns a one time permit
signature into ongoing, automated billing. It is deliberately a thin, replaceable
crank: it holds no funds and grants itself no special power. The `Subscriptions`
contract still enforces the interval, the permit expiry, and the allowance, so
the worst a misbehaving executor can do is call `execute()` at the wrong time and
get reverted.

## What a tick does

The scheduler (`src/scheduler/scheduler.ts`) ticks every `SCHEDULER_INTERVAL_SECS`.
Each tick it queries the shared database for active subscriptions and, for each
one, the executor (`src/executor/executor.ts`):

1. Reads the subscription from `Subscriptions` and checks it exists.
2. Checks timing and expiry: skips if the permit has expired or the next cycle is
   not yet due (the interval the agent chose is enforced on chain).
3. Applies the operator guards: a minimum trust score and a maximum gas price.
4. Optionally runs the Claude safety oracle as a sanity check on the action.
5. Pays the agent through the x402 client and calls `Subscriptions.execute()` to
   pull the cycle's USDC into the agent's `Service`.

Failures are isolated with `Promise.allSettled`, so one bad subscription never
blocks the others.

## Structure

```
src/
  scheduler/   The interval loop that finds due subscriptions
  executor/    Per subscription execution logic and on chain calls
  agent/       Claude safety oracle (claude.ts)
  x402/        x402 client used to pay the agent worker
  chain/       viem client setup
  contracts/   ABIs (Subscriptions, ValidationRegistry)
  db/          Postgres pool (reads the shared DB)
  prices/      Price helpers
  config.ts    Env backed config
  index.ts     Wires clients, executor, and scheduler together
```

## Configuration

The executor reads the same shared backend env plus a few tuning knobs (set on
the `executor` service in `docker-compose.yml`):

| Variable                 | Meaning                                                  |
|--------------------------|----------------------------------------------------------|
| `AGENT_ID`               | The on chain agent id this executor instance services    |
| `SCHEDULER_INTERVAL_SECS`| How often to tick                                        |
| `MIN_TRUST_SCORE`        | Skip agents below this ERC-8004 score                    |
| `MAX_GAS_GWEI`           | Gas ceiling above which execution is deferred            |
| `MOCK_X402_ENABLED`      | Use the mock x402 facilitator for local testing          |
| `X402_PRICE_URL` / `X402_ROUTING_URL` | The agent worker endpoints to price and route payments |

It also needs the database URL, the RPC URL, the chain id, the deployed contract
addresses, the signing private key, and optionally the Anthropic key for the
safety oracle.

## Running

```bash
npm install
npm run dev        # watch mode
npm run start      # one shot
npm run typecheck
```

Or as part of the root compose stack:

```bash
docker compose up --build executor
```

The executor depends on Postgres, the backend, and the agent worker being up,
which is why it is ordered after them in the compose file.
