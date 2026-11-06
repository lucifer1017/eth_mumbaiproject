# Daemon, API Specification v1

Contract between the Next.js frontend and the backend. Both sides MUST follow the conventions
below so no field-mapping layer is needed. This version matches the agent marketplace model:
one price per agent, non-custodial settlement, no platform fee, subscriptions on Arbitrum via
Permit2, one-time runs via x402 direct to the creator endpoint, and ERC-8004 identity plus a
display-only trust score. See `../PRD.md` and `../backend/BACKEND_CHANGES.md`.

No em dashes anywhere in this repo's docs, please.

---

## 1. Conventions

| Topic | Convention | Example |
| --- | --- | --- |
| Base URL | `/api/v1` | `https://api.daemonagents.com/api/v1` |
| URL paths | kebab-case, plural resources | `/creator/agents` |
| JSON fields | `snake_case` | `subscriber_count` |
| IDs | opaque strings, prefixed by type | `agt_01HXX`, `sub_01HXX`, `run_01HXX`, `usr_01HXX` |
| Enum values | lowercase `snake_case` strings | `"one_time"`, `"past_due"` |
| Timestamps | ISO 8601 UTC, suffix `_at` / `_time` | `"created_at": "2026-06-11T09:30:00Z"` |
| Money | object, amount as string decimal | `{ "amount": "12.00", "currency": "USDC" }` |
| Wallet addresses | full checksummed string, field `user_address` | `"0x7A3f9c4EC9f2"` |
| On-chain refs | hex strings as-is | `service_address`, `onchain_sub_id`, `tx_hash` |
| User-scoped reads | `POST` with `user_address` in the body | `POST /user/subscriptions` |
| Pagination | `?page=1&limit=20`, `pagination` inside `details` | see 1.2 |

### 1.1 Universal response envelope

**Every** response, success and failure, all status codes, uses this exact shape:

```json
{
  "success": true,
  "data": {
    "code": "200",
    "message": "Data fetched successfully",
    "details": {}
  }
}
```

| Field | Type | Rule |
| --- | --- | --- |
| `success` | boolean | `true` for 2xx, `false` otherwise |
| `data.code` | string | HTTP status code as a string: `"200"`, `"201"`, `"400"` |
| `data.message` | string | Human-readable summary, safe to show in the UI |
| `data.details` | object | The payload. On failure: `{}` (or `field_errors` / `error_code` when useful) |

Failure example:

```json
{
  "success": false,
  "data": { "code": "404", "message": "Agent not found", "details": {} }
}
```

| HTTP / `data.code` | Used for |
| --- | --- |
| `"200"` | Successful read / update / cancel |
| `"201"` | Resource created |
| `"400"` | Validation failed |
| `"401"` | Missing or invalid signature |
| `"403"` | Not the owner of the resource |
| `"404"` | Agent / subscription / user not found |
| `"409"` | Already subscribed, handle taken |
| `"422"` | On-chain state not found or mismatched |

### 1.2 Pagination object

Lives inside `data.details` next to the list it describes:

```json
{ "pagination": { "page": 1, "limit": 20, "total_items": 134, "total_pages": 7 } }
```

### 1.3 Shared enums

```
agent_mode           = "subscription" | "one_time" | "both"
billing_interval     = "weekly" | "monthly"          // subscription cadence
subscription_status  = "active" | "cancelled" | "expired" | "past_due"
agent_status         = "draft" | "live" | "paused" | "delisted"
run_kind             = "subscription" | "one_time"
user_role            = "subscriber" | "creator"
agent_category       = "finance" | "productivity" | "career" | "engineering" | "research" | "other"
sort_option          = "popular" | "rating" | "price_asc" | "price_desc" | "newest"
```

---

## 2. Core resources

### 2.1 `user`

```json
{
  "user_id": "usr_01HXX",
  "user_address": "0x7A3f9c4E1b8D2f6A0c5E9B3d7F1a4C8e2B6dC9f2",
  "handle": "rohit",
  "roles": ["subscriber", "creator"],
  "created_at": "2026-06-11T09:30:00Z"
}
```

### 2.2 `agent` (marketplace card, list view)

```json
{
  "agent_id": "agt_01HXX",
  "service_address": "0x1Bc28F7a44D1",
  "onchain_agent_id": "42",
  "name": "Pulse",
  "icon": "https://cdn.daemonagents.com/agents/pulse/icon.png",
  "logo": "https://cdn.daemonagents.com/agents/pulse/logo.png",
  "category": "finance",
  "tagline": "dca-agent",
  "short_description": "Dollar-cost averages into your portfolio on a schedule you set.",
  "services": ["auto-dca", "rebalance", "alerts"],
  "mode": "both",
  "sub_price": { "amount": "19.00", "currency": "USDC" },
  "payment_frequency": "monthly",
  "one_time_price": { "amount": "0.50", "currency": "USDC" },
  "trust_score": 80,
  "rating": 4.8,
  "rating_count": 312,
  "subscriber_count": 1214,
  "publisher_name": "Meridian Labs",
  "status": "live",
  "created_at": "2026-06-01T00:00:00Z"
}
```

- `service_address` is the agent's Service contract (null for `one_time`-only agents). The
  frontend targets it when calling `Subscriptions.subscribe()` on-chain.
- `onchain_agent_id` is the ERC-8004 identity token id (a uint256 as a string).
- `trust_score` is a 0 to 100 value from the ValidationRegistry, display only, gates nothing.
- `sub_price` + `payment_frequency` apply to subscriptions; `one_time_price` applies to one-time
  runs. A field is null when the agent does not offer that mode.

### 2.3 `agent_detail` (= `agent` + the fields below)

```json
{
  "description": "Pulse executes a disciplined dollar-cost averaging strategy.",
  "interval_seconds": 2592000,
  "param_schema": [
    { "key": "wallet", "label": "Wallet to monitor", "type": "text", "required": true, "placeholder": "0x" }
  ]
}
```

`param_schema` is the list of inputs the subscriber must supply. The values are encoded by the
frontend, passed in the on-chain `subscribe()` call as bytes, and relayed to the agent endpoint.

### 2.4 `subscription`

```json
{
  "id": "sub_01HXX",
  "agent_id": "agt_01HXX",
  "agent": "Tidy",
  "logo": "https://cdn.daemonagents.com/agents/tidy/logo.png",
  "status": "active",
  "billing_interval": "monthly",
  "onchain_sub_id": "0x9c4e7a3fb2d1",
  "last_payment_amount": { "amount": "12.00", "currency": "USDC" },
  "last_payment_time": "2026-06-01T00:00:14Z",
  "next_payment_amount": { "amount": "12.00", "currency": "USDC" },
  "next_payment_time": "2026-07-01T00:00:00Z",
  "started_at": "2026-04-01T00:00:00Z",
  "cancelled_at": null
}
```

`next_payment_amount` / `next_payment_time` are `null` once cancelled.

### 2.5 `run` (one entry in the money + status ledger)

```json
{
  "run_id": "run_01HXX",
  "agent_id": "agt_01HXX",
  "agent": "Pulse",
  "kind": "subscription",
  "amount": { "amount": "19.00", "currency": "USDC" },
  "status_message": "DCA bought, 0.004 WETH",
  "link": "https://sepolia.arbiscan.io/tx/0xabc",
  "success": true,
  "tx_hash": "0xabc123",
  "ran_at": "2026-06-01T00:00:14Z"
}
```

A `run` is one subscription cycle or one one-time execution. The subscriber's spendings and the
creator's earnings are both aggregated from runs.

---

## 3. Auth and onboarding (wallet-based)

### 3.1 `POST /auth/nonce`

Input: `{ "user_address": "0x7A3f9c4EC9f2" }`

Output `details`: `{ "nonce": "8f3b2c91", "sign_message": "daemon wants you to sign...", "expires_at": "2026-06-11T09:35:00Z" }`

### 3.2 `POST /auth/verify`

Input: `{ "user_address": "0x7A3f9c4EC9f2", "signature": "0x9f8e7d" }`

Output `details`: `{ "is_new_user": true, "user": { /* user, handle null until onboarding */ } }`
Failure `401`: `Invalid signature`. `is_new_user: true` triggers the onboarding modal.

### 3.3 `POST /user/onboard`

Input: `{ "user_address": "0x7A3f9c4EC9f2", "handle": "rohit", "role": "subscriber" }`

Output `201` `details`: `{ "user": { /* user */ } }`. Failure `409`: `Handle already taken`.

---

## 4. Marketplace (public)

### 4.1 `GET /agents`

Query params (all optional): `category` (`agent_category`), `mode` (`agent_mode`),
`search` (string), `sort` (`sort_option`, default `popular`), `page`, `limit`.

Output `details`:

```json
{
  "agents": [ /* agent[] (2.2) */ ],
  "pagination": { "page": 1, "limit": 20, "total_items": 6, "total_pages": 1 }
}
```

### 4.2 `GET /agents/{agent_id}`

Output `details`: `{ "agent": { /* agent_detail (2.2 + 2.3) */ } }`. Failure `404`: `Agent not found`.

---

## 5. Subscriptions and spendings

### 5.1 `POST /user/subscriptions` (list a user's subscriptions)

Input: `{ "user_address": "0x7A3f9c4EC9f2", "status": "active" }` (`status` optional, default `active`).

Output `details`:

```json
{
  "subscriptions": [ /* subscription[] (2.4) */ ],
  "summary": { "active_count": 1, "monthly_total": { "amount": "12.00", "currency": "USDC" } }
}
```

### 5.2 `POST /subscriptions` (record an on-chain subscription)

Before calling this endpoint the frontend completes the on-chain subscribe against the agent's
Service contract: approve USDC to Permit2, sign a Permit2 `PermitSingle`, then
`Subscriptions.subscribe(service, usdc, amountPerCycle, interval, permitSingle, signature, params)`.
`subscription_id` is the `bytes32 id` from `SubscriptionCreated`; `tx_hash` is the subscribe
transaction. The backend verifies the subscription exists on-chain
(`Subscriptions.getSubscription(subscription_id)`) before recording it. The subscriber `params`
are read from the event by the indexer, not sent here.

Input:

```json
{
  "user_address": "0x7A3f9c4EC9f2",
  "agent_id": "agt_01HXX",
  "subscription_id": "0x9c4e7a3fb2d1",
  "tx_hash": "0x5f1e8c0977aa"
}
```

Output `201` `details`: `{ "subscription": { /* subscription (2.4), status: "active" */ } }`.
Failure `409`: `Already subscribed to this agent`. Failure `422`: `Subscription not found on-chain`.

### 5.3 `POST /subscriptions/{subscription_id}/cancel`

The frontend calls `Subscriptions.cancel(onchain_sub_id)` on-chain; this records the cancel.

Input: `{ "user_address": "0x7A3f9c4EC9f2" }`

Output `200` `details`: `{ "subscription": { /* subscription, status: "cancelled" */ } }`.
Failure `404`: `Subscription not found`.

### 5.4 `POST /user/runs` (subscriber spendings and activity)

Input: `{ "user_address": "0x7A3f9c4EC9f2", "page": 1, "limit": 20 }`

Output `details`:

```json
{
  "runs": [ /* run[] (2.5) */ ],
  "summary": { "total_spent": { "amount": "142.50", "currency": "USDC" } },
  "pagination": { "page": 1, "limit": 20, "total_items": 12, "total_pages": 1 }
}
```

### 5.5 `POST /runs` (record a completed one-time run)

One-time runs settle directly between the subscriber's browser and the creator endpoint via
x402 (section 7); the backend is not in that payment path. After a successful run the frontend
posts the result so it appears in the portfolio and the creator earnings.

Input:

```json
{
  "user_address": "0x7A3f9c4EC9f2",
  "agent_id": "agt_01HXX",
  "amount": { "amount": "0.50", "currency": "USDC" },
  "status_message": "Resume tailored, download ready",
  "link": "https://...",
  "success": true,
  "tx_hash": "0xabc123"
}
```

Output `201` `details`: `{ "run": { /* run (2.5), kind: "one_time" */ } }`.

---

## 6. Creator

### 6.1 `POST /creator/agents/list`

Input: `{ "user_address": "0x7A3f9c4EC9f2" }`

Output `details`:

```json
{
  "agents": [
    {
      "agent_id": "agt_01HXX",
      "name": "Pulse",
      "icon": "https://cdn.daemonagents.com/agents/pulse/icon.png",
      "logo": "https://cdn.daemonagents.com/agents/pulse/logo.png",
      "category": "finance",
      "tagline": "dca-agent",
      "mode": "both",
      "status": "live",
      "trust_score": 80,
      "subscriber_count": 1214,
      "monthly_recurring_revenue": { "amount": "4230.00", "currency": "USDC" },
      "created_at": "2026-06-01T00:00:00Z"
    }
  ]
}
```

### 6.2 `POST /creator/agents/register` (registration form, submits once)

For a subscription-capable agent the frontend first deploys the Service and mints the ERC-8004
identity via `ServiceFactory.createService(feeReceiver, spendToken, amount, interval, agentCardURI)`,
reading `service` and `agentId` from the `ServiceCreated` event. A one-time-only agent calls
`ServiceFactory.registerAgent(agentCardURI)` instead and has no `service_address`. The backend
verifies `service_address` via `ServiceFactory.isFactoryService(service_address)` (when present)
and stores the agent. The backend hosts the AgentCard JSON at `agent_card_uri`.

Input:

```json
{
  "user_address": "0x7A3f9c4EC9f2",
  "service_address": "0x1Bc28F7a44D1",
  "onchain_agent_id": "42",
  "agent_card_uri": "https://api.daemonagents.com/api/v1/agents/42/card.json",
  "endpoint_url": "https://nightwatch.example.com/run",
  "mode": "both",
  "name": "Nightwatch",
  "category": "engineering",
  "description": "Watches your endpoints overnight and files incident reports.",
  "services": ["uptime-checks", "alerting", "weekly-report"],
  "param_schema": [
    { "key": "endpoint", "label": "Endpoint to watch", "type": "text", "required": true }
  ],
  "sub_price": { "amount": "29.00", "currency": "USDC" },
  "payment_frequency": "monthly",
  "one_time_price": { "amount": "1.00", "currency": "USDC" }
}
```

`sub_price` + `payment_frequency` are required for `subscription` / `both`; `one_time_price` for
`one_time` / `both`. The backend derives `interval_seconds` from `payment_frequency`.

Output `201` `details`: `{ "agent": { /* agent_detail, status: "live" */ } }`.
Failure `400`: `Request validation failed` with `field_errors`.

### 6.3 `POST /creator/agents/update`

Input: `agent_id` plus any subset of the 6.2 fields, plus `status` (`"live" | "paused"`).
Output `200` `details`: `{ "agent": { /* agent_detail */ } }`. Failure `403`: `You do not own this agent`.

### 6.4 `POST /creator/agents/subscribers` (who subscribed)

Input: `{ "user_address": "0x7A3f9c4EC9f2", "agent_id": "agt_01HXX", "page": 1, "limit": 20 }`

Output `details`:

```json
{
  "subscribers": [
    {
      "user_address": "0x9aF1b2C3",
      "handle": "alex",
      "subscription_id": "sub_01HXX",
      "status": "active",
      "started_at": "2026-04-01T00:00:00Z",
      "last_payment_time": "2026-06-01T00:00:14Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total_items": 1214, "total_pages": 61 }
}
```

### 6.5 `POST /creator/earnings`

Non-custodial: there is no platform fee and no scheduled payout. Earnings accrue in each agent's
Service contract and the creator withdraws on-chain via `Service.withdraw()`. Figures below are
gross to the agent.

Input: `{ "user_address": "0x7A3f9c4EC9f2" }`

Output `details`:

```json
{
  "stats": {
    "monthly_recurring_revenue": { "amount": "4230.00", "currency": "USDC" },
    "active_subscribers": 1214,
    "subscriber_change": 41,
    "withdrawable_balance": { "amount": "1094.00", "currency": "USDC" },
    "lifetime_revenue": { "amount": "38500.00", "currency": "USDC" },
    "total_withdrawn": { "amount": "37406.00", "currency": "USDC" }
  },
  "revenue_by_month": [
    { "month": "2025-11", "amount": { "amount": "2210.00", "currency": "USDC" } },
    { "month": "2026-06", "amount": { "amount": "4230.00", "currency": "USDC" } }
  ],
  "withdrawals": [
    {
      "withdrawal_id": "wdl_01HXX",
      "agent_id": "agt_01HXX",
      "amount": { "amount": "1058.40", "currency": "USDC" },
      "tx_hash": "0xdef456",
      "withdrawn_at": "2026-06-05T00:00:00Z"
    }
  ],
  "earnings_by_agent": [
    {
      "agent_id": "agt_01HXX",
      "agent_name": "Pulse",
      "subscriber_count": 1214,
      "monthly_recurring_revenue": { "amount": "3807.00", "currency": "USDC" },
      "withdrawable_balance": { "amount": "900.00", "currency": "USDC" }
    }
  ]
}
```

`withdrawable_balance` is read live on-chain (`USDC.balanceOf(service_address)`). `revenue_by_month`
covers the trailing 8 months, oldest first, summed from the `runs` ledger.

---

## 7. One-time runs: x402, direct to the creator endpoint

One-time runs settle directly between the subscriber's browser (the x402 client) and the
creator's endpoint (the x402 server) using EIP-3009 `transferWithAuthorization` on Arbitrum.
Our backend is not in the payment path. Its role is discovery (the `agent` carries
`endpoint_url` server-side, `one_time_price`, and `onchain_agent_id`) and recording the result
via `POST /runs` (5.5).

Flow:

1. The frontend calls the creator's `endpoint_url` with the run inputs.
2. If unpaid, the endpoint returns HTTP `402` with payment requirements (amount, USDC asset,
   `pay_to` = the agent wallet, network `eip155:421614`).
3. The wallet signs an EIP-3009 `transferWithAuthorization`; the frontend retries with the
   signed payload in the `X-Payment` header.
4. The creator settles the transfer (USDC goes straight to the agent) and returns the result.
5. The frontend posts the result to `POST /runs` so it appears in the portfolio and earnings.

The backend never sees the payment; it only stores the run the frontend reports.

---

## 8. Frontend mapping notes

| UI element | Endpoint |
| --- | --- |
| Marketplace grid | `GET /agents` |
| Agent detail | `GET /agents/{agent_id}` |
| Subscribe confirm modal (after on-chain subscribe) | `POST /subscriptions` |
| My subscriptions list | `POST /user/subscriptions` |
| Cancel button (after on-chain cancel) | `POST /subscriptions/{subscription_id}/cancel` |
| Portfolio activity / spendings | `POST /user/runs` |
| One-time run result (after x402) | `POST /runs` |
| Connect wallet, onboarding | `POST /auth/nonce`, `POST /auth/verify`, `POST /user/onboard` |
| Creator listed agents | `POST /creator/agents/list` |
| Register agent (after createService) | `POST /creator/agents/register` |
| Edit listing | `POST /creator/agents/update` |
| Subscribers list | `POST /creator/agents/subscribers` |
| Earnings dashboard | `POST /creator/earnings` |
