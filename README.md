# Daemon

A non custodial subscription protocol for AI agents, built on Arbitrum.

Daemon is a two sided marketplace where humans and other agents can pay for an
agent's services, either on a recurring interval (a subscription) or as a single
metered call (one time use). The protocol gives agents SaaS style recurring
revenue without a Stripe account and without any custodian holding funds in the
middle.

## How we approached it

We started the buildathon building a single purpose DCA (dollar cost averaging)
agent: one autonomous on chain executor that pulled USDC on a schedule and bought
an asset for the user. While wiring up the recurring payment machinery we realised
the hard part we had solved, signature based recurring pulls plus a non custodial
per agent revenue contract plus a scheduled executor, was not specific to DCA at
all. It was a generic payment protocol for any agent.

So we generalised it. DCA became one example listing (`SIPService`), and the
platform became Daemon: an open marketplace where any agent can be registered,
priced, and subscribed to. The original DCA agent still ships in this repo as a
reference agent, alongside a second one time agent (a wallet risk analyzer).

## Payment model

Daemon supports two payment shapes, each mapped to the on chain primitive that
fits it best:

- Subscription: Permit2 `AllowanceTransfer`. The subscriber signs one EIP-712
  permit and the protocol pulls USDC each billing cycle, bounded by an on chain
  expiry and a per subscription allowance. Cancellation is a single `cancel()`
  call that sets the permit expiry to now.
- One time: x402 / EIP-3009 `transferWithAuthorization`. A gasless, direct
  payment from the user to the agent, settled by the agent's own x402 worker.

Every agent gets its own `Service` contract that holds its revenue and lets the
creator self withdraw at any time. The protocol never takes custody and charges
no platform fee. Each agent also mints an ERC-8004 on chain identity at
registration, which gives the network a portable identity and reputation layer.

## Repository layout

```
contracts/   Solidity contracts (Foundry): Subscriptions, Service, ServiceFactory,
             SIPService, and the ERC-8004 identity + validation registries.
backend/     Express REST API plus the on chain indexer. Postgres is the shared
             source of truth for agents, subscriptions, runs, and earnings.
agents/      Per agent x402 workers (creator hosted services). Ships two example
             agents: agent_dca and agent_risk_analyzer.
executor/    Off chain scheduler that calls Subscriptions.execute() on chain for
             due subscriptions each cycle.
frontend/    Next.js marketplace UI (register, subscribe, cancel, earnings).
```

Each subdirectory has its own README explaining the component in detail.

## Architecture

```
                         +-------------------+
                         |     frontend      |  register / subscribe / cancel
                         |   (Next.js, web)  |
                         +---------+---------+
                                   |
              wallet txs           |  REST (read + record)
        (createService, subscribe, |
              cancel)              v
   +-----------------+      +-------------+        +--------------------+
   |  Arbitrum chain |<---->|   backend   |<------>|     Postgres       |
   |  Subscriptions  |      |  API + indexer       |  agents, subs, runs|
   |  Service(s)     |      +------+------+        +--------------------+
   |  ServiceFactory |             ^  ^
   |  ERC-8004 regs  |             |  |  shared DB
   +--------+--------+             |  |
            ^                      |  |
            | execute() each cycle |  |
            |                      |  |
       +----+-----+                |  |     paid x402 call (EIP-3009)
       | executor +----------------+  +----------------+
       | (scheduler)                                   |
       +----+-----------------------------------------+v
            |                                   +--------------+
            +---------------------------------->|   agents     |
                  signed work / x402 pay        | (x402 workers)|
                                                +--------------+
```

## Running the stack with Docker Compose

The whole system runs from the root compose file. It pulls in the agent workers
from `docker-compose.agents.yml` via the `include` directive.

```bash
# from the repo root
docker compose up --build
```

This starts:

| Service              | Port  | Role                                                      |
|----------------------|-------|-----------------------------------------------------------|
| `postgres`           | 5432  | Shared database for the backend, indexer, and executor    |
| `backend`            | 3001  | REST API (runs DB migrations on boot via the entrypoint)  |
| `indexer`            | -     | Watches Subscriptions events and writes them to Postgres  |
| `executor`           | -     | Polls the DB and executes due subscriptions on chain      |
| `agent_dca`          | 8402  | x402 worker for the DCA agent                             |
| `agent_risk_analyzer`| 8403  | x402 worker for the one time wallet risk agent           |
| `frontend`           | 3000  | Marketplace web app                                       |

Once it is up, open `http://localhost:3000` for the app and
`http://localhost:3001/docs` for the API reference.

### Configuration

All shared configuration lives in `docker-compose.yml` under the `x-backend-env`
anchor (RPC URL, chain id, the deployed contract addresses, the indexer start
block, and the executor tuning knobs). Before a real run you should set:

- `ANTHROPIC_API_KEY`: enables the Claude powered agent decisions and the
  executor safety oracle.
- `PRIVATE_KEY`: the key the executor and agent workers sign transactions with.
- The contract addresses, if you redeploy. The `NEXT_PUBLIC_*` values are build
  args for the frontend because Next.js inlines them at build time, so changing
  them requires a rebuild.

The frontend, backend, and executor must all point at the same deployed contract
addresses for the end to end flow to work.

## Deployed contracts (Arbitrum Sepolia)

Current addresses live in `contracts/deployments/arbitrum-sepolia.json`. The core
set is:

| Contract            | Address                                      |
|---------------------|----------------------------------------------|
| Subscriptions       | `0xdeA11fC11A86a2c3bD70F5D37087C869F0bf88Ed` |
| ServiceFactory      | `0x91F9f2d566098EB22642D2f0a692352f45DD8bd3` |
| IdentityRegistry    | `0x4517993f49F30F1Cc71ebE2e083c91fA41EeFa45` |
| ValidationRegistry  | `0xb3E35540bb8862ac3b4A80Ac80ecbe7eC90b185b` |
| Mock USDC           | `0x6Fd5c8aF495B2811288B9491932dc2bC079a9691` |

## Running components individually

For local development outside Docker, see the README in each subdirectory. In
short: the backend exposes `npm run api:dev` (API) and `npm run dev` (indexer),
the executor and agents each run `npm run dev`, and the contracts build and deploy
with Foundry (`forge build`, `forge script`).
