# Product Requirements Document: Daemon, an Agent Subscription Marketplace

**Version:** 3.0
**Date:** 2026-06-14
**Status:** Draft
**Target Network:** Arbitrum

---

## 1. Overview

Daemon is a non-custodial marketplace where anyone can list an autonomous AI agent and anyone can pay it for work. Creators publish agents that do useful recurring or on-demand tasks (monitoring, alerting, dollar-cost averaging, research, reporting), and subscribers pay them in USDC on Arbitrum.

There are two ways to pay, each matched to a different payment primitive:

| Mode | Primitive | Shape |
|---|---|---|
| **Subscription** | Permit2 standing allowance (`Subscriptions.sol` + `Service.sol`) | One signature authorizes recurring USDC pulls, a fixed amount per interval, bounded by a duration, revocable in one transaction |
| **One-time** | x402 / EIP-3009 `transferWithAuthorization` | A single gasless USDC payment straight to the agent, no commitment, no custom contract |

Money moves directly between subscriber and agent. Daemon never custodies funds, charges no platform fee, and listing an agent is free. Agents are services the creator hosts; Daemon orchestrates payment and scheduling but never runs a creator's code.

The original product was a single DCA executor agent. That use case still exists as one example listing (`SIPService.sol`), but the platform is now generic: any agent that exposes an HTTP endpoint can be listed.

---

## 2. Problem Statement

Software agents are increasingly doing real work on a schedule, and as they do, they need a way to earn for the work they perform and to pay for the work they consume. The payment rails we have were built for people and companies, not for autonomous software:

1. **Agents cannot use traditional billing.** A recurring-billing stack assumes a human or a registered business with a bank account, a card on file, and an identity check. An agent is a wallet and some code. It cannot open a Stripe account.
2. **On-chain payments were not recurring or bounded.** Stablecoins let an agent be paid and pay, but until now making those payments recurring required either handing over a key or trusting an operator to hold a balance.
3. **No native way to compose paid services.** An agent that needs a sub-service (data, summarization, routing) had no simple, trustless way to subscribe to another agent and pay for it autonomously.

Daemon closes these gaps with two on-chain payment primitives and a marketplace around them, so both humans and agents can pay agents directly, with the rules enforced by code.

---

## 3. Goals

- Let a creator list an agent for subscriptions and/or one-time use in minutes, for free, with no platform fee.
- Let a subscriber, human or agent, subscribe to an agent (recurring) or run it once (pay-per-use) in a few clicks.
- Keep everything non-custodial: funds move directly between subscriber and agent, and a subscription pulls only the approved amount within the approved duration.
- Make subscriptions revocable by the subscriber in a single transaction.
- Keep the agent runtime generic: any HTTP-hosted agent can be listed; Daemon orchestrates without running the creator's code.
- Give subscribers a portfolio view of what they pay and the status of each run, and give creators a view of subscribers and earnings.

## 3.1 Non-Goals (v1 / POC)

- Custodial fund management of any kind.
- A platform fee or scheduled payouts. Listing is free and agents self-withdraw.
- Multi-tier pricing per agent (one agent has one subscription price and interval in v1).
- Multi-chain execution. Arbitrum only.
- On-chain escrow or trustless delivery guarantees for one-time runs (trust plus reputation for the POC).
- On-chain agent identity and reputation (ERC-8004). Deferred and tracked off-chain for now.
- Fiat on-ramp or off-ramp, mobile app, governance token.

---

## 4. User Personas

### 4.1 Agent Creator
- Builds an agent that does recurring or on-demand work and hosts it as an HTTP service.
- Wants to earn in USDC without a Stripe account, a bank, or a payout schedule.
- Registers the agent, sets a price and interval (and/or a one-time price), and declares the inputs the agent needs from each subscriber.
- Wants to see who subscribed and withdraw earnings whenever they want.

### 4.2 Subscriber (human)
- Wants to put an agent to work, either on a recurring schedule or for a single run.
- Wants fine-grained, revocable control: a fixed amount per cycle, a duration they choose, cancel anytime.
- Wants to see active subscriptions, what they pay, and the status of each run in one place.

### 4.3 Subscriber (agent)
- An agent that needs a capability another agent provides (data, summarization, routing).
- Subscribes to or pays the other agent autonomously from its own wallet, with no human in the loop.
- Is both a provider that earns and a consumer that pays, composing capabilities the way software composes libraries.

---

## 5. Architecture Overview

Agents run as services the creator hosts. The frontend is where participants act, the backend orchestrates without holding funds, and the Arbitrum contracts handle subscription authorization and settlement.

```
                    Agent Creator          Subscriber (human or agent)
                          │                          │
                          ▼                          ▼
        ┌──────────────────────────────────────────────────────────┐
        │                    Frontend (Next.js)                     │
        │   Marketplace · Agent detail · Portfolio · Creator console │
        └───────────────┬───────────────────────────┬──────────────┘
                        │ REST (BFF)                 │ wallet txns
                        ▼                            ▼
   ┌─────────────────────────────────┐   ┌──────────────────────────┐
   │   Backend (Node, no custody)    │   │        Arbitrum          │
   │  API / BFF                      │   │  Subscriptions.sol       │
   │  Agent registry (DB)            │◀─▶│  ServiceFactory.sol      │
   │  Scheduler / executor           │   │  Service.sol (per agent) │
   │  Indexer                        │   │  USDC · Permit2          │
   │  Auth (wallet nonce/sign)       │   │  (no fee, no one-time    │
   └──────────┬──────────────────────┘   │   contract)              │
              │ signed work request      └──────────────────────────┘
              ▼
   ┌──────────────────────────────────────────┐
   │       Creator-hosted agent endpoints       │
   │   the actual work, off-chain (HTTP)        │
   └──────────────────────────────────────────┘

One-time path bypasses our backend: the subscriber's browser is the x402
client and calls the creator's endpoint directly; the creator settles the
EIP-3009 payment and funds go straight to the agent.
```

---

## 6. Smart Contracts

All contracts deploy to **Arbitrum**. Foundry for development and testing. The subscription path is on-chain; the one-time path uses no custom contract.

### 6.1 Subscriptions.sol

The permission and settlement layer for subscriptions. It stores each subscription, enforces timing and expiry, and pulls USDC via Permit2 each cycle. Execution is gated by a simple executor allowlist (the platform's scheduler). There is no on-chain trust scoring in this version.

#### Subscription Data Model

```
Subscription {
  id:                    bytes32   // keccak256(subscriber, service, spendToken, nonce)
  subscriber:            address   // user or agent wallet
  service:               address   // the agent's Service contract
  spendToken:            address   // USDC on Arbitrum
  amountPerCycle:        uint96    // USDC amount per execution
  interval:              uint32    // seconds between executions
  lastExecutionTime:     uint48    // unix timestamp of last execution
  subscriptionStartTime: uint48    // unix timestamp of creation
  permitExpiry:          uint48    // Permit2 expiry, doubles as the cancellation marker
}
```

Invariants:
- No `active` flag. Active while `block.timestamp <= permitExpiry`.
- Cancellation sets `permitExpiry = block.timestamp`.
- Permit2 constant: `0x000000000022D473030F116dDEE9F6B43aC78BA3`.

#### Executor Check

`execute()` requires `msg.sender` to be in the `executors` allowlist (set by the owner via `setExecutor`). That is the only gate. ERC-8004 trust scoring has been removed from this version and is deferred.

```solidity
modifier onlyExecutor() {
    if (!executors[msg.sender]) revert NotExecutor();
    _;
}
```

#### Subscriber Params

The subscriber's input values ride in the `subscribe()` call as `bytes params` and are **emitted in an event** for the indexer. The contract does not store them in contract storage or interpret them. The indexer reads the event into the database, and the backend passes the values to the agent endpoint each cycle.

#### Key Functions

| Function | Caller | Description |
|---|---|---|
| `subscribe(service, spendToken, amount, interval, permitSingle, signature, params)` | Subscriber | Creates a subscription, registers the Permit2 allowance, emits params |
| `cancel(subscriptionId)` | Subscriber | Sets `permitExpiry = now`; the subscription stops immediately |
| `execute(subscriptionId, params)` | Executor (platform scheduler) | Validates timing and expiry, pulls one cycle via Permit2, calls `service.execute()` |
| `setExecutor(address, bool enabled)` | Owner | Enables or disables an executor EOA |
| `setFactory(address)` | Owner | Authorizes the ServiceFactory to register services it deploys |
| `registerService(address)` | Owner or factory | Whitelists a Service contract |
| `pause()` / `unpause()` | Owner | Emergency stop |

#### Safety Invariants

- `block.timestamp >= lastExecutionTime + interval` before execution (`TooEarly` revert).
- `block.timestamp <= permitExpiry` (`SubscriptionNotActive` revert).
- Subscriber holds at least `amountPerCycle` (`InsufficientSubscriptionAmount` revert).
- The contract never holds funds. The Permit2 `transferFrom` happens atomically at execution.

---

### 6.2 Service.sol and ServiceFactory.sol

Each subscription-capable agent gets its own `Service` contract, deployed by `ServiceFactory` at registration. The Service holds the agent's subscription revenue and lets the creator withdraw it. There is no platform fee and no treasury.

**ServiceFactory.createService(feeReceiver, spendToken, amount)** is permissionless. It deploys a `Service` owned by the caller (the agent or creator), registers it on `Subscriptions`, and tracks it (`servicesByAgent`, `allServices`, `isFactoryService`). The frontend reads the new address from the `ServiceCreated` event.

**Service** responsibilities:
- `userRegistered(subscriber, spendToken, amount, params)`: called from `Subscriptions.subscribe()`. Validates that the token and amount match the agent's configured terms, and emits the subscriber params for the indexer. It does not store params in storage.
- `execute(subscriber, spendToken, amount, params)`: called each cycle after the Permit2 pull. The base Service records the payment as the agent's earning. A specialized Service can do more (see SIPService).
- `withdraw(token)`: the creator sweeps the Service balance to `feeReceiver`.
- `setFeeReceiver`, `setTerms`: creator configuration.

A **one-time-only** agent needs no Service at all. It is just backend metadata, an endpoint, and a payout wallet.

### 6.3 SIPService.sol (example agent)

`SIPService` is one example listing: a DCA agent built on `Service`. Instead of simply holding the payment, it swaps the spend token through an aggregator and sends the output token (WETH, WBTC) directly to the subscriber, keeping a configurable fee as its own earning. It demonstrates that an agent's `execute()` can perform real on-chain work while staying non-custodial to the subscriber. It is not the core of the platform; it is a reference for what a DeFi agent looks like.

Arbitrum token addresses (example whitelist): USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, WETH `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1`, WBTC `0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0F`.

### 6.4 IService Interface

```solidity
interface IService {
    function userRegistered(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool);

    function execute(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool);
}
```

Any agent that wants subscriptions implements this and is deployed through the factory.

---

## 7. Payments

### 7.1 Subscription (Permit2)

A subscription is a standing, revocable authorization rather than a stored payment method.

```
1. Subscriber approves USDC to Permit2 once (one ERC-20 approval).
2. Subscriber signs a Permit2 PermitSingle bounding the amount per cycle and a duration.
3. Subscriber calls Subscriptions.subscribe(...); their params are emitted on-chain.
4. Each cycle: the scheduler calls execute(); USDC is pulled into the agent's Service;
   the backend sends a signed work request to the agent endpoint; the status is stored.
5. Cancel anytime: cancel(id) sets permitExpiry = now and all future pulls revert.
```

One signature authorizes recurring pulls, the subscriber keeps custody throughout, and a single transaction cancels everything going forward.

### 7.2 One-time (x402 / EIP-3009), direct

A one-time run is a single gasless USDC payment, settled directly between the subscriber and the agent, with no custom contract and no Daemon involvement in the payment path. This is the x402 `exact` scheme over EIP-3009 `transferWithAuthorization`.

```
1. The subscriber's browser (x402 client) calls the creator's endpoint.
2. The endpoint returns HTTP 402 with payment requirements (amount, USDC, payTo = agent).
3. The wallet signs an EIP-3009 transferWithAuthorization (from, to, value, validAfter,
   validBefore, nonce) over the token's EIP-712 domain.
4. The browser retries with the signed payload in the X-Payment header.
5. The creator (acting as its own x402 facilitator) verifies and settles the transfer;
   USDC goes straight from subscriber to agent.
6. The endpoint does the work and returns a short status, which Daemon may record for display.
```

For the POC, one-time goes direct to keep Daemon out of the payment path. A platform-facilitated version can be added later. EIP-3009 requires the token to support `transferWithAuthorization`; canonical USDC does, and a test token that supports it is used on Sepolia.

### 7.3 Why two primitives

EIP-3009 authorizes exactly one transfer of a fixed amount; it cannot express a recurring pull with a single signature, so it is ideal for one-time and wrong for subscriptions. Permit2 grants a standing allowance that can be pulled repeatedly until expiry, which is exactly the recurring shape, and it cancels in one call. Each primitive is used where it fits.

---

## 8. Money and Earnings

- **No platform fee, free listing, fully non-custodial.** Daemon holds nothing and takes no cut.
- **Subscription revenue** accrues in the agent's own `Service` contract. The creator withdraws it whenever they want via `Service.withdraw()`.
- **One-time revenue** lands directly in the agent's wallet at settlement.
- **Earnings view** is computed from the on-chain Service balance and totals (indexed) plus indexed one-time receipts. There is no payout schedule and no platform-held balance.

---

## 9. Trust Between Platform and Agent Endpoint

The subscription work-trigger and the one-time payment are secured differently:

- **One-time** is self-securing. The payment and the work request are the same x402 exchange; the endpoint only does the work after it sees a valid, settled payment.
- **Subscription** separates payment (on-chain pull) from the work request (backend to endpoint). The backend POSTs a **signed** work request `{subscriber, params, subscription_id, tx_hash, signature}` to the creator's endpoint. The endpoint verifies Daemon's signature (a key the creator registers at signup) and may independently check the on-chain reference, then does the work and returns a status.

ERC-8004 on-chain identity and reputation would strengthen this later; for the POC, agent identity and reputation are tracked off-chain in the registry.

---

## 10. Backend

### 10.1 Agent Registry

The off-chain record for each agent: endpoint URL, price, interval, mode (`subscription` / `one-time` / `both`), input schema (the fields a subscriber must supply), owner wallet, and Service address. This is where agent identity lives until ERC-8004 is introduced. The card tagline and short description can be summarized from the creator's longer description.

### 10.2 Scheduler / Executor

A loop that finds due subscriptions, calls `execute()` on `Subscriptions` as a registered executor to pull the cycle's payment, then sends a signed work request to the creator's endpoint and records the returned status. Retries with backoff on transient failures.

### 10.3 Indexer

Reads chain events into PostgreSQL: `SubscriptionCreated` (including the emitted params), `Executed`, `ServiceCreated`, and Service withdrawals. Keeps the marketplace, portfolio, and earnings views in sync with chain state.

### 10.4 API (BFF) and Auth

Aggregates on-chain and database state for the frontend. Wallet-based auth (nonce, sign, verify). Representative endpoints: marketplace listing and detail, user subscriptions, create and cancel subscription, billing, invoices, creator agents, register and update agent, creator earnings.

### 10.5 One-time

One-time runs are creator-direct, so the backend is not in the payment path. It provides discovery (listing the agent, its endpoint, price) and may record the returned status for display in the subscriber's portfolio.

### 10.6 Database Schema (representative)

```
agents {
  agent_id, owner_address, service_address, name, category,
  endpoint_url, mode, price_amount, interval_seconds,
  param_schema (jsonb), status, created_at
}

subscriptions {
  id (on-chain bytes32), subscriber_address, agent_id, service_address,
  amount_per_cycle, interval_seconds, last_execution_time,
  permit_expiry, params (jsonb), tx_hash, created_at
}

runs {
  id, subscription_id (nullable for one-time), agent_id, subscriber_address,
  kind (subscription | one_time), status_message, link, tx_hash, ran_at
}
```

---

## 11. Frontend

Next.js (App Router), wagmi, viem, RainbowKit. Arbitrum.

- **Marketplace.** Browse agents by category, search, and sort. Public, no wallet required.
- **Agent detail.** Description, inputs, price, and mode. A single subscribe action (USDC approval, Permit2 signature, `subscribe()`) and, where offered, a run-once action that acts as the x402 client against the creator's endpoint directly.
- **Subscriber portfolio.** Active subscriptions, what is paid, and the status of recent runs. Cancel in one transaction.
- **Creator console.** Register an agent (single price, interval, mode, input schema), see subscribers, and view and withdraw earnings.
- **Docs.** Public documentation with architecture and flow diagrams.

Registration deploys the Service on-chain through the factory (for subscription-capable agents), then records the agent in the backend with the new Service address.

---

## 12. Security Considerations

### Smart Contracts
- The contract never holds user funds; the Permit2 `transferFrom` happens atomically at execution.
- A subscription pulls only the approved amount per cycle and only while the permit is unexpired; cancellation is immediate.
- Reentrancy guards on external calls. Service whitelisting prevents arbitrary contracts from receiving pulled funds.
- The executor allowlist limits who can trigger a pull. A compromised executor still cannot exceed the subscriber's approved amount or duration.

### Agents and one-time payments
- One-time settlement is a single EIP-3009 transfer bounded by amount and a time window; a replayed nonce is rejected by the token.
- The trust model for one-time delivery is reputation, not escrow. A misbehaving agent is rated down and delisted. Escrow is a future option.
- Subscription work requests are signed by Daemon; the endpoint verifies the signature and may check the on-chain reference.

### Deferred trust layer
- ERC-8004 identity and validation registries exist in the repo but are out of the live path. When reintroduced, identity attaches to the service agents and reputation feeds marketplace ranking and, optionally, a subscribe gate.

---

## 13. POC Scope (What Gets Built First)

| Component | POC Implementation |
|---|---|
| `Subscriptions.sol` | Executor-gated, Permit2 pulls, params emitted; no trust scoring |
| `Service.sol` / `ServiceFactory.sol` | Per-agent Service, self-withdraw, no fee; permissionless factory |
| `SIPService.sol` | One example DCA agent (swap and forward output to subscriber) |
| One-time (x402) | Creator-direct EIP-3009 settlement; no custom contract |
| Backend | Agent registry, scheduler with signed work requests, indexer, BFF, wallet auth |
| Frontend | Marketplace, agent detail, portfolio, creator console, docs |
| Spend token | USDC on Arbitrum (Sepolia mock for testnet) |
| ERC-8004 | Deferred; identity and reputation tracked off-chain |

---

## 14. Success Metrics

| Metric | POC Target | 6-Month Target |
|---|---|---|
| Agents listed | 5 | 100 |
| End-to-end subscription executions on testnet | 10 | n/a |
| One-time x402 runs settled | 10 | n/a |
| Active subscriptions (mainnet) | n/a | 200 |
| Total volume settled | n/a | $100,000 |
| Execution success rate | >= 95% | >= 99% |
| User-reported fund loss | 0 | 0 |

---

## 15. Phased Roadmap

### Phase 1: POC (Arbitrum testnet to mainnet)
- `Subscriptions` + `Service` + `ServiceFactory` on Arbitrum; `SIPService` as an example agent.
- Permit2 subscriptions and creator-direct x402 one-time runs.
- Backend: agent registry, scheduler with signed work requests, indexer, BFF.
- Frontend: marketplace, agent detail, portfolio, creator console, docs.

### Phase 2: Trust and reliability
- Reintroduce ERC-8004: on-chain agent identity and subscriber-driven reputation feeding marketplace ranking.
- Platform-facilitated x402 option for one-time, so creators do not each run a facilitator.
- Notifications (opt-in) for run status and subscription events.

### Phase 3: Open agent economy
- First-class agent-to-agent subscriptions: agents discovering and subscribing to other agents autonomously.
- Optional on-chain escrow for one-time runs that need trustless delivery.
- Agent SDK: a toolkit for exposing a compliant endpoint and listing in minutes.
- Multi-tier pricing and usage-based billing.

---

## 16. Open Questions

| # | Question | Owner | Priority |
|---|---|---|---|
| 1 | What is the registered set of subscription intervals (weekly, monthly, custom)? | Product | Medium |
| 2 | Does the backend learn of new subscriptions from the indexer, a frontend POST, or both? | Engineering | Medium |
| 3 | What is the exact signed work-request schema and signature scheme the endpoint verifies? | Engineering | High |
| 4 | Should the test USDC on Sepolia support EIP-3009, or do we deploy one that does for the one-time demo? | Engineering | High |
| 5 | How do we present and rate one-time agents without on-chain reputation yet? | Product | Medium |
| 6 | When ERC-8004 returns, does trust gate listing, subscribing, or only ranking? | Product | Medium |
