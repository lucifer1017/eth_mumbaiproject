# agents

The example agent workers that actually do the work a subscriber pays for. In
Daemon, creators host their own agent endpoint and the platform never runs their
code. This directory ships two reference agents that demonstrate both payment
modes end to end, so the rest of the stack has something real to call.

## Why this matters

The contracts move money and the backend handles discovery, but neither produces
the actual result a user is buying. The agents are where the value is delivered.
They also prove the protocol's core claim: an agent is just an HTTP service with a
wallet, and it can earn through Daemon without any custodian. These two agents are
the working proof that a recurring subscription and a one time x402 call both
settle in real on chain USDC and return a result.

## The agents

| Agent                 | Port | Mode         | What it does                                                  |
|-----------------------|------|--------------|--------------------------------------------------------------|
| `agent_dca`           | 8402 | subscription | The DCA decision worker. Serves `/price`, `/route`, and the paid `/v1/decide` endpoint the executor calls each cycle. Uses Claude to make the buy decision. |
| `agent_risk_analyzer` | 8403 | one time     | A wallet risk analyzer. Serves the paid `/v1/risk-report` endpoint, settled directly in on chain USDC by the caller. |

## How they get paid

Each agent runs a small x402 worker. When a caller hits a paid endpoint without
payment, the worker responds with a 402 and a price quote. The caller signs an
EIP-3009 `transferWithAuthorization` (the x402 `exact` standard) and retries with
an `X-Payment` header. The worker verifies and settles that payment on chain,
sending the USDC to the agent's own wallet, then runs the work and returns the
result. This is the same primitive Daemon uses for one time payments, which is why
the one time agent needs nothing beyond its own endpoint.

For the subscription agent, the on chain pull is done by the `Subscriptions`
contract (driven by the executor), and the executor then calls the agent's worker
to actually perform the cycle's work.

## Structure

Both agents share the same shape:

```
agent_<name>/
  src/
    x402/        The x402 server (server.ts) and types
    agent/       The decision logic (claude.ts)
    chain/       viem client setup
    prices/      Price data helpers
    config.ts    Env backed config
    index.ts     Boots the x402 server
  Dockerfile
```

## Running

```bash
# inside an agent directory, for example agents/agent_dca
npm install
npm run dev        # watch mode
npm run start      # one shot
```

Or run both via the root compose stack, which includes
`docker-compose.agents.yml`:

```bash
docker compose up --build agent_dca agent_risk_analyzer
```

Configuration (shared in `docker-compose.agents.yml`) covers the RPC URL, chain
id, the signing private key, the USDC address, the listen port, the per call
price in USDC, and the Anthropic key that enables the Claude backed decisions.
