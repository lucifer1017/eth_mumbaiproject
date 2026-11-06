# contracts

The on chain core of Daemon. These Foundry contracts define the payment rails,
the per agent revenue vaults, and the agent identity and reputation layer. Every
other component in the repo (frontend, backend, indexer, executor, agents) is
ultimately reading from or writing to the contracts in this directory.

## Why this matters

The contracts are the trust anchor of the whole protocol. They are what make
Daemon non custodial: funds move directly from a subscriber to an agent's own
`Service` contract, the platform never holds money, and a subscriber can cancel
unilaterally at any time. If the rest of the stack disappeared, the money already
committed on chain would still behave correctly.

## Contracts

| File                          | Role                                                                 |
|-------------------------------|----------------------------------------------------------------------|
| `Subscriptions.sol`           | The recurring payment engine. Holds subscription state, verifies Permit2 permits, pulls USDC each cycle via `execute()`, and supports single call `cancel()`. |
| `Service.sol`                 | Per agent revenue vault. One per agent, deployed by the factory. Validates token, amount, and interval on subscribe, accrues earnings, and lets the agent owner self withdraw. |
| `ServiceFactory.sol`          | Permissionless entry point. `createService()` deploys a `Service`, mints an ERC-8004 identity, and registers the service with `Subscriptions`. `registerAgent()` mints identity only for one time agents. |
| `SIPService.sol`              | Example agent that inherits `Service`. The original DCA executor, kept as a reference listing rather than the core product. |
| `ERC8004IdentityRegistry.sol` | ERC-721 based agent identity. The factory is an authorised registrar and mints an identity token per agent at registration. |
| `ERC8004ValidationRegistry.sol` | Centralised score store for agent reputation. Display only for now, gates nothing, and is updated by the operator. |
| `interfaces/`                 | Shared interfaces (`IService`, the ERC-8004 registry interfaces, and others) used across the contracts. |

## Payment primitives

- Subscriptions use Permit2 `AllowanceTransfer`. One signature authorises bounded
  recurring pulls. The permit expiry bounds the subscription window and
  `cancel()` sets that expiry to now.
- One time payments are not handled by these contracts. They settle off chain
  through x402 / EIP-3009 `transferWithAuthorization` directly between the
  subscriber and the agent worker.

## Events

The indexer in `backend/` keys off events emitted here, most importantly
`SubscriptionCreated` (carries the encoded subscriber params), `SubscriptionCancelled`,
`Executed`, `ServiceCreated`, and the `Service` withdrawal events. Keeping these
event signatures stable is what keeps the off chain database in sync with chain
state.

## Layout

```
src/         The contracts listed above plus interfaces/
script/      Foundry deploy and ops scripts (Deploy*, CreateService, Subscribe, Execute)
deployments/ Recorded deployment addresses per network (arbitrum-sepolia.json)
test/        Mocks and harness. Full integration tests are deferred for now.
```

## Build and deploy

```bash
forge build

# deploy the full set to Arbitrum Sepolia (identity + validation registries,
# ServiceFactory, Subscriptions, wiring of setRegistrar and setFactory)
forge script script/DeployTestnet.s.sol --rpc-url arbitrum_sepolia --broadcast
```

`foundry.toml` defines the `arbitrum_one` and `arbitrum_sepolia` RPC endpoints
(from `ARBITRUM_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL`) and the Arbiscan keys for
verification. `via_ir` is enabled.

After deploying, copy the new addresses into `deployments/arbitrum-sepolia.json`
and sync them into the backend env, the executor env, and the frontend build
args, or the off chain components will talk to stale contracts.

## Current deployment

See `deployments/arbitrum-sepolia.json` for the live addresses. The core set is
Subscriptions, ServiceFactory, IdentityRegistry, ValidationRegistry, and a Mock
USDC used as the spend token on testnet.
