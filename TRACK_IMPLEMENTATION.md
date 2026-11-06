# TRACK_IMPLEMENTATION.md — Meter (Whitechain + Uniswap)

Status of this document: **PLAN ONLY.** Nothing in here has been implemented, deployed, signed, or installed. Every implementation task starts as TODO or BLOCKED.

Evidence labels used throughout:

| Label | Meaning |
|---|---|
| **VERIFIED-SRC** | Read in this repository's source at the commit in §1.2 |
| **VERIFIED-DOC** | Read on an official web page (URL + access date in §2). Unless §4 says "re-checked", it was read by a research subagent, not the main author |
| **VERIFIED-RPC** | Observed via a read-only JSON-RPC call (`eth_chainId`, `eth_call`, `eth_getCode`, `eth_getStorageAt`); no transaction sent, nothing signed. Same subagent caveat as above |
| **REPORTED** | Stated by a third-party (non-official) source only |
| **INFERRED** | Reasoned from verified facts; not directly confirmed |
| **PROPOSED** | A design recommendation in this plan; does not exist yet |
| **OPEN** | Unresolved decision or unknown; see §12 |
| **NOT RUN** | A test/check that has not been executed |

---

## 1. Scope and current repository state

### 1.1 Scope

- Project name: **Meter**. Code base: the existing Daemon agent-subscription marketplace.
- Tracks (only these two): (1) Whitechain — "Scale · Payments Nobody Notices"; (2) Uniswap Foundation — "Build with Uniswap".
- Earlier Hedera / 0G / World / Arkiv recommendations are superseded and not carried into this plan.
- This task was research and documentation only. No packages, skills, accounts, deployments, keys, or configuration were created or changed.

### 1.2 Repository snapshot (VERIFIED-SRC, 2026-11-06)

| Item | Value |
|---|---|
| Inspected checkout | `C:\references\Daemon`. The brief names `/Users/neelsubhashpote/Desktop/ethglob`; that path was not available to the inspector. **Confirm both checkouts are at the same commit before relying on line references.** |
| Remote | `https://github.com/web3cook/Daemon.git` |
| Commit | `2eeed81fc3cec1dafbd277f2dccea8909247455d` (2026-06-15), branch `main`, clean |
| AGENTS.md / CLAUDE.md | None exist anywhere in the repo |
| LICENSE file | None at repo root (see D-S3) |
| Installed deps | No `node_modules` in `backend/`, `frontend/`, `agents/agent_dca/`, `agents/agent_risk_analyzer/`; no `contracts/lib/`, no `.gitmodules` |
| Local tooling on inspecting machine | `node v24.21.0`, `npm 11.19.0`; `forge`, `cast`, `docker`, `psql` **not installed** |

### 1.3 Components (VERIFIED-SRC)

| Component | Path | Entry / script | Notes |
|---|---|---|---|
| Contracts | `contracts/src/` | Foundry | `Subscriptions.sol`, `Service.sol`, `SIPService.sol`, `ServiceFactory.sol`, `ServiceDeployer.sol`, `ERC8004IdentityRegistry.sol`, `ERC8004ValidationRegistry.sol` |
| API | `backend/src/api/server.ts` → `app.ts` | `npm run api:start` | Express, routes under `/api/v1` |
| Indexer | `backend/src/index.ts` → `indexer/indexer.ts` | `npm run start` | Polls logs in 10k-block chunks; checkpoint in `system_constants` |
| Executor | `backend/src/executor/main.ts` → `executor.ts`, `scheduler/scheduler.ts` | `npm run executor:start` | 30 s tick |
| DCA agent | `agents/agent_dca/src/x402/server.ts` | port 8402 | `/price`, `/route`, paid `/v1/decide` |
| Risk agent | `agents/agent_risk_analyzer/src/x402/server.ts` | port 8403 | Paid `/v1/invoke` (`agents/README.md:22` and `agents/agent_risk_analyzer/.env.example` say `/v1/risk-report`) |
| Frontend | `frontend/app/`, `frontend/lib/` | `npm run build` (only `dev`/`build`/`start` scripts) | Next.js 16, wagmi 2, RainbowKit 2; hardcoded to Arbitrum Sepolia |
| Orchestration | `docker-compose.yml`, `docker-compose.agents.yml` | `docker compose up --build` | All services share one `PRIVATE_KEY` |

### 1.4 Answers to the required investigation questions (VERIFIED-SRC; independently re-confirmed by the reviewer)

| # | Question | Finding | Evidence |
|---|---|---|---|
| Q1 | Does one-time invocation charge through Permit2 before paying a worker? | **Yes.** `AgentInvokeService.run()` submits `Permit2.permit`, then `Permit2.transferFrom` (platform cut `agent_invoke_fee`) and `Permit2.transferFrom` (creator cut), **then** calls the worker via `X402Client.invoke()`. The route does not check that the signed amount equals `one_time_price_amount`, that the token is USDC, or that the spender is the platform wallet. If the worker call fails after the charge, the user is charged with no result and no refund path. `X402Client.invoke` is wrapped in `withRetry({maxAttempts: 2})`, so a timeout after the worker settled can pay the worker twice. | `backend/src/api/routes/marketplace.ts:186` onward; `backend/src/agent-invoke/invoke.ts` (`run`); `backend/src/x402/client.ts:175` |
| Q2 | Does wallet verification establish a usable authenticated session? | **No.** `/auth/verify` recovers the signer and deletes the nonce but issues no token/cookie. Every other route trusts `user_address` from the request body (including the ownership check in `/creator/agents/update`). `requestNonce`/`verifyWallet` exist but are never called. Nonce uses `Math.random`. | `backend/src/api/routes/auth.ts`; `backend/src/api/routes/creator.ts` (`/agents/update`); `frontend/lib/api/endpoints.ts:30-39` |
| Q3 | Do migrations contain destructive statements? | **Yes, limited:** `DROP TABLE IF EXISTS invoices/payouts/plans CASCADE` (legacy tables only). The larger risk: no versioning (`migrate.ts` executes the whole file), and `docker-entrypoint.sh` runs `npm run db:migrate` on every container start. Compose overrides only `command` for indexer/executor, so the Dockerfile `ENTRYPOINT` runs the migration in **all three** backend containers concurrently at boot. The entrypoint also prints "Starting API server…" for indexer/executor (cosmetic). | `backend/src/db/schema.sql:19-21`; `backend/src/db/migrate.ts`; `backend/docker-entrypoint.sh`; `backend/Dockerfile`; `docker-compose.yml` |
| Q4 | Does configuration force unrelated components to require EVM keys? | **Yes.** `backend/src/config.ts` `requireEnv`s `PRIVATE_KEY`, `AGGREGATOR_ADDR`, `OUTPUT_TOKEN_ADDR`, `SERVICE_FACTORY_ADDR`, `VALIDATION_REGISTRY_ADDR` for every backend process. The read-only indexer calls `buildClients(…privateKey)`. The API builds a signing client at import time and derives `platform_wallet_address` from the key. All agents/services share one key in Compose. | `backend/src/config.ts`; `backend/src/index.ts:20`; `backend/src/api/routes/marketplace.ts:17-19`; `backend/src/api/routes/config.ts`; `docker-compose.yml` `x-backend-env` |
| Q5 | Can the scheduler overlap executions? | **Yes.** `setInterval(tick, 30s)` has no in-flight guard; `tryExecute` can wait 60 s for a receipt. Due subscriptions run in parallel from the **same** EOA with no nonce management. The contract's `TooEarly` prevents a double pull, but the paid `/v1/decide` call happens before `execute()`, so overlap can pay the agent twice. | `backend/src/scheduler/scheduler.ts`; `backend/src/executor/executor.ts` (steps 6, 9) |
| Q6 | Can executor/indexer accounting duplicate runs or usage counts? | **Yes.** `usage_count` is incremented by the executor (`executor.ts:230`) **and** the indexer `Executed` handler (`indexer.ts:257`). Run insertion is deduped only by a racy `SELECT … WHERE tx_hash`; no unique constraint on `runs.tx_hash`. | files cited; `backend/src/db/schema.sql` (`runs`) |
| Q7 | Are swap outputs actual received values or quotes? | **Quotes.** The executor records `routeResp.output_amount` (synthetic, from CoinCap or a fallback price) as `runs.output_amount`. The actual amount exists only in `SIPService`'s `SwapExecuted` event, which nothing indexes. Swaps target a mock `TestAggregator`. | `backend/src/executor/executor.ts` (`recordRun`); `agents/agent_dca/src/x402/server.ts` (`buildRoute`); `contracts/src/SIPService.sol`; `contracts/script/helpers/MockContracts.sol` |
| Q8 | Are token decimals and network addresses hardcoded? | **Yes.** Decimals: `formatUnits(…, 6)` in indexer/executor/API, `formatUnits(outputAmount, 18)` in executor, `USDC_DECIMALS = 6` in frontend, `1e18`/`1_000_000` in DCA route math. Network: `421614`/Arbitrum branches in `backend/src/chain/client.ts`, `backend/src/api/chain.ts`, both agents' `src/chain/client.ts`; unknown chain IDs fall back to `defineChain` with native "ETH" and an empty RPC list. `CONTRACT_CHAIN = arbitrumSepolia` in `frontend/lib/contracts.ts`. `https://sepolia.arbiscan.io/tx/` in executor; `network: 'arbitrum-sepolia'` in subscriptions route. Old addresses in Compose, `frontend/app/docs/[[...slug]]/page.tsx`, `backend/src/db/seed.ts`. A third-party RPC URL with an embedded key is committed at `frontend/lib/wagmi.ts:20` (previous owner's; do not reuse; not reproduced here). | files cited |
| Q9 | Are tests excluded by configuration? | **Yes.** `contracts/foundry.toml` `skip` lists all four test files. No JS/TS test framework or `test` script exists in any `package.json`. | `contracts/foundry.toml`; all `package.json` |

### 1.5 Other relevant findings (VERIFIED-SRC)

- **Agent "x402" is not real x402 and is drainable.** `X-Payment` is unsigned JSON `{from, value, nonce}`. Agents call `USDC.transferFrom(payment.payload.from, payTo, price)` against any standing allowance. The executor approves the DCA agent for `maxUint256` (`backend/src/x402/client.ts:84-85`), so anyone can make the agent pull the executor's USDC by posting `from = executor`. Files: `agents/agent_dca/src/x402/server.ts` (`/v1/decide`), `agents/agent_risk_analyzer/src/x402/server.ts` (`/v1/invoke`).
- **Subscriber identity is `msg.sender`.** `Subscriptions.subscribe()`/`cancel()` cannot be relayed without a contract change.
- **SIPService trusts executor-supplied swap data.** `aggregator.call(p.swapData)` with executor-chosen `minOutputAmount`; output measured as the contract's balance delta. Fee stays in the contract and is swept to `feeReceiver` by `Service.withdraw()` (`Service.sol:122-126`).
- **Executor is DCA-only.** Every subscription gets ETH swap params and a `/v1/decide` call; trust score read for one fixed `AGENT_ID`.
- **Subscriber params are public.** The frontend puts `stringToHex(JSON.stringify(paramValues))` into on-chain `subscribe` params (`frontend/lib/store.tsx`, `confirmSubscribe`).
- **Frontend faucet** calls an open `mint()` on the mock token (`frontend/lib/useFaucet.ts`); unusable with the prize USDT (owner-only mint).

---

## 2. Verified resources and date checked

Web sources accessed 2026-11-06 (some Uniswap pages 2026-11-07) by research subagents. Items independently re-checked by the main author are marked in §4.

| Resource | URL | What it established |
|---|---|---|
| Whitechain prize | https://ethglobal.com/events/mumbai/prizes/whitechain | Requirements & deliverables (§11) |
| Uniswap prize | https://ethglobal.com/events/mumbai/prizes/uniswap-foundation | Requirements & deliverables (§11) |
| Whitechain docs index | https://docs.whitechain.io/llms.txt | Doc map |
| Whitechain network | https://docs.whitechain.io/learn/network/testnet.md, https://docs.whitechain.io/learn/network/reference.md | Chain ID, RPC, explorer, WBT, OP Stack Isthmus |
| Whitechain Foundry guide | https://docs.whitechain.io/build/deploy/deploy-with-foundry.md | Blockscout verification flags; suggested `solc`/`evm_version` |
| Whitechain proxy verification | https://docs.whitechain.io/build/deploy/verify-proxy-contracts.md | Listed, **not read** |
| Whitechain token list | https://docs.whitechain.io/build/block-explorer/token-list.md | Lists a **different** USDT (`0xaa79…`, "USDT.e") |
| Whitechain wallets | https://docs.whitechain.io/build/wallet/wallets.md | MetaMask, Rabby, Safe, Reown AppKit; no embedded wallet / AA vendor |
| Whitechain faucet | https://faucet.testnet.whitechain.io/, https://docs.whitechain.io/learn/get-started/get-testnet-wbt.md | WBT only; GitHub login (≥30-day account) + captcha |
| Whitechain Claude skill | https://docs.whitechain.io/build-with-ai/claude-skills.md, https://github.com/whitechain-labs/skills | `whitechain-dev` |
| Whitechain explorer API | https://explorer.testnet.whitechain.io/api/v2/smart-contracts/0x26425662d126412128967ecf0a02ec48573026f7 | USDT implementation verified as `TetherTokenV2` |
| Ankr | https://www.ankr.com/rpc/?utm_referral=Whitechain2026 | RPC entries only; no bundler/paymaster |
| Uniswap AI | https://github.com/Uniswap/uniswap-ai, https://www.skills.sh/uniswap/uniswap-ai, https://www.skills.sh/uniswap/uniswap-ai/swap-integration | Skills, install commands, MIT |
| Uniswap Trading API | https://developers.uniswap.org/docs/trading/swapping-api/supported-chains (+ getting-started, faqs, integration-guide, permit2, no-permit2-workflow) | Supported chains; Whitechain absent; API key required |
| Uniswap deployments | https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments (+ base, unichain, arbitrum; v2, v4), https://developers.uniswap.org/deployments.json | Router/quoter/factory addresses |
| Uniswap contract sources | `Uniswap/universal-router` `contracts/base/Dispatcher.sol`, `contracts/modules/Permit2Payments.sol`; `Uniswap/swap-router-contracts` `contracts/interfaces/IV3SwapRouter.sol`, `contracts/base/MulticallExtended.sol` | Router semantics (§7) |
| Circle USDC | https://developers.circle.com/stablecoins/usdc-contract-addresses | Testnet USDC addresses |
| WhiteSwap (third-party) | https://news.bitcoin.com/whitebit-launches-whiteswap-dex/ | REPORTED as a Uniswap V2 fork |

---

## 3. Skills and tooling matrix

No skill below is installed on the inspecting machine (VERIFIED: `~/.claude/skills`, `~/.agents/skills`, project `.claude/`, `.agents/` absent; plugin cache has no Uniswap/Whitechain entry). Nothing was installed. Each developer must check their own machine.

### 3.1 Agent skills

| Skill | Publisher / source | Install command (verification level) | Supports in THIS repo | Owner | Required? | Installed? | Limitations / prerequisites |
|---|---|---|---|---|---|---|---|
| `whitechain-dev` | Whitechain Labs — https://github.com/whitechain-labs/skills, path `whitechain-dev/SKILL.md`, MIT | `npx skills add whitechain-labs/skills --skill whitechain-dev` (VERIFIED-DOC, claude-skills page) | Chain-1874 network config, Foundry deploy + Blockscout verification (W-08), claiming test WBT (W-02) | Dev A | Recommended | No | Excludes token transfers, swaps, signing, bridging; no USDT/permit/paymaster/EIP-7702 guidance |
| `swap-integration` | Uniswap — https://github.com/Uniswap/uniswap-ai, `packages/plugins/uniswap-trading/skills/swap-integration/SKILL.md`, MIT, v1.6.0 | `npx skills add https://github.com/uniswap/uniswap-ai --skill swap-integration` (VERIFIED-DOC, skills.sh per-skill page). The brief's `npx skills add uniswap/uniswap-ai --skill swap-integration` is INFERRED equivalent, not shown verbatim. Alternative: Claude Code `/plugin marketplace add uniswap/uniswap-ai` → `/plugin install uniswap-trading` (VERIFIED-DOC) | Router choice, approvals, slippage/quote freshness (U-02, U-04) | Dev B | Recommended | No | Its UR address table lists 2.0-era addresses (UR 2.0 sunset effective 2026-10-21); its Solidity example omits `Permit2.approve(token, router, …)` so a contract following it would revert with `payerIsUser=true` (INFERRED from UR source). Trading-API parts need an API key. Expects `viem-integration` |
| `viem-integration` | Uniswap — `packages/plugins/uniswap-viem/skills/viem-integration/SKILL.md`, MIT, v1.0.0 | `npx skills add https://github.com/uniswap/uniswap-ai --skill viem-integration` (INFERRED from per-skill pattern) or `/plugin install uniswap-viem` (VERIFIED-DOC) | viem clients, multi-chain config, reads/writes (S-04, U-04, U-05, W-04) | Both | Optional | No | Generic viem guidance |

Evaluated and **not recommended**: `dca-bot` (off-chain EOA strategy over the Trading API — doesn't fit an on-chain service swap; design reference only), `swap-planner`/`liquidity-planner` (app deep links), `v4-security-foundations` (v4 hooks only).

### 3.2 SDKs, CLIs, services (not skills)

| Item | Type | Use | Owner | Required? | Secret? |
|---|---|---|---|---|---|
| Foundry (`forge`, `cast`) | CLI | Build/test/deploy/verify | Both | Required | No |
| Node 20+ / npm | Runtime | Backend, agents, frontend (Dockerfile pins `node:20-alpine`) | Both | Required | No |
| Docker + Compose | CLI | Local stack | Both | Optional | No |
| PostgreSQL 16 | Service | Shared DB | Dev A (schema) | Required | `DATABASE_URL` server-only |
| viem 2.x | SDK | Already a dependency everywhere | Both | Required | No |
| Whitechain Sepolia RPC `https://rpc.testnet.whitechain.io` | RPC | Reads + relayer broadcasts; 50 req/s/IP | Dev A | Required | No |
| Whitechain Blockscout API `https://explorer.testnet.whitechain.io/api/` | Explorer | Verification, receipts | Dev A | Required | No key |
| Whitechain faucet | Faucet | Test WBT | Dev A | Required | Human GitHub login + captcha |
| Ethereum Sepolia (or Base Sepolia) RPC | RPC | Uniswap track | Dev B | Required | Server-only if keyed |
| Uniswap QuoterV2 (`eth_call`) | Contract | Quotes | Dev B | Required | No |
| Uniswap Trading API | HTTP | Not used by the recommended design | Dev B | Not required | `UNISWAP_API_KEY` server-only if used |
| Circle testnet USDC faucet | Faucet | Test USDC | Dev B | Required | Availability NOT VERIFIED |
| Etherscan API | Explorer | Verify on Sepolia | Dev B | Required for U-03 | `ETHERSCAN_API_KEY` local only |
| Anthropic API, CoinCap | APIs | Existing DCA oracle/blurbs/prices | Dev B | Optional | Server-only |

---

## 4. Network / token / deployment verification matrix

| Fact | Value | Evidence | Re-checked by main author? |
|---|---|---|---|
| Whitechain Sepolia chain ID | 1874 (`0x752`) | VERIFIED-DOC + VERIFIED-RPC | **Yes** |
| Whitechain mainnet chain ID | 1875 | VERIFIED-DOC | No |
| Whitechain RPC | `https://rpc.testnet.whitechain.io`; WS `wss://rpc.testnet.whitechain.io/ws` | VERIFIED-DOC | RPC yes |
| Explorer | `https://explorer.testnet.whitechain.io` (Blockscout) | VERIFIED-DOC | No |
| Native gas asset | WBT, 18 decimals; min base fee 5 gwei; 1 s blocks; `eth_gasPrice` ≈ 5.0 gwei | VERIFIED-DOC, VERIFIED-RPC | No |
| Hard fork | OP Stack Isthmus (Prague/Pectra) on Sepolia | VERIFIED-DOC | No; EIP-7702 **NOT RUN** |
| **Prize USDT** | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` | VERIFIED-DOC (prize page) | — |
| USDT decimals | 6 | VERIFIED-RPC | **Yes** |
| USDT proxy | EIP-1967; impl `0x26425662d126412128967ecf0a02ec48573026f7`; proxy itself not source-verified | VERIFIED-RPC | **Yes** (impl slot) |
| USDT implementation | `TetherTokenV2` (`TetherToken, EIP3009`), source verified on Blockscout | VERIFIED-DOC | No |
| USDT ERC-2612 | `permit` in source/bytecode; `DOMAIN_SEPARATOR()` returns `0xcdcf…2a25`; `nonces()` works; `version()`, `eip712Domain()` revert | VERIFIED-DOC + VERIFIED-RPC | `DOMAIN_SEPARATOR` **yes** |
| USDT EIP-3009 | `transferWithAuthorization`, `receiveWithAuthorization`, `cancelAuthorization` (v/r/s and bytes forms); `authorizationState()` works | VERIFIED-DOC + VERIFIED-RPC | No |
| USDT signed-call success | **NOT RUN.** EIP-712 domain name/version ("Tether USD", "1") INFERRED, not recomputed | — | — |
| USDT blocklist | `addToBlockedList` in source | VERIFIED-DOC | No |
| USDT mint | Owner-only | INFERRED (Tether code) | No |
| Decoy token | `0xaa7962d073935D387e8d442DA1D7149C81388f46` = "Bridged USDT (Whitechain)", `USDT.e`. **Not the prize token** | VERIFIED-RPC (subagent) | No |
| Test USDT source | **Unknown** — faucet gives WBT only | OPEN (B-W1) | — |
| Permit2 on Whitechain Sepolia | Code at canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3`; likely OP Stack preinstall, not a Uniswap deployment (INFERRED) | VERIFIED-RPC | **Yes** |
| ERC-4337 EntryPoint | v0.6, v0.8 present; **v0.7 absent** | VERIFIED-RPC | v0.7 absence **yes** |
| Bundler / paymaster / embedded wallet / x402 facilitator for 1874 | None documented | NOT FOUND | — |
| Uniswap on Whitechain | No official deployment; Trading API unsupported; canonical v3 factory address empty | VERIFIED-DOC / VERIFIED-RPC (subagent) | No |
| WhiteSwap | Uniswap V2 fork on Whitechain; addresses not found | REPORTED | No |
| Ethereum Sepolia SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` | VERIFIED-DOC | **Yes** (code present) |
| Ethereum Sepolia QuoterV2 | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` | VERIFIED-DOC (subagent) | No |
| Ethereum Sepolia v3 Factory | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` | VERIFIED-DOC (subagent) | No |
| Ethereum Sepolia WETH | `0xfff9976782d46cc05630d1f6ebab18b2324d6b14` | VERIFIED-DOC (subagent) | No |
| Ethereum Sepolia USDC (Circle) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | VERIFIED-DOC | **Yes** (is `token0` of pool below) |
| Ethereum Sepolia USDC/WETH 0.05% | `0x3289680dd4d6c10bb19b899729cda5eef58aeff1`; ≈3.18M USDC / ≈129.8 WETH; QuoterV2 1 USDC → ≈0.0000389 WETH (arbitrary testnet price) | VERIFIED-RPC | **Partly** (`liquidity()` non-zero, `token0()` = USDC; balances/quote not re-checked) |
| Base Sepolia alternative | SwapRouter02 `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`, QuoterV2 `0xC5290058841028F1614F3A6F0F5816cAd0df5E27`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, WETH `0x4200000000000000000000000000000000000006`, USDC/WETH 0.3% pool `0x46880b404cd35c165eddeff7421019f8dd25f4ad` (≈15.7k USDC / ≈9.7 WETH) | VERIFIED-DOC / VERIFIED-RPC (subagent) | No |
| Universal Router 2.1.2 | Sepolia `0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3`; Base Sepolia `0x8702463e73f74d0b6765aBceb314Ef07aCb92650` | VERIFIED-DOC (subagent) | No |
| Trading API testnets | Unichain Sepolia (1301), Base Sepolia (84532), Ethereum Sepolia (11155111); not Arbitrum Sepolia, not Whitechain | VERIFIED-DOC (subagent) | No |
| `IV3SwapRouter.ExactInputSingleParams` has no `deadline` | — | VERIFIED-DOC (source; also confirmed by reviewer) | Reviewer |
| Sepolia USDC permit / EIP-3009 | **NOT VERIFIED** | OPEN (B-U1) | — |
| Prior deployments (`contracts/deployments/arbitrum-sepolia.json`) | Previous owner's. **Do not reuse** | VERIFIED-SRC | — |

---

## 5. Recommended architecture and rejected alternatives

### 5.1 Overview (PROPOSED)

```
                     ┌──────────────────── Whitechain Sepolia (1874) ─────────────────────┐
 Payer: seedless ───►│ MeterPayments.pay(...) ──► USDT.receiveWithAuthorization(to=self) │
 key, signs EIP-712  │   (new, verified)          then USDT.transfer(payee)               │
 only, 0 WBT         │   emits PaymentSettled(paymentId, from, payee, value, paramsHash)  │
                     └──────────▲─────────────────────────────────────────────────────────┘
                                │ relayer broadcasts, pays WBT
                       ┌────────┴────────┐  server-only keys (separate):
                       │ backend relayer │  WHITECHAIN_RELAYER_PRIVATE_KEY (WBT only)
                       │ API / indexer / │  EXECUTOR_PRIVATE_KEY (Sepolia ETH)
                       │ executor        │
                       └────────┬────────┘
                                │ Subscriptions.execute() each cycle
                     ┌──────────▼──────────────── Ethereum Sepolia (11155111) ────────────┐
 DCA subscriber ────►│ Subscriptions + UniswapV3SwapService ── exactInputSingle ──►       │
 (Sepolia USDC,      │ SwapRouter02 0x3bFA… → USDC/WETH 0.05% pool 0x3289…               │
 separate balance)   └─────────────────────────────────────────────────────────────────────┘
```

- **Whitechain track:** a paid agent run settled in prize USDT through a small verified `MeterPayments` contract; payer has no WBT, no seed phrase, no network setup. Recurring subscriptions on Whitechain are a stretch (D-W2).
- **Uniswap track:** the DCA swap leg executed against a real Uniswap v3 pool on a Uniswap-supported testnet. **Separate deployment, separate balances, separate transactions; no bridge; no atomic cross-chain flow.**

### 5.2 Whitechain approach comparison

| Approach | Availability on 1874 | Hidden user-gas steps | Verdict |
|---|---|---|---|
| **A. Token-native signed authorization via a Meter contract** — payer signs EIP-3009 `ReceiveWithAuthorization` with `to = MeterPayments`; relayer calls `MeterPayments.pay` | USDT has EIP-3009 (VERIFIED source/selectors; **signed call NOT RUN**); contract is new | None | **Recommended.** `receiveWithAuthorization` requires `msg.sender == to`, so only `MeterPayments` can execute it (no front-running); the authorization nonce binds the payment to a specific `paymentId`/payee on-chain; the demo uses a deployed, verified contract |
| A′. Plain `transferWithAuthorization` EOA→payee | Same | None | Used only for the W-03 smoke test. Rejected for the product flow: a plain `Transfer` log can't be tied to a `payment_id`, and anyone can front-run submission |
| B. Smart account + sponsored execution (ERC-4337 / EIP-7702) | EntryPoint v0.6/v0.8 exist; no bundler/paymaster documented; 7702 INFERRED, untested | None if self-hosted infra works | Rejected for hackathon: self-host bundler + paymaster on undocumented setup |
| C. x402 facilitator | None documented; x402 "exact" EVM scheme is EIP-3009-based | None | Folded into A: the agent's HTTP 402 handshake can carry the A authorization, with the backend as facilitator |
| Permit2 `PermitSingle` alone (current code) | Permit2 deployed | **Yes:** payer must `USDT.approve(Permit2)` (needs WBT) | Rejected as-is; only viable with a relayed ERC-2612 permit first (W-07) |

### 5.3 Uniswap approach comparison

| Approach | Verdict | Reason |
|---|---|---|
| **SwapRouter02 `exactInputSingle` from a new `UniswapV3SwapService`, on Ethereum Sepolia (alt: Base Sepolia)** | **Recommended** (network OPEN, D-U1) | Official, documented; plain ERC-20 approve from the contract; deepest observed pool; no API key |
| Universal Router 2.1.2 `execute` (`V3_SWAP_EXACT_IN`) | Alternative | Preferred entrypoint per docs with native deadline, but a contract caller needs `Permit2.approve(token, UR, …)` on-chain or a pre-transfer; current approve-then-call pattern doesn't work as-is |
| Trading API calldata executed by the contract | Rejected for v1 | Contract-as-swapper not documented; Permit2 signature impossible for a contract without ERC-1271; API key; network dependency per cycle |
| v4 PoolManager / `V4_SWAP` | Rejected | Extra complexity, no need |
| Self-deploy Uniswap v3 on Whitechain | Rejected unless judges confirm (D-U2) | Not official; self-provided (synthetic) liquidity |
| WhiteSwap | Rejected | Not Uniswap; addresses unknown |
| Bridge USDT → Sepolia | Rejected | Not requested; would misrepresent atomicity |

---

## 6. Whitechain implementation plan (PROPOSED)

### 6.1 `MeterPayments` contract (new, Dev A)

**Superseded in detail by ARCHITECTURE.md v2 §4.3** (adds `paramsHash` binding, an exact-amount check, and a creator-signed `refund`). Summary:

```
pay(paymentId, from, payee, value, paramsHash, validAfter, validBefore, signature)
  nonce = keccak256(abi.encode("PAY", paymentId, payee, value, paramsHash, block.chainid, address(this)))
  USDT.receiveWithAuthorization(from, address(this), value, validAfter, validBefore, nonce, signature)
  require(received == value)
  USDT.safeTransfer(payee, value)
  emit PaymentSettled(paymentId, from, payee, value, paramsHash)

refund(paymentId, payee, payer, value, validAfter, validBefore, signature)   // creator-signed, relayed (D-A2)
```

- The payer signs `ReceiveWithAuthorization{from, to=MeterPayments, value, validAfter, validBefore, nonce}`, where the frontend computes `nonce` from the same fields. A relayer cannot change `payee`, `value`, `paymentId`, or the request parameters without invalidating the signature.
- Token address is immutable (prize USDT). No admin withdrawal of user funds; the contract holds nothing between calls.
- The token marks the nonce used, so replay fails on-chain.
- Exact `receiveWithAuthorization` overload (v/r/s vs bytes signature) to be confirmed against the verified implementation source in W-10.

### 6.2 End-to-end journey: one-time paid agent run (primary demo flow)

| Step | What happens | Signs | Broadcasts | Pays WBT | Key owner |
|---|---|---|---|---|---|
| 0. Business setup | Deploy + verify `MeterPayments` (and other Meter contracts) on 1874; fund relayer with WBT; obtain test USDT for the demo payer (**blocked**, B-W1) | Deployer | Deployer | Business | Business, server/local only |
| 1. Onboarding | App creates/uses a **seedless embedded or app-held key** (D-W1). The app defines chain 1874 itself, so the payer never adds a network. **Injected wallets (MetaMask etc.) are only a fallback:** MetaMask rejects `eth_signTypedData_v4` when `domain.chainId` ≠ active chain, so those users would see an add/switch-network prompt | — | — | — | Payer |
| 2. Session | Backend nonce (crypto-random) → payer signs login message → session issued (P-01) | Payer | — | — | — |
| 3. Funding | Payer receives test USDT from the business/demo distributor | Distributor | Distributor | Distributor | Business |
| 4. Quote | `POST /payments/quote` returns `{payment_id, token, to=MeterPayments, payee, value, validAfter, validBefore, nonce, typedData}`; `payment_id` stored with the agent, params hash, and price | — | — | — | — |
| 5. Authorization | Payer signs the `ReceiveWithAuthorization` typed data (domain chainId 1874) | Payer | — | — | — |
| 6. Verification | Backend checks session address == `from`; fields match the stored quote; `validBefore` in window; `authorizationState(from, nonce) == false`; USDT balance ≥ value; `eth_call` simulation of `MeterPayments.pay` succeeds | — | — | — | — |
| 7. Settlement | Relayer calls `MeterPayments.pay(...)` (fixed function, fixed contract) | — | Relayer | **Business** | Relayer key |
| 8. Confirmation | Backend waits for receipt; requires `PaymentSettled(paymentId, from, payee, value, paramsHash)` from the `MeterPayments` address in that receipt plus K confirmations (D-A4); marks `payment_id` confirmed | — | — | — | — |
| 9. Delivery | Backend dispatcher calls the worker with a **dispatch envelope signed by Meter's fund-less dispatch key** (ARCHITECTURE.md §5.2) containing `{payment_id, tx_hash, params, paramsHash}`; worker verifies the signature, `paramsHash`, and the matching `PaymentSettled` event for **its** payee and price, then stores `payment_id` as consumed. Without the signature, anyone watching the chain could claim the result first | — | — | — | Agent |
| 10. Receipt | API returns result + `https://explorer.testnet.whitechain.io/tx/<hash>`; run recorded once (unique on chain + tx + log index) | — | — | — | — |

USDT recipient (`payee`): creator payout address or agent `Service` contract (D-W3). Platform cut removed or made explicit (D-W4).

### 6.3 Optional: gasless subscriptions on Whitechain (D-W2, stretch)

1. Payer signs ERC-2612 `permit(owner, spender=Permit2, value, deadline)` for USDT; relayer submits it (removes the hidden approve). ERC-2612 nonces are sequential per owner, so permits must be requested and submitted one at a time per user. Submission is wrapped so that if someone else already used the permit (front-run grief), the relayer checks the resulting allowance instead of failing.
2. Payer signs Permit2 `PermitSingle` (spender `Subscriptions`, amount = per-cycle × cycles, expiry).
3. Payer signs a Meter EIP-712 intent `Subscribe{subscriber, service, token, amountPerCycle, interval, permitHash, nonce, deadline}`.
4. Relayer calls a **new** `Subscriptions.subscribeWithSig(...)` that verifies step 3 before forwarding the Permit2 permit; matching `cancelWithSig`.

Without step 3, a relayer could attach a user's allowance to a different service.

### 6.4 Protections (PROPOSED; each tested in §10)

| Threat | Protection |
|---|---|
| Unauthorized spending | Only payer-signed authorizations move USDT; payee/value/paymentId bound into the signed nonce and checked on-chain by `MeterPayments` |
| Replay | Token-level single-use nonces; DB unique `(chain_id, token, from_address, auth_nonce)`; worker-side consumed `payment_id`/tx store; short `validBefore` |
| Concurrent requests | `payment_id` state machine (`quoted → submitted → confirmed/failed`) with conditional updates; one relayer sender with a serialized nonce queue |
| Duplicate settlement | Idempotency key = `payment_id`; if a broadcast reverts because the authorization was used, reconcile by reading `authorizationState` and logs instead of retrying; worker called at most once per confirmed `payment_id` |
| Front-running | `receiveWithAuthorization` only executable by `MeterPayments` (`msg.sender == to`) |
| Arbitrary relay calls | Relayer exposes only fixed call builders (`MeterPayments.pay`, and for stretch `USDT.permit`, `subscribeWithSig`, `cancelWithSig`) against manifest-allowlisted addresses; never forwards client calldata |
| Gas-budget exhaustion | Seedless keys are free to create, so per-address caps are Sybil-weak. Real backstops: **global daily relay cap**, **minimum payment value well above gas cost**, authenticated session, per-session and per-IP rate limits, pre-broadcast simulation, max gas price, **reverted relays count against the payer/session**, relayer key holds only WBT, balance alert. The payer can still cause a revert between simulation and inclusion (moving funds, `cancelAuthorization`); the global cap bounds that loss |
| Stuck transactions | Nonce queue supports fee bump / replacement and timeouts |
| Blocklisted payer | Simulation fails → reject before broadcast |

How the relayer gets WBT: Whitechain faucet (GitHub login + captcha; amount/cooldown inconsistent, B-W2) plus business top-ups. Per-payment cost estimate: `MeterPayments.pay` (authorization + transfer) ≈ 100–130k gas × 5 gwei ≈ 0.0005–0.00065 WBT (**INFERRED estimate, NOT RUN**).

### 6.5 Contract vs backend changes (Whitechain)

| Change | Where | Type |
|---|---|---|
| `MeterPayments.sol` + tests (new) | `contracts/src/MeterPayments.sol`, `contracts/test/MeterPayments.t.sol` | Contract |
| Deploy + verify on 1874 (docs suggest `solc = "0.8.30"`, `evm_version = "prague"` — **PROPOSED**; today `foundry.toml` pins neither and sources use `^0.8.24`) | `contracts/script/DeployWhitechain.s.sol` (new); Whitechain rpc/verifier entries in `contracts/foundry.toml` (requested from Dev B) | Deploy |
| `subscribeWithSig` / `cancelWithSig` (stretch) | `contracts/src/Subscriptions.sol`, `contracts/test/Subscriptions.t.sol` | Contract |
| Relayer, payments table/API | `backend/src/relayer/` (new), `backend/src/api/routes/payments.ts` (new), `backend/src/db/` | Backend |
| Replace Permit2 one-time invoke | `backend/src/api/routes/marketplace.ts`, `backend/src/agent-invoke/invoke.ts` | Backend |
| Worker verifies `PaymentSettled`, not `X-Payment` JSON | `agents/agent_risk_analyzer/src/x402/` | Agent |
| Chain 1874, seedless wallet, EIP-712 signing | `frontend/lib/wagmi.ts`, `frontend/components/Web3Provider.tsx`, `frontend/lib/store.tsx`, `frontend/lib/useSubscribeOnChain.ts`, `frontend/app/agents/[id]/page.tsx` | Frontend |

---

## 7. Uniswap implementation plan (PROPOSED)

### 7.1 Network

Official Uniswap swaps cannot run on Whitechain (§4). The smallest honest alternative is to run the DCA swap leg on **Ethereum Sepolia**, which has the deepest observed pool and Trading API support. Base Sepolia is the backup; the choice is still open (D-U1).

State these consequences in the README and demo:
- The DCA subscriber holds **Sepolia USDC** plus Sepolia ETH for gas. This balance is separate from their Whitechain USDT.
- Subscribing and cancelling on Sepolia are not gas-sponsored in this plan.
- Not atomic and no bridge.
- Testnet prices are arbitrary.
- The subscriber receives **WETH**, not ETH. Label it in the UI and README, or add unwrapping (stretch).

### 7.2 Concrete swap flow (one DCA cycle)

| Item | Design |
|---|---|
| Caller | Executor EOA calls `Subscriptions.execute(id, params)` (existing) |
| Funding of the service | `Subscriptions` pulls `amountPerCycle` USDC from the subscriber via Permit2 into the service (existing) |
| Service contract | **New** `UniswapV3SwapService` (extends `Service`), replacing `SIPService`'s arbitrary `aggregator.call` |
| Fee | `feeAmount = amount × fee / 10_000`, capped by `maxFeeAmount` if non-zero. The fee stays in the contract and `withdraw()` sweeps it to `feeReceiver`. **amountIn = amount − feeAmount** |
| Approval | `USDC.forceApprove(SwapRouter02, amountIn)`, then reset to 0 (plain ERC-20, no Permit2) |
| Call | `SwapRouter02.exactInputSingle({tokenIn, tokenOut, fee: poolFee, recipient: address(this), amountIn, amountOutMinimum, sqrtPriceLimitX96: 0})` |
| Deadline | `ExactInputSingleParams` has **no deadline**. Use an explicit `require(block.timestamp <= deadline)` in the service (preferred over wrapping in `multicall(deadline, …)`) |
| On-chain constraints | `tokenOut` and `poolFee` checked against owner-set allowlists; `recipient` fixed by the contract; router set at construction |
| Executor-supplied params | ABI-encoded `(tokenOut, poolFee, amountOutMinimum, deadline)` only, never raw calldata |
| Output | Measure the `tokenOut` balance delta, require `≥ amountOutMinimum`, transfer to the subscriber, emit `SwapExecuted(subscriber, tokenIn, tokenOut, amountIn, amountOut, fee)` |
| Quote | Off-chain QuoterV2 `quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, 0))` on the **post-fee amountIn**. Compute it by reading the service's `fee()` and `maxFeeAmount()` on-chain at quote time. Re-quote if `fee` changed, since the owner can call `setFee` between quote and execute |
| Slippage | `amountOutMinimum = quote × (10_000 − slippageBps) / 10_000`. `slippageBps` is clamped to [25, 200] (existing clamp in `agents/agent_dca/src/agent/claude.ts`) and is never 0 |
| Quote age / deadline | Quote ≤ 30 s old at broadcast (Uniswap guidance); deadline window set by D-U4 |
| Decimals | Read `decimals()` per token into the chain registry; remove hardcoded 6/18 |
| Recorded amounts | The indexer takes `amountOut` from `SwapExecuted` in the confirmed receipt. The executor never writes quotes as outputs |
| Cancellation / expiry | Unchanged on-chain; the executor skips expired subscriptions; the indexer reconciles `SubscriptionCancelled` |
| Reconciliation | In-flight guard per subscription; serialized nonce; idempotent run insert on `(chain_id, tx_hash, log_index)`; usage derived from runs |
| Trust assumption | The executor chooses `amountOutMinimum` (no on-chain oracle). Documented limitation |

### 7.3 Contract vs backend changes (Uniswap)

| Change | Where | Type |
|---|---|---|
| `UniswapV3SwapService.sol` + minimal router/quoter interfaces | `contracts/src/` (new files) | Contract |
| `ServiceDeployer.deployUniswapService`, `ServiceFactory.createUniswapSwapService` (factory stays < 24 KB) | `contracts/src/ServiceDeployer.sol`, `ServiceFactory.sol` | Contract |
| Fork tests | `contracts/test/UniswapV3SwapService.t.sol` (new) | Test |
| Deploy script + manifest | `contracts/script/DeployUniswapTestnet.s.sol` (new), `contracts/deployments/<network>.json` (new) | Deploy |
| Quoter-based decision; remove unsigned `X-Payment` drain | `agents/agent_dca/src/x402/server.ts`, `agents/agent_dca/src/contracts/index.ts` | Agent |
| Executor params, deadlines, nonce queue, in-flight guard, bounded allowance | `backend/src/executor/`, `backend/src/scheduler/`, `backend/src/x402/client.ts` (Dev A file; change requested) | Backend |
| Index `SwapExecuted`; dedupe | `backend/src/indexer/indexer.ts` | Backend |

### 7.4 Uniswap submission deliverables (VERIFIED-DOC)

- A public open-source repo.
- `FEEDBACK.md` in the repo.
- The completed Uniswap Developer Feedback Form at `developers.uniswap.org/hackathon-feedback`, including the FEEDBACK.md link.
- A README that points to the exact contracts and lines using Uniswap.

No video is listed. The exact wording on what happens to submissions missing items is OPEN (B-U2).

---

## 8. Developer ownership and shared interface contract

**Status: PROPOSED.** Neither developer has accepted it yet. Their names are unknown, so they are called Dev A and Dev B.

### 8.1 Exclusive file ownership

Only the owner edits a file. The other developer requests changes in a PR comment or issue.

| Area | Dev A — Whitechain payments | Dev B — Uniswap DCA |
|---|---|---|
| Contracts | `contracts/src/Subscriptions.sol`, `contracts/src/MeterPayments.sol` (new); `contracts/test/Subscriptions.t.sol`, `contracts/test/MeterPayments.t.sol` (new); `contracts/script/DeployWhitechain.s.sol` (new); `contracts/deployments/whitechain-sepolia.json` (new) | `contracts/src/Service.sol`, `SIPService.sol`, `ServiceDeployer.sol`, `ServiceFactory.sol`, `ERC8004*.sol`, `UniswapV3SwapService.sol` (new), `contracts/src/interfaces/**`; all other `contracts/test/**` and `test/mocks/**`; `contracts/foundry.toml`, `remappings.txt`, `contracts/lib/`; other `contracts/script/**`; `contracts/deployments/<uniswap-network>.json` (new) |
| Backend | `backend/src/api/**` **except** `api/chain.ts`; `backend/src/agent-invoke/`; `backend/src/x402/`; `backend/src/relayer/` (new); `backend/src/db/**` (schema/migrations/seed); `backend/src/contracts/**` (ABI copies); `backend/package.json` + `package-lock.json`; `backend/Dockerfile`, `docker-entrypoint.sh`, `backend/scripts/` (new) | `backend/src/config.ts`, `backend/src/chain/client.ts`, `backend/src/api/chain.ts`, `backend/src/index.ts`; `backend/src/executor/`, `backend/src/scheduler/`, `backend/src/indexer/`; `backend/src/utils/`, `backend/src/prices/`, `backend/src/logger.ts`, `backend/src/errors.ts` |
| Agents | `agents/agent_risk_analyzer/**` | `agents/agent_dca/**`; `agents/README.md` |
| Frontend | `frontend/package.json` + lockfile; `frontend/lib/wagmi.ts`, `contracts.ts` (ABIs/addresses), `store.tsx`, `useSubscribeOnChain.ts`, `useFaucet.ts`, `useWithdraw.ts`, `gas.ts`, `lib/api/**` (`client.ts`, `endpoints.ts`, `hooks.ts`, `types.ts`, `format.ts`); `frontend/components/**`; `frontend/app/layout.tsx`, `app/page.tsx`, `app/agents/[id]/page.tsx`, `app/docs/**`, `app/creator/page.tsx`, `app/creator/earnings/page.tsx`; `frontend/Dockerfile`, `next.config.ts`, `vercel.json` | `frontend/app/creator/register/page.tsx`, `frontend/app/subscriptions/page.tsx` |
| Root | `README.md`, `docker-compose.yml`, `docker-compose.agents.yml`, `.env.example` files, `WHITECHAIN_FEEDBACK.md`, `docs/evidence/` layout (new), `docs/interfaces/**` (new: dispatch-envelope spec and test vectors), `ops/runbooks.md` (new; Dev B contributes sections by PR), `ARCHITECTURE.md` | `FEEDBACK.md`; this file's §7 and Uniswap rows (Dev A owns the rest of this document) |
| Added by I-tasks | `backend/src/relayer/**` incl. `main.ts`, `txManager.ts`; `backend/src/api/dispatch/**`; `agents/agent_risk_analyzer/src/dispatch/**` | `backend/src/utils/egress.ts`; `agents/agent_dca/src/dispatch/**`; indexer finality code |

### 8.2 Shared interfaces (one owner each)

| Interface | Owner | Contract |
|---|---|---|
| Deployment manifest JSON | Dev B defines the schema; each developer fills their own file | `{ chainId, network, commit, deployedAtBlock, contracts: { <Name>: { address, txHash, verifiedUrl } }, tokens: { <SYMBOL>: { address, decimals } } }`. Only addresses with a verified explorer URL go in. Handover is a merged PR; consumers read the manifest and never hand-copy addresses |
| Chain registry type (`backend/src/config.ts`) | Dev B | `ChainConfig { chainId, name, rpcUrl, explorerTxUrl, nativeSymbol, manifestPath }`, plus per-process key getters. A process loads only the keys it uses |
| DB schema + migrations | Dev A | Versioned, forward-only migrations with no `DROP` outside a reviewed migration, run by a one-shot job. Dev B requests columns by issue; Dev A lands them in S-05 |
| Payments API `/api/v1/payments/*` and `PaymentSettled` event | Dev A | `POST /payments/quote`, `POST /payments/:id/authorize {signature}`, `GET /payments/:id` (§6.2) |
| `SwapExecuted` event | Dev B | Indexed by Dev B. Dev A surfaces it in API serializers on request |
| Dispatch envelope (`docs/interfaces/dispatch-envelope.md` + `.vectors.json`) | Dev A | Format fixed in I-1. Both agents' verifiers must pass the shared vectors. Format changes bump `v` and update the vectors in the same PR |
| `safeFetch` / `validateEndpoint` (`backend/src/utils/egress.ts`) | Dev B | Used by Dev A's dispatcher and registration route and by Dev B's executor. Signature changes are announced in the PR |
| Frontend API types (`frontend/lib/api/types.ts`) | Dev A | Dev B proposes additions in their PR description |
| ABIs | Each contract owner exports from `contracts/out`. Dev A copies them into `frontend/lib/contracts.ts` and `backend/src/contracts/abis/` | ABI changes are announced in the PR that changes the contract. The **factory ABI is frozen at CP3** |

### 8.3 Parallelism, checkpoints, conflict rules

- **Can start immediately after S-01:**
  - Dev A: W-02 (relayer key + faucet), W-10 (MeterPayments contract + local and fork tests, once S-03's library install lands), S-02, S-05, I-1 steps 1–2 (envelope spec and vectors).
  - Dev B: S-03, U-02 (fork tests), S-04, I-3 (egress guard).
- **W-03 is BLOCKED** on test USDT (B-W1); it starts as soon as that is resolved.
- **Merge checkpoints (PROPOSED):**
  - CP1: S-01 accepted; S-02 and S-03 green.
  - CP2: U-02 and W-10 green; W-03 done, or still recorded as blocked.
  - CP3: S-04, S-05, I-3 and the I-1 envelope spec merged; factory **and `Subscriptions`** ABIs frozen (the latter changes only if D-A6 = contract change).
  - CP4: each track end-to-end on its own network.
  - CP5: README, feedback files, video.
- **W-08 deploys from a tagged commit after CP3**, so the Whitechain deployment never picks up an in-progress factory change.
- **Conflict rules:**
  - Never edit a file the other developer owns.
  - Keep PRs small (< ~400 lines) and rebased on `main`.
  - Lockfiles change only in the manifest owner's own PRs.
  - When two PRs touch a shared interface, the interface owner's PR merges first.

---

## 9. Dependency-ordered task tracker

Statuses: TODO / IN PROGRESS / BLOCKED / VERIFIED. **Every task is TODO or BLOCKED. Nothing is VERIFIED.** "Waits on" names any upstream task that is itself BLOCKED.

### Shared and prerequisite

**S-01 — Accept ownership split and interface contract**
- **Owner:** Dev A + Dev B.
- **Goal:** Agree to §8, or amend it.
- **Inspect:** §8 of this file.
- **Depends on:** none.
- **Unresolved:** developer names; D-S1 to D-S4.
- **Skills/tools:** none.
- **Steps:**
  1. Review §8.
  2. Amend it if needed.
  3. Record names and date in §13.
- **Acceptance:** both names are recorded in §13.
- **Verification A:** the §13 entry exists.
- **Verification B:** each developer names three files they own and three they don't, and both lists match §8.1.
- **Evidence:** §13.
- **Status:** **TODO**.

**S-02 — JS baseline**
- **Owner:** Dev A.
- **Goal:** reproducible installs and a passing typecheck/build before any change.
- **Inspect:** all `package.json` / `package-lock.json`, `backend/tsconfig.json`, `agents/*/tsconfig.json`, `frontend/next.config.ts`.
- **Depends on:** S-01.
- **Unresolved:** D-S2.
- **Skills/tools:** Node 20+, npm.
- **Steps:**
  1. Run `npm ci` in `backend/`, `agents/agent_dca/`, `agents/agent_risk_analyzer/` and `frontend/`.
  2. Run `npm run typecheck` in `backend`.
  3. Run `npx tsc --noEmit` in each agent.
  4. Run `npm run build` in `frontend`.
  5. Add the chosen test runner and a `test` script to `backend/package.json`.
- **Acceptance:** all steps succeed on a clean checkout.
- **Verification A:** saved command logs.
- **Verification B:** Dev B reproduces the steps on their own machine from the written steps alone.
- **Evidence:** `docs/evidence/S-02/` (new).
- **Status:** **TODO**.

**S-03 — Foundry baseline and unskipped tests**
- **Owner:** Dev B; Dev A fixes `test/Subscriptions.t.sol`.
- **Goal:** `forge build` works and the real tests run.
- **Inspect:** `contracts/foundry.toml` (`skip`), `remappings.txt`, `contracts/test/*.t.sol`, `test/mocks/Mocks.sol`.
- **Depends on:** S-01.
- **Unresolved:** pinned OpenZeppelin and forge-std versions.
- **Skills/tools:** Foundry.
- **Steps:**
  1. Install `openzeppelin-contracts` and `forge-std` into `contracts/lib` at pinned versions.
  2. Remove the `skip` list.
  3. Dev B fixes `SIPService.t.sol` and both `ERC8004*.t.sol`.
  4. Dev A fixes `Subscriptions.t.sol`.
- **Acceptance:** `forge test` runs all four files with 0 failures.
- **Verification A:** `forge test -vv` log.
- **Verification B:** a deliberately broken assertion makes the suite fail, which proves the tests aren't skipped; then revert it.
- **Evidence:** `docs/evidence/S-03/` (new).
- **Status:** **TODO**.

**S-04 — Chain registry and per-process keys**
- **Owner:** Dev B for the registry. Dev A applies it in the files they own (`marketplace.ts`, `api/routes/config.ts`, risk agent, Compose) as **S-04b**.
- **Goal:** multi-chain config, with each process requiring only its own secrets.
- **Inspect:** `backend/src/config.ts`, `chain/client.ts`, `api/chain.ts`, `index.ts`, `agents/*/src/chain/client.ts`, `agents/*/src/config.ts`, `docker-compose*.yml`.
- **Depends on:** S-02.
- **Unresolved:** D-S4.
- **Skills/tools:** viem; `viem-integration` (optional).
- **Steps:**
  1. Implement `ChainConfig` (§8.2), loading addresses from the manifests.
  2. Define chain 1874 with `defineChain`, using WBT as the native currency and the official RPC.
  3. Remove the private key from the indexer.
  4. Lazy per-role key getters.
  5. S-04b: the API holds **no funded key** (only the fund-less `DISPATCH_SIGNING_KEY`); the relayer runs as its own single-instance process with `WHITECHAIN_RELAYER_PRIVATE_KEY` (ARCHITECTURE.md v2, decision A6); Compose gives separate keys per service.
- **Acceptance:** the indexer and API start with no executor key; the executor fails fast without its own key.
- **Verification A:** start each process with minimal env and check the logs.
- **Verification B:** start the indexer with a key present and confirm through code review and logs that it never constructs a wallet client.
- **Evidence:** `docs/evidence/S-04/` (new).
- **Status:** **TODO**.

**S-05 — Versioned, non-destructive migrations and idempotency constraints**
- **Owner:** Dev A.
- **Goal:** safe schema changes and dedupe at the database level.
- **Inspect:** `backend/src/db/schema.sql`, `migrate.ts`, `seed.ts`, `docker-entrypoint.sh`, `backend/Dockerfile`, `docker-compose.yml`.
- **Depends on:** S-02.
- **Unresolved:** migration tool (plain SQL files or a library).
- **Skills/tools:** PostgreSQL 16, `psql`.
- **Steps:**
  1. Move to numbered migrations plus a `schema_migrations` table.
  2. Take `DROP` out of the boot path.
  3. Run migrations from a single one-shot Compose service; the entrypoint stops migrating.
  4. Add `runs.chain_id`, `runs.log_index`, and a unique `(chain_id, tx_hash, log_index)`.
  5. Add a `payments` table with unique `payment_id` and `(chain_id, token, from_address, auth_nonce)`.
  6. Add `runs.payment_id`; `agents.chain_id` with unique `(chain_id, onchain_agent_id)` and `agents.payout_address`; `subscriptions.chain_id` with unique `(chain_id, onchain_sub_id)`; `withdrawals.chain_id`/`log_index`.
  7. Add a `relayer_usage` table for the D-W5 caps, and a per-chain indexer checkpoint key `last_processed_block:<chainId>` (ARCHITECTURE.md §7).
- **Acceptance:** migrations apply exactly once, and the executor and indexer no longer migrate.
- **Verification A:** apply twice on a fresh DB; the second run is a no-op.
- **Verification B:** inserting duplicate run or payment rows raises a constraint error.
- **Evidence:** `docs/evidence/S-05/` (new).
- **Status:** **TODO**.

**P-01 — Real authenticated session**
- **Owner:** Dev A.
- **Goal:** identity comes from a session, not the request body.
- **Inspect:**
  - Backend: `backend/src/api/routes/auth.ts`, `user.ts`, `creator.ts`, `subscriptions.ts`, `marketplace.ts`.
  - Frontend: `frontend/lib/api/client.ts`, `endpoints.ts`, `frontend/lib/store.tsx`.
- **Depends on:** S-05.
- **Unresolved:** D-S1.
- **Skills/tools:** Express middleware, viem `recoverMessageAddress`.
- **Steps:**
  1. Generate a crypto-random nonce.
  2. Issue a session after `/auth/verify`.
  3. Middleware sets `req.user`.
  4. Mutating routes ignore any body `user_address`.
  5. The frontend runs nonce → sign → verify on connect.
- **Acceptance:** mutating routes require a session, and `/creator/agents/update` rejects non-owners.
- **Verification A:** an API test where a valid session updates its own agent.
- **Verification B:** a forged body address with another user's session gets 401/403.
- **Evidence:** `docs/evidence/P-01/` (new).
- **Status:** **TODO**.

**P-02 — Accounting dedupe and actual received amounts**
- **Owner:** Dev B.
- **Goal:** one run per on-chain execution, recording real output amounts.
- **Inspect:** `backend/src/executor/executor.ts` (`recordRun`), `backend/src/indexer/indexer.ts` (`Executed` handler).
- **Depends on:** S-05 for the constraints; U-03 for the `SwapExecuted` part.
- **Unresolved:** none.
- **Skills/tools:** viem `getLogs`, PostgreSQL.
- **Steps:**
  1. Make the indexer the single writer of runs, keyed on `(chain_id, tx_hash, log_index)`.
  2. The executor logs attempts only.
  3. Increment `usage_count` in the same idempotent statement, or derive it from runs.
  4. Take outputs from `SwapExecuted`.
- **Acceptance:** one execution produces exactly one run and +1 usage.
- **Verification A:** run an execution and read back the DB.
- **Verification B:** replay the same block range; no new rows appear and usage is unchanged.
- **Evidence:** `docs/evidence/P-02/` (new).
- **Status:** **TODO**.

**P-03 — Scheduler overlap guard and nonce serialization**
- **Owner:** Dev B.
- **Goal:** no overlapping cycles, no nonce collisions, no double agent payments.
- **Inspect:** `backend/src/scheduler/scheduler.ts`, `backend/src/executor/executor.ts`.
- **Depends on:** S-04.
- **Unresolved:** none.
- **Skills/tools:** viem nonce management.
- **Steps:**
  1. Skip a tick while the previous one is running.
  2. Keep a per-subscription in-flight set.
  3. Send everything through one nonce manager with fee-bump support.
  4. Allow at most one decision call per subscription per cycle.
- **Acceptance:** with a tick shorter than transaction latency, there is at most one `execute` and one decision per due cycle.
- **Verification A:** a test with a slow mocked receipt and a 5 s tick.
- **Verification B:** two subscriptions due at once produce consecutive nonces and both transactions are mined.
- **Evidence:** `docs/evidence/P-03/` (new).
- **Status:** **TODO**.

**P-04 — Remove the unsigned X-Payment drain from the DCA agent path**
- **Owner:** Dev B. Dev A makes the matching change in `backend/src/x402/client.ts` on request.
- **Goal:** nobody can make the agent pull funds without the payer's signature.
- **Inspect:** `agents/agent_dca/src/x402/server.ts` (`/v1/decide`), `backend/src/x402/client.ts` (`ensureAllowance`, `decide`).
- **Depends on:** S-02.
- **Unresolved:** D-U3 (keep the paid decision or make it internal), which changes the method, not the need.
- **Skills/tools:** viem.
- **Steps:**
  - If unpaid: authenticate the executor (shared HMAC or mTLS) and remove `transferFrom`.
  - If paid: require a signed payment, never a standing `maxUint256` allowance.
  - Either way, revoke the existing max approvals in the deploy runbook.
- **Acceptance:** a request carrying another address's `from` moves no funds.
- **Verification A:** a legitimate executor call succeeds.
- **Verification B:** posting `X-Payment {from: executor}` from an outside client moves no funds and returns 401/402.
- **Evidence:** `docs/evidence/P-04/` (new).
- **Status:** **TODO**.

### Whitechain track (Dev A)

**W-01 — Seedless onboarding decision**
- **Owner:** Dev A.
- **Goal:** decide D-W1, with evidence.
- **Inspect:** `frontend/lib/wagmi.ts`, `frontend/components/Web3Provider.tsx`, the Whitechain wallets doc.
- **Depends on:** S-01.
- **Unresolved:** **D-W1**.
- **Skills/tools:** vendor docs; viem `privateKeyToAccount` / `signTypedData`.
- **Steps:**
  1. Timebox an evaluation of:
     - (a) an embedded-wallet vendor with documented custom-EVM-chain support that works for chain 1874;
     - (b) an app-held key (passkey-protected if feasible).
  2. Confirm that injected wallets require a network prompt (MetaMask chainId check).
  3. Record the choice.
- **Acceptance:** the decision is recorded with the vendor documentation URL, or with an explicit fallback and its limitations. The primary path signs typed data for chainId 1874 with no network prompt.
- **Verification A:** a prototype signature works in a fresh browser profile.
- **Verification B:** the reviewer confirms no seed phrase and no network prompt; MetaMask fallback behaviour is documented.
- **Evidence:** `docs/evidence/W-01/` (new).
- **Status:** **BLOCKED** (D-W1).

**W-02 — Relayer key, funding, budget policy**
- **Owner:** Dev A.
- **Goal:** a new relayer key holding only WBT, with caps.
- **Inspect:** `.env.example`, `docker-compose.yml`.
- **Depends on:** S-01.
- **Unresolved:** D-W5, B-W2.
- **Skills/tools:** `whitechain-dev` (claiming testnet WBT), `cast wallet new`.
- **Steps:**
  1. Generate a fresh key. Never reuse the old `PRIVATE_KEY`.
  2. A human claims WBT from the faucet (GitHub login and captcha).
  3. Record the amount actually received.
  4. Write caps and the "how the relayer gets WBT / what prevents draining it" text.
- **Acceptance:** the relayer holds WBT, and the caps are documented.
- **Verification A:** an explorer link to the funding transaction.
- **Verification B:** an over-cap rejection, exercised in W-04.
- **Evidence:** `docs/evidence/W-02/` (new).
- **Status:** **TODO**.

**W-03 — Smoke test: standalone gasless USDT transfer**
- **Owner:** Dev A.
- **Goal:** prove that the prize USDT accepts a relayed EIP-3009 authorization from a payer with 0 WBT.
- **Inspect:** the USDT implementation source on Blockscout (`TetherTokenV2`, `EIP3009`).
- **Depends on:** W-02. **Blocked by B-W1.**
- **Unresolved:** EIP-712 domain fields.
- **Skills/tools:** viem `signTypedData`; `whitechain-dev`.
- **Steps:**
  1. Write a script in `backend/scripts/` (new).
  2. Build the domain and recompute `DOMAIN_SEPARATOR`, comparing it with the on-chain value.
  3. The test payer signs `TransferWithAuthorization`.
  4. The relayer broadcasts.
- **Acceptance:**
  - receipt status success;
  - a `Transfer` log from `0xcedf…`;
  - payer WBT stays at 0.
- **Verification A:** the receipt, explorer link, and before/after balances.
- **Verification B:** replaying the same authorization reverts (`authorizationState` is true), and a tampered `value` fails in simulation.
- **Evidence:** `docs/evidence/W-03/` (new).
- **Status:** **BLOCKED** (B-W1).

**W-10 — `MeterPayments` contract**
- **Owner:** Dev A.
- **Goal:** the `pay` path of the contract in ARCHITECTURE.md §4.3, binding `paymentId`/payee/value/`paramsHash` into the authorization, with an exact-amount check. The `refund` path is I-4b.
- **Inspect:** the USDT implementation source (`receiveWithAuthorization` overloads and its `msg.sender == to` check), `contracts/src/Service.sol` (for style).
- **Depends on:** S-03 (library install).
- **Unresolved:** which signature overload to use (v/r/s or bytes).
- **Skills/tools:** Foundry; an anvil/forge fork of Whitechain Sepolia for tests.
- **Steps:**
  1. Write the contract, recording `settled[paymentId] = (from, payee, value)` for I-4b.
  2. Unit tests with a mock EIP-3009 token.
  3. A fork test against `0xcedf…`: impersonate an existing USDT holder (`vm.prank`/`vm.startPrank` on the fork; INFERRED to work with the proxy) to fund a test payer. This does **not** need B-W1; only the live testnet demo does.
  4. Read the verified `TetherTokenV2` source to confirm the `msg.sender == to` check.
- **Acceptance:** valid payments settle and emit `PaymentSettled(paymentId, from, payee, value, paramsHash)`.
- **Verification A:** a passing happy-path test (unit and fork).
- **Verification B:**
  - a changed payee, value, paymentId or paramsHash fails;
  - a replay fails;
  - calling the token's `receiveWithAuthorization` directly from an EOA with the payer's signature reverts.
- **Evidence:** `docs/evidence/W-10/` (new).
- **Status:** **TODO**.

**W-04 — Backend relayer and payments API**
- **Owner:** Dev A.
- **Goal:** the §6.4 protections, in a production shape.
- **Inspect:** `backend/src/api/app.ts`, `backend/src/x402/client.ts`, `backend/src/agent-invoke/invoke.ts`.
- **Depends on:** W-10, S-05, P-01, S-04b, I-2 (relayer process and transaction manager). **Waits on:** W-03 (B-W1) for live settlement; can be built against a fork until then.
- **Unresolved:** D-W5.
- **Skills/tools:** viem, PostgreSQL.
- **Steps:**
  1. Fixed call builders and an allowlist in `backend/src/relayer/`.
  2. A `payments` state machine.
  3. Caps and rate limits.
  4. Simulation before broadcast.
  5. A reconcile path.
  6. A nonce queue with fee bump.
- **Acceptance:** every §6.4 row is implemented.
- **Verification A:** the happy-path API test settles one payment.
- **Verification B:**
  - 10 concurrent `authorize` calls produce exactly 1 broadcast;
  - an over-cap request is rejected;
  - no API input can choose the call target.
- **Evidence:** `docs/evidence/W-04/` (new).
- **Status:** **TODO** (waits on BLOCKED W-03 for its live run).

**W-05 — One-time agent run over `MeterPayments` (primary demo)**
- **Owner:** Dev A.
- **Goal:** replace the Permit2 invoke and the unsigned `X-Payment` with the §6.2 flow.
- **Inspect:**
  - Backend: `backend/src/api/routes/marketplace.ts` (`/:agent_id/invoke`), `backend/src/agent-invoke/invoke.ts`.
  - Agent: `agents/agent_risk_analyzer/src/x402/server.ts`.
  - Frontend: `frontend/lib/store.tsx` (`runOneTime`), `frontend/lib/useSubscribeOnChain.ts` (`useOneTimePermit`), `frontend/app/agents/[id]/page.tsx`.
- **Depends on:** W-04, W-06, I-1 (signed dispatch), I-3 (egress guard), I-4a (preflight).
- **Unresolved:** D-W3, D-W4.
- **Skills/tools:** viem, wagmi.
- **Steps:**
  1. The frontend runs quote → sign → authorize → poll.
  2. The worker verifies `PaymentSettled` for its own payee and price, and records the `payment_id` as consumed.
  3. Remove or disclose the `agent_invoke_fee` split.
- **Acceptance:** a payer with 0 WBT receives a report, and the payee's balance rises by the price.
- **Verification A:** a browser-flow recording plus the receipt.
- **Verification B:** the worker refuses:
  - a reused `payment_id` or tx hash;
  - an unrelated tx hash;
  - an event for another payee or a lower value.
- **Evidence:** `docs/evidence/W-05/` (new).
- **Status:** **TODO** (waits on BLOCKED W-01/W-06 and W-03).

**W-06 — Seedless onboarding implementation**
- **Owner:** Dev A.
- **Goal:** implement the D-W1 choice.
- **Inspect:** `frontend/lib/wagmi.ts`, `components/Web3Provider.tsx`, `components/Header.tsx`, `components/Modals.tsx`, `lib/store.tsx`.
- **Depends on:** W-01.
- **Unresolved:** **D-W1**.
- **Skills/tools:** the chosen vendor SDK or viem local account.
- **Steps:**
  1. Integrate the wallet.
  2. Define the chain 1874 transport in-app.
  3. Remove network-switch prompts from the primary path.
  4. Keep injected wallets as a labelled fallback.
- **Acceptance:** a new user reaches a signed payment with no seed phrase, no network add, and no WBT.
- **Verification A:** a fresh-profile recording.
- **Verification B:** an independent tester repeats the flow from the README alone.
- **Evidence:** `docs/evidence/W-06/` (new).
- **Status:** **BLOCKED** (D-W1).

**W-07 — Gasless subscriptions (stretch)**
- **Owner:** Dev A.
- **Goal:** §6.3.
- **Inspect:** `contracts/src/Subscriptions.sol` (`subscribe`, `cancel`), `contracts/test/Subscriptions.t.sol`, `frontend/lib/useSubscribeOnChain.ts`.
- **Depends on:** W-04, S-03.
- **Unresolved:** **D-W2**.
- **Skills/tools:** Foundry, EIP-712.
- **Steps:**
  1. `subscribeWithSig` / `cancelWithSig` with an intent signature.
  2. A relayed ERC-2612 permit to Permit2, with grief handling.
  3. Frontend signing.
- **Acceptance:** subscribe and cancel work with 0 payer WBT.
- **Verification A:** Foundry tests plus testnet receipts.
- **Verification B:** a relayer that substitutes `service`, `amountPerCycle`, or `interval` gets a revert.
- **Evidence:** `docs/evidence/W-07/` (new).
- **Status:** **BLOCKED** (D-W2).

**W-08 — Deploy and verify Meter contracts on Whitechain Sepolia**
- **Owner:** Dev A.
- **Goal:** the prize requirement "deployed and verified on Whitechain Sepolia".
- **Inspect:** `contracts/script/DeployTestnet.s.sol` (template only; **do not** deploy mock USDT for payments), `contracts/foundry.toml`.
- **Depends on:** W-10, W-02, CP3 (tagged commit). Whitechain RPC and verifier entries requested from Dev B in `foundry.toml`.
- **Unresolved:** whether the subscription contracts are deployed when D-W2 = no (recommended: yes, with the prize USDT as spend token).
- **Skills/tools:** `whitechain-dev`, Foundry.
- **Steps:**
  1. Write `DeployWhitechain.s.sol` using the prize USDT address.
  2. Deploy with `--verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/`.
  3. Write the manifest.
- **Acceptance:** every contract in the manifest shows verified source on the explorer.
- **Verification A:** links to the explorer's verified pages.
- **Verification B:** reads from a second machine match the manifest.
- **Evidence:** `contracts/deployments/whitechain-sepolia.json`, `docs/evidence/W-08/` (new).
- **Status:** **TODO**.

**W-09 — Whitechain submission artefacts**
- **Owner:** Dev A.
- **Goal:** the §11 Whitechain items.
- **Inspect:** the prize page text (§2), `README.md`.
- **Depends on:** W-05, W-08.
- **Unresolved:** none.
- **Skills/tools:** screen recorder.
- **Steps:**
  1. README sections covering: why on-chain stablecoin settlement on Whitechain; gas funding; drain protection; limitations; the USDT payment explorer link.
  2. `WHITECHAIN_FEEDBACK.md`.
  3. A 2–4 min video showing each party.
- **Acceptance:** every §11 Whitechain box is ticked, with links.
- **Verification A:** the checklist with links.
- **Verification B:** Dev B reviews it against the prize-page wording.
- **Evidence:** README, `WHITECHAIN_FEEDBACK.md`.
- **Status:** **TODO** (waits on BLOCKED W-05 chain).

### Uniswap track (Dev B)

**U-01 — Choose the network and fund test accounts**
- **Owner:** Dev B.
- **Goal:** decide D-U1, and get gas plus USDC.
- **Inspect:** the §4 network rows and Circle's USDC page.
- **Depends on:** S-01.
- **Unresolved:** **D-U1**, B-U1.
- **Skills/tools:** `cast`, faucets.
- **Steps:**
  1. Decide the network.
  2. Fund the executor and the demo subscriber.
  3. Re-check the pool liquidity and quote.
- **Acceptance:** both accounts hold gas and USDC on the chosen network.
- **Verification A:** balance reads.
- **Verification B:** a QuoterV2 call for the demo amount returns a non-zero value.
- **Evidence:** `docs/evidence/U-01/` (new).
- **Status:** **BLOCKED** (D-U1).

**U-02 — Milestone: `UniswapV3SwapService` with fork tests**
- **Owner:** Dev B.
- **Goal:** the smallest proof that the service swaps through the real pool.
- **Inspect:** `contracts/src/SIPService.sol` (`execute`, `SwapParams`), `Service.sol`, `contracts/script/helpers/MockContracts.sol`, `contracts/test/SIPService.t.sol`.
- **Depends on:** S-03. A Sepolia fork URL is enough; U-01 is not required.
- **Unresolved:** pool fee tier (500 vs 3000).
- **Skills/tools:** `swap-integration`, Foundry fork testing.
- **Steps:**
  1. Implement §7.2.
  2. Fork-test against SwapRouter02 and the pool at a pinned block.
- **Acceptance:** the success test and all failure tests pass.
- **Verification A:** a fork test where the subscriber's `tokenOut` balance increase equals the emitted `amountOut`.
- **Verification B:** each of these reverts:
  - `amountOutMinimum = quote + 1`;
  - an expired deadline;
  - a non-allowlisted `tokenOut`.
- **Evidence:** `docs/evidence/U-02/` (new; forge output and fork block).
- **Status:** **TODO**.

**U-03 — Factory wiring, deploy and verify**
- **Owner:** Dev B.
- **Goal:** deployable via `ServiceFactory` on the chosen network.
- **Inspect:** `contracts/src/ServiceFactory.sol` (`createSwapService`), `ServiceDeployer.sol`, `contracts/script/CreateService.s.sol`.
- **Depends on:** U-02, U-01.
- **Unresolved:** D-U1.
- **Skills/tools:** Foundry, Etherscan verification.
- **Steps:**
  1. Add the deployer and factory functions.
  2. Freeze the ABI at CP3.
  3. Write the deploy script and verify.
  4. Write the manifest.
- **Acceptance:** the manifest has verified URLs, and the factory is under 24 KB.
- **Verification A:** the explorer's verified pages.
- **Verification B:** `forge build --sizes` output.
- **Evidence:** the manifest and `docs/evidence/U-03/` (new).
- **Status:** **TODO** (waits on BLOCKED U-01).

**U-04 — Quoter-based decision endpoint**
- **Owner:** Dev B.
- **Goal:** real quotes, correct decimals, and quote age.
- **Inspect:** `agents/agent_dca/src/x402/server.ts` (`buildRoute`, `/v1/decide`), `agents/agent_dca/src/agent/claude.ts`, `agents/agent_dca/src/config.ts`.
- **Depends on:** S-04, U-01, P-04, I-1b.
- **Unresolved:** D-U3, D-U4.
- **Skills/tools:** `swap-integration`, viem `readContract`/`simulateContract`.
- **Steps:**
  1. Read `fee()`/`maxFeeAmount()` and compute the post-fee `amountIn`.
  2. Call QuoterV2 via `eth_call`.
  3. Return `{quote, quotedAt, decimals, slippageBps}`.
  4. Remove the synthetic route.
- **Acceptance:** the quote matches an independent QuoterV2 call at the same block.
- **Verification A:** compare with the `cast call` output.
- **Verification B:** the executor rejects a quote older than 30 s, and a fee change after quoting forces a re-quote.
- **Evidence:** `docs/evidence/U-04/` (new).
- **Status:** **TODO** (waits on BLOCKED U-01).

**U-05 — Executor and indexer for real swaps**
- **Owner:** Dev B.
- **Goal:** one live cycle, with the actual received amount recorded.
- **Inspect:** `backend/src/executor/executor.ts` (`tryExecute`, `recordRun`), `backend/src/indexer/indexer.ts`.
- **Depends on:** U-03, U-04, P-02, P-03, I-3, I-6.
- **Unresolved:** D-U4.
- **Skills/tools:** viem.
- **Steps:**
  1. Encode `(tokenOut, poolFee, amountOutMinimum, deadline)`.
  2. Broadcast through the nonce queue.
  3. The indexer records `SwapExecuted`.
- **Acceptance:** a live `execute()` receipt containing `SwapExecuted`, and a DB run equal to the event's `amountOut`.
- **Verification A:** the receipt plus a DB readback.
- **Verification B:**
  - re-indexing creates no duplicates;
  - a second subscription forced to an impossible `amountOutMinimum` reverts and records no run.
- **Evidence:** `docs/evidence/U-05/` (new).
- **Status:** **TODO** (waits on BLOCKED U-01).

**U-06 — Frontend for DCA on the Uniswap network**
- **Owner:** Dev B for the two pages. Dev A merges the requested changes to `lib/contracts.ts`, `lib/api/types.ts` and `wagmi.ts`.
- **Goal:** register and subscribe on the chosen network, and display the actual amounts.
- **Inspect:** `frontend/app/creator/register/page.tsx` (`createSwapService` args, `DCA_OUTPUT_TOKENS`), `frontend/app/subscriptions/page.tsx`.
- **Depends on:** U-03, S-04.
- **Unresolved:** D-U1.
- **Skills/tools:** wagmi, viem.
- **Steps:**
  1. Point the register page at the new factory function.
  2. Show WETH outputs and explorer links per chain.
  3. Remove the Arbitrum references in owned pages.
- **Acceptance:** a Uniswap DCA agent can be registered and subscribed to, and runs show the actual amounts.
- **Verification A:** a browser recording.
- **Verification B:** a wallet on the wrong network is prompted; `grep -r 421614 frontend` finds no remaining references in owned files.
- **Evidence:** `docs/evidence/U-06/` (new).
- **Status:** **TODO** (waits on BLOCKED U-01).

**U-07 — Uniswap submission artefacts**
- **Owner:** Dev B.
- **Goal:** §7.4.
- **Inspect:** the prize page text (§2), `README.md` (Dev A merges Dev B's section).
- **Depends on:** U-05.
- **Unresolved:** B-U2.
- **Skills/tools:** none.
- **Steps:**
  1. Write `FEEDBACK.md`.
  2. A human submits the feedback form with the link.
  3. Add a README section with file:line pointers to the `exactInputSingle` call and the quoter usage.
- **Acceptance:** every §11 Uniswap box is ticked.
- **Verification A:** the checklist with links.
- **Verification B:** Dev A finds the swap call by following the README pointers alone.
- **Evidence:** `FEEDBACK.md`, README.
- **Status:** **TODO** (waits on BLOCKED U-01).

### Architecture-audit tasks (from ARCHITECTURE.md v2; stable IDs I-1 … I-8)

**I-1 — Signed dispatch envelope: spec, signer, risk-agent verifier**
- **Owner:** Dev A. The `agent_dca` verifier is **I-1b** (Dev B).
- **Goal:** agents serve work only for requests that (a) Meter signed and (b) match an unconsumed on-chain payment with the same params. This closes result theft (audit F1).
- **Inspect:**
  - `agents/agent_risk_analyzer/src/x402/server.ts` (`/v1/invoke`)
  - `backend/src/api/routes/config.ts` (where the public dispatch address will be published)
  - ARCHITECTURE.md §5.2
- **Depends on:** S-02, W-10 (for the `paramsHash` in `PaymentSettled`).
- **Unresolved:** none; the envelope format is fixed below.
- **Skills/tools:** viem `signMessage`/`verifyMessage`; RFC 8785 JSON Canonicalization (a JCS library, added to the manifests by Dev A).
- **Steps:**
  1. Write the interface spec `docs/interfaces/dispatch-envelope.md` (new, Dev A owns):
     - body fields `v, chainId, kind ("invoke"|"decide"), requestId, paymentId?, txHash?, params, paramsHash, issuedAt, expiresAt`;
     - `paramsHash = keccak256(utf8(JCS(params)))`;
     - signature = EIP-191 over `keccak256(utf8(JCS(body)))`, sent in header `X-Meter-Dispatch`;
     - expiry ≤ 60 s.
  2. Commit shared test vectors `docs/interfaces/dispatch-envelope.vectors.json` (new): valid, expired, wrong signer, tampered params, wrong paramsHash.
  3. Signer in `backend/src/api/dispatch/envelope.ts` (new), using `DISPATCH_SIGNING_KEY`, a fresh key holding no funds. Publish its address in `GET /config` and as agent env `METER_DISPATCH_ADDRESS`.
  4. Verifier in `agents/agent_risk_analyzer/src/dispatch/verify.ts` (new):
     - signature, expiry, paramsHash;
     - `PaymentSettled(paymentId, *, payee, ≥ price, paramsHash)` from the manifest's `MeterPayments`, with ≥ K confirmations (D-A4);
     - store consumed `paymentId` in a local SQLite or file store.
  5. Replace the `X-Payment` handshake in the risk agent.
- **Acceptance:** the risk agent serves a valid dispatched request and rejects every vector except the valid one.
- **Verification A:** a unit test passes all vectors; an end-to-end fork test delivers one paid run.
- **Verification B:** an outside client replays the exact on-chain `paymentId`/`txHash` without a Meter signature → 401. The same signed envelope replayed after first use → 409. Dev B's independent I-1b verifier passes the same vector file (two implementations agreeing).
- **Evidence:** `docs/evidence/I-1/` (new).
- **Status:** **TODO**.

**I-1b — Dispatch verifier in `agent_dca`**
- **Owner:** Dev B.
- **Goal:** the executor authenticates to `/v1/decide` with the I-1 envelope (no shared secret). This replaces the unsigned `X-Payment` (with P-04).
- **Inspect:** `agents/agent_dca/src/x402/server.ts` (`/v1/decide`), `docs/interfaces/dispatch-envelope.md`.
- **Depends on:** I-1 steps 1–2 (spec and vectors only), P-04.
- **Unresolved:** D-U3 (whether the decision is also paid).
- **Skills/tools:** viem, a JCS library (added to `agents/agent_dca/package.json`, which Dev B owns).
- **Steps:**
  1. `agents/agent_dca/src/dispatch/verify.ts` (new): signature, expiry, paramsHash, `kind == "decide"`.
  2. Keep a `requestId` replay cache for the expiry window.
  3. The executor signs `decide` envelopes. The executor needs `DISPATCH_SIGNING_KEY` read access, or its own fund-less key listed in `/config` (Dev B decides with Dev A in the PR).
- **Acceptance:** `/v1/decide` answers only valid signed requests.
- **Verification A:** the shared vectors pass.
- **Verification B:** an unsigned request, a replayed `requestId`, or an expired envelope → rejected, with no side effects.
- **Evidence:** `docs/evidence/I-1b/` (new).
- **Status:** **TODO**.

**I-2 — Relayer process with persisted transaction state**
- **Owner:** Dev A.
- **Goal:** the relayer runs as its own single-instance process, never loses or reuses a nonce, and recovers from crashes and stuck transactions (audit F2).
- **Inspect:** `backend/src/chain/client.ts` (`buildClients`), `backend/src/executor/main.ts` (process pattern), `backend/Dockerfile`, `docker-compose.yml`.
- **Depends on:** S-04 (registry; per-role keys), S-05 (Dev A adds the `relayer_txs` migration as part of this task).
- **Unresolved:** fee-bump interval and percentage (proposed: bump after 15 s by +15%, above geth's 10% minimum replacement bump; up to 3 bumps).
- **Skills/tools:** viem (`sendRawTransaction`, `getTransactionCount`), PostgreSQL (`FOR UPDATE SKIP LOCKED`, `LISTEN/NOTIFY`, `pg_try_advisory_lock`), anvil fork of Whitechain.
- **Steps:**
  1. Entry `backend/src/relayer/main.ts` (new) and npm script `relayer:start` in `backend/package.json`.
  2. Single-instance guard: take `pg_try_advisory_lock(<relayer-chain-id>)` at boot; exit if it is not acquired.
  3. Job claim: `SELECT … FROM payments WHERE status='authorized' FOR UPDATE SKIP LOCKED LIMIT 1`, woken by `LISTEN payments_authorized`.
  4. Transaction manager `backend/src/relayer/txManager.ts` (new):
     - `nonce = max(db nonce + 1, chain pending count)`;
     - write the `relayer_txs` row **before** broadcast;
     - sign locally and broadcast the raw transaction;
     - fee bump by replacing with the same nonce;
     - mark `mined`/`dropped`.
  5. Boot reconciliation: for each `sent` row, read the receipt; if missing and the nonce is still pending, re-broadcast or replace; never allocate a nonce below the chain's `latest` count.
  6. Add a `relayer` service to Compose with only `WHITECHAIN_RELAYER_PRIVATE_KEY` and `DATABASE_URL`.
- **Acceptance:** exactly one relayer runs; every broadcast has a prior DB row; restarts lose nothing.
- **Verification A:** on an anvil fork, kill the relayer after broadcast but before the receipt, then restart → the payment reaches `confirmed` once and the nonce sequence has no gaps or reuse.
- **Verification B:**
  - With anvil auto-mining off and an underpriced first transaction → a fee-bumped replacement is mined and the old hash is marked `replaced`.
  - Starting a second relayer → it exits on the advisory lock.
- **Evidence:** `docs/evidence/I-2/` (new).
- **Status:** **TODO**.

**I-3 — Egress guard for outbound calls to creator endpoints**
- **Owner:** Dev B (`backend/src/utils/` is Dev B's). Dev A adds the `undici` dependency to `backend/package.json` on request.
- **Goal:** server-side calls to creator-supplied URLs cannot reach internal networks or cloud metadata, and cannot hang or flood the caller (audit F3).
- **Inspect:**
  - `backend/src/utils/fetchWithTimeout.ts`
  - call sites `backend/src/executor/executor.ts:118` and `backend/src/x402/client.ts` (`decide`, `invoke`)
  - creator registration `backend/src/api/routes/creator.ts` (`/agents/register`)
- **Depends on:** S-02.
- **Unresolved:** dev-mode allowlist format (proposed: env `EGRESS_DEV_ALLOW=http://localhost:8402,http://localhost:8403`, ignored when `NODE_ENV=production`).
- **Skills/tools:** Node `dns.promises.lookup({all:true})`, `undici` `Agent` with a custom `connect.lookup` (IP pinning), `ipaddr.js` or equivalent for range checks.
- **Steps:**
  1. `backend/src/utils/egress.ts` (new) exporting `safeFetch(url, opts)` and `validateEndpoint(url)`. Rules:
     - scheme must be https unless the URL is on the dev allowlist;
     - no userinfo;
     - port 443, or one on the allowlist.
  2. Resolve every A/AAAA record and reject if **any** address is in: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `198.18/15`, `224/4`, `::/128`, `::1`, `fc00::/7`, `fe80::/10`, or IPv4-mapped versions of these.
  3. Pin the connection to the vetted IP (defeats DNS rebinding); `redirect: 'manual'`, treating any 3xx as an error.
  4. Limits: timeout (default 15 s), response body cap (default 1 MiB, enforced while streaming), JSON-only content type for agent calls.
  5. Replace `fetchWithTimeout` at the agent call sites. Dev A switches the dispatcher (W-05) and `validateEndpoint` in registration.
- **Acceptance:** all outbound calls to creator URLs go through `safeFetch`, and `grep` finds no direct `fetch` of a DB-sourced URL.
- **Verification A:** a public https test endpoint succeeds, and a body larger than the cap is cut off with an error.
- **Verification B:** each of these is rejected:
  - `http://127.0.0.1`, `http://[::1]`, `http://169.254.169.254/latest/meta-data`;
  - decimal-encoded `http://2130706433`;
  - a hostname that resolves to 127.0.0.1;
  - a public URL that 302-redirects to an internal address;
  - `https://user:pass@host`.
- **Evidence:** `docs/evidence/I-3/` (new).
- **Status:** **TODO**.

**I-4a — Preflight endpoint**
- **Owner:** Dev A.
- **Goal:** catch invalid inputs before the payer pays, so most "paid but undelivered" cases never happen (audit F4).
- **Inspect:** `agents/agent_risk_analyzer/src/x402/server.ts` (input validation of `wallet_address`), `backend/src/api/routes/marketplace.ts`, `frontend/lib/store.tsx` (`runOneTime`).
- **Depends on:** I-1 (envelope `kind` gets a `"preflight"` value), I-3.
- **Unresolved:** behaviour for third-party agents without `/v1/preflight` (proposed: a missing endpoint means quote anyway, and the UI shows a "no preflight" badge).
- **Skills/tools:** Express, viem.
- **Steps:**
  1. Risk agent: `POST /v1/preflight` validates params, does no work, and is signed with `kind = "preflight"`.
  2. API: `POST /payments/preflight` calls it through `safeFetch`; `POST /payments/quote` requires a successful preflight within the last 60 s for the same `paramsHash` (when the agent supports it).
  3. Frontend runs preflight before signing.
- **Acceptance:** invalid params never produce a quote for agents that support preflight.
- **Verification A:** a valid wallet address → quote issued.
- **Verification B:** an invalid address → no quote and no signature prompt; a quote request with a different `paramsHash` than the preflighted one → rejected.
- **Evidence:** `docs/evidence/I-4a/` (new).
- **Status:** **TODO**.

**I-4b — Creator-signed refunds**
- **Owner:** Dev A.
- **Goal:** a payer whose delivery permanently failed can be refunded by the creator without anyone but the business paying gas.
- **Inspect:** ARCHITECTURE.md §4.3 (`refund`), §6.6; `contracts/src/MeterPayments.sol` (from W-10); `frontend/app/creator/page.tsx`.
- **Depends on:** W-10, I-2, W-05.
- **Unresolved:** **D-A2** (refund policy, retry budget, auto-hide threshold).
- **Skills/tools:** Foundry, EIP-3009, wagmi `signTypedData`.
- **Steps:**
  1. Add `refund(...)` to `MeterPayments`. The nonce uses the `"REFUND"` domain, binding paymentId, payer and value. Allowed only once per `paymentId`, and only for a `paymentId` that has a `PaymentSettled` (store `settled[paymentId] = (from, payee, value)` at pay time; refunds go only to the original `from` and are capped at the original `value`).
  2. API: `POST /payments/:id/refund-authorization` (the creator's session must match the agent's publisher; payment status must be `delivery_failed`).
  3. Relayer builder for `refund`.
  4. Creator console "Refund" button.
  5. Indexer handles `RefundSettled`.
- **Acceptance:** a `delivery_failed` payment becomes `refunded`, and the payer's USDT increases by the value.
- **Verification A:** fork test plus API test end to end.
- **Verification B:** refunds are rejected when:
  - sent to an address other than the original payer;
  - larger than the original value;
  - made twice;
  - made for a never-settled `paymentId`;
  - requested by a session that is not the creator.
- **Evidence:** `docs/evidence/I-4b/` (new).
- **Status:** **BLOCKED** (D-A2).

**I-5 — Correct Permit2 sizing when a subscriber has several subscriptions**
- **Owner:** Dev A (`Subscriptions.sol`, `useSubscribeOnChain.ts`, API are Dev A's files).
- **Goal:** a new subscription neither starves existing ones nor extends its own lifetime beyond what the user chose (audit F7, corrected).
- **Facts this rests on** (VERIFIED-SRC):
  - Permit2 `permit` **replaces** `amount` and `expiration` per (owner, token, spender).
  - `Subscriptions.subscribe` stores `permitSingle.details.expiration` as the subscription's own `permitExpiry`.
  - `subscribe` requires `permit.amount ≥ amountPerCycle × floor((expiration − now) / interval)`.
  - So a shared permit expiry would **also become the new subscription's end date**.
- **Inspect:** `contracts/src/Subscriptions.sol` (`subscribe`, `execute`, `cancel`), `frontend/lib/useSubscribeOnChain.ts:77-140`, `backend/src/api/routes/subscriptions.ts`.
- **Depends on:** S-03; CP3 ABI freeze if the contract changes.
- **Unresolved:** **D-A6**: (a) limit to one active subscription per (subscriber, spend token, chain), enforced in the API and UI; or (b) contract change: `subscribe` takes an explicit `endTime ≤ permit expiration`, and `execute`/`cancel` use `endTime`.
- **Skills/tools:** Foundry, Permit2 AllowanceTransfer.
- **Steps:**
  - **(a):** API rejects a second active subscription for the same token; UI explains why.
  - **(b):**
    1. Add `endTime` to the `Subscription` struct; `subscribe` checks `endTime ≤ permit.expiration` and sizes `executionCount` by `endTime`.
    2. API `GET /subscriptions/budget?chain_id&token` returns `remaining_i = amountPerCycle_i × cycles left before endTime_i` for each active subscription.
    3. The frontend signs `amount = Σ remaining_i + new_amount × cycles(new)` and `expiration = max(all endTime)`.
    4. Re-sign whenever a subscription is added. The deploy on both chains uses the new ABI.
- **Acceptance:** two concurrent subscriptions each execute their full cycle counts and stop at their own end times.
- **Verification A:** a Foundry test in `contracts/test/Subscriptions.t.sol` creates subscription 1 (long), then subscription 2 (short), runs both to completion, and asserts each one's execution count.
- **Verification B:**
  - Under (b), a test asserts subscription 2 cannot execute after its own `endTime` even though the Permit2 expiration is later.
  - Under (a), an API test shows the second subscribe is rejected before any signature.
- **Evidence:** `docs/evidence/I-5/` (new).
- **Status:** **BLOCKED** (D-A6).

**I-6 — Finality tiers, reorg handling, per-chain cursors**
- **Owner:** Dev B. Dev A adds the `chain_cursors` table and the `runs.finality` column in a migration on request.
- **Goal:** delivery and accounting never act on events that a reorg removes, and earnings are marked final only past the `safe` head (audit F5).
- **Inspect:** `backend/src/indexer/indexer.ts` (`sync`, `CHUNK`, checkpoint in `system_constants`), `backend/src/config.ts`.
- **Depends on:** S-04 (registry fields `startBlock`, `logChunkSize`, `confirmations`, `pollMs`), S-05, P-02.
- **Unresolved:** **D-A4** (K values); the code reads them from config, so work can start with placeholders.
- **Skills/tools:** viem `getLogs`, `getBlock({blockTag:'safe'})`; anvil (`evm_snapshot`/`evm_revert`, or `anvil_reorg` if available in the installed Foundry version — INFERRED).
- **Steps:**
  1. Process up to `latest − K`.
  2. Each pass, re-scan `[cursor − 2K, cursor]` and compare `(tx_hash, log_index, block_hash)`. Rows whose block hash changed or that disappeared become `orphaned`.
  3. Every pass, promote rows with `block_number ≤ safe` to `final`.
  4. Store `last_processed_block` and `last_safe_block` per chain in `chain_cursors`.
  5. Adaptive chunking: halve the range when the RPC returns range or size errors.
  6. Also handle `removed: true` logs.
- **Acceptance:** no `runs` row survives a reorg as `confirmed`/`final`; finality is promoted automatically.
- **Verification A:** on an anvil fork, index events, advance blocks, set a mocked `safe` → rows become `final`.
- **Verification B:** snapshot, index a block with an `Executed`/`PaymentSettled` event, revert, and mine a different block → the row is `orphaned`, counts derived from runs drop accordingly, and re-indexing creates no duplicates.
- **Evidence:** `docs/evidence/I-6/` (new).
- **Status:** **TODO**.

**I-7a — Operations: API and relayer (Dev A)**
- **Owner:** Dev A.
- **Goal:** operators can see and act on the failure-prone parts of the Whitechain path (audit F15).
- **Inspect:** `backend/src/logger.ts` (pino; Dev B's file, used as is), `backend/src/api/app.ts`, `docker-compose.yml`.
- **Depends on:** I-2, W-04.
- **Unresolved:** alert channel (log-based only, or webhook). Proposed: log-based for the hackathon.
- **Skills/tools:** pino, Express.
- **Steps:**
  1. `GET /healthz` on the API (DB and RPC reachable).
  2. A tiny health HTTP listener on the relayer: lock held, RPC reachable, WBT balance above threshold, oldest `authorized` < 30 s, no `sent` older than 60 s.
  3. Correlation fields `payment_id`, `tx_hash` on every log line.
  4. `ops/runbooks.md` (new): relayer out of WBT, stuck nonce, RPC outage, agent down, refund handling.
  5. Compose healthchecks.
- **Acceptance:** each listed condition flips health to unhealthy and logs an `alert` event.
- **Verification A:** healthy stack → all `/healthz` return 200.
- **Verification B:** on a fork, drain the relayer below threshold and point the RPC at a dead URL → health turns unhealthy with the expected reason. A reviewer follows one runbook end to end.
- **Evidence:** `docs/evidence/I-7a/` (new).
- **Status:** **TODO**.

**I-7b — Operations: indexers and executor (Dev B)**
- **Owner:** Dev B.
- **Goal:** the same as I-7a, for the indexers and the executor.
- **Inspect:** `backend/src/index.ts`, `backend/src/indexer/indexer.ts`, `backend/src/executor/main.ts`, `backend/src/scheduler/scheduler.ts`.
- **Depends on:** I-6, P-03.
- **Unresolved:** none.
- **Skills/tools:** pino; Node `http`.
- **Steps:**
  1. Health listeners: indexer lag (`latest − cursor` < 2 × poll) and orphan count; executor last successful tick, stuck tx, ETH balance.
  2. Correlation fields `subscription_id`, `tx_hash`.
  3. Runbook sections for indexer lag, reorg orphans and executor failures, as a PR to Dev A's `ops/runbooks.md`.
- **Acceptance:** each condition is visible in health output and logs.
- **Verification A:** a healthy fork → 200.
- **Verification B:** stop block production or point the RPC at a dead URL → lag alert. Inject an orphan (I-6 test) → the orphan count is reported.
- **Evidence:** `docs/evidence/I-7b/` (new).
- **Status:** **TODO**.

**I-8 — Agent card URI that resolves and is chain-qualified**
- **Owner:** Dev B (factory / `ERC8004IdentityRegistry`) and Dev A (API route and frontend `buildAgentCardURI`), in that order.
- **Goal:** every agent's on-chain identity URI resolves to its card on the right chain.
- **Inspect:**
  - `frontend/app/creator/register/page.tsx:146-154` (`buildAgentCardURI`)
  - `backend/src/api/routes/marketplace.ts:144-180` (`/:onchain_agent_id/card.json`)
  - `contracts/src/ERC8004IdentityRegistry.sol` (`_mintAgent`, `tokenURI`)
  - `contracts/src/ServiceFactory.sol`
- **Depends on:** S-05 (`agents.chain_id`), CP3 if a contract changes.
- **Unresolved:** **D-A1** (options a/b/c in §12).
- **Skills/tools:** Foundry, Express.
- **Steps (by option):**
  - **(a)** The registry stores a base URI and `tokenURI = base + chainid + "/" + agentId + "/card.json"`; the factory passes an empty string.
  - **(b)** Add an owner-only `setAgentCardURI(agentId, uri)` and have the frontend call it after mint (an extra transaction for the creator).
  - **(c)** The frontend uses a pre-generated UUID URI; the API maps UUID → `(chain_id, agentId)`.
  - In every option, the API serves `/agents/:chain_id/:onchain_agent_id/card.json`.
- **Acceptance:** `tokenURI(agentId)` on both chains returns a URL that serves that agent's card.
- **Verification A:** fetch the `tokenURI` for one agent per chain → 200 with matching `onchain_agent_id`.
- **Verification B:** the same `agentId` number on the two chains returns two different cards; an unknown ID → 404.
- **Evidence:** `docs/evidence/I-8/` (new).
- **Status:** **BLOCKED** (D-A1).

### Final

**S-06 — Integration rehearsal**
- **Owner:** Dev A (README) and Dev B (Uniswap section via PR).
- **Goal:** a fresh clone runs both demos from the documentation alone.
- **Inspect:** `README.md`, `docker-compose*.yml`, `.env.example` files, the manifests.
- **Depends on:** W-05, W-08, U-05, U-06, I-7a, I-7b.
- **Unresolved:** any open D-* items.
- **Skills/tools:** Docker or local runtimes.
- **Steps:**
  1. Fresh clone.
  2. Follow the README.
  3. Run both demos.
  4. Fix the documentation.
- **Acceptance:** both flows complete from the README.
- **Verification A:** a rehearsal recording.
- **Verification B:** a third person or the reviewer follows the README alone.
- **Evidence:** `docs/evidence/S-06/` (new).
- **Status:** **TODO** (waits on BLOCKED tasks).

### Smallest independently demonstrable milestones

- **Whitechain:**
  - **W-10**: the `MeterPayments` tests, including replay and tamper failures. This needs no network funds.
  - Then **W-03**: one relayed prize-USDT payment from a payer with 0 WBT, once test USDT is available.
- **Uniswap:** **U-02**, a fork test of `UniswapV3SwapService` swapping through the real Sepolia pool, plus the min-output and deadline failures.

---

## 10. Test and verification matrix

All rows are **NOT RUN**.

| Claim | Verification A (direct) | Verification B (independent / failure case) | Task |
|---|---|---|---|
| Payment binding is enforced on-chain | `MeterPayments` happy-path test | Altered payee/value/paymentId → revert; replay → revert | W-10 |
| Payer pays USDT without WBT | Receipt + payer WBT stays 0 | Replay rejected; tampered value fails | W-03, W-05 |
| Relayer cannot be drained | Global cap and alert configured | Burst from many fresh sessions stops at the global cap; unauthenticated → 401 | W-04 |
| No duplicate settlement | One tx per `payment_id` | 10 concurrent `authorize` calls → 1 broadcast | W-04 |
| Worker paid/served only after settlement | Worker verifies `PaymentSettled` | Reused/foreign tx hash or `payment_id` refused | W-05 |
| Seedless, no network setup | Fresh-profile recording | Independent tester follows the README | W-06 |
| Contracts verified on Whitechain | Explorer verified pages | Second-machine reads match the manifest | W-08 |
| DCA agent cannot be drained | Executor call works | Outside `X-Payment {from: executor}` moves no funds | P-04 |
| Real Uniswap swap | Fork test + live receipt with `SwapExecuted` | Min-output revert; expired deadline revert | U-02, U-05 |
| Recorded output = actual | DB `output_amount` = event `amountOut` | Re-index → no duplicates | U-05, P-02 |
| No scheduler overlap | One execute per cycle under slow receipts | Two due subs → consecutive nonces | P-03 |
| Auth enforced | Own-agent update succeeds | Forged body address rejected | P-01 |
| Migrations safe | Second run is a no-op | Duplicate insert → constraint error | S-05 |
| Tests actually run | `forge test` covers all files | Intentional failure detected | S-03 |
| Agents serve only Meter-dispatched, paid requests | Valid envelope + matching `PaymentSettled` served | Unsigned replay of an on-chain payment → 401; reused envelope → 409; both verifiers pass shared vectors | I-1, I-1b |
| Relayer survives crashes and stuck txs | Kill after broadcast, restart → confirmed once, no nonce reuse | Underpriced tx replaced by fee bump; second instance exits on advisory lock | I-2 |
| No SSRF via creator endpoints | Public https endpoint works; oversized body cut off | Loopback, IPv6 loopback, metadata IP, decimal IP, rebinding hostname, redirect-to-internal, userinfo URLs all rejected | I-3 |
| Bad inputs never get charged | Valid params → quote | Invalid params → no quote and no signature prompt | I-4a |
| Refunds go only back to the payer | Refund settles to payer | Wrong recipient, larger amount, double refund, unsettled payment, non-creator session → rejected | I-4b |
| Concurrent subscriptions both run to term | Two subs complete their full cycle counts | Short sub cannot execute past its own end time (b), or a second sub is rejected up front (a) | I-5 |
| Reorgs never leave money rows confirmed | Rows promoted to `final` past `safe` | Snapshot/revert reorg → row `orphaned`, derived counts drop, no duplicates | I-6 |
| Operators see failures | All `/healthz` 200 when healthy | Low relayer balance, dead RPC, indexer lag, orphans each flip health with a reason | I-7a, I-7b |
| Agent identity URI resolves per chain | `tokenURI` fetch returns that agent's card | Same `agentId` on two chains → two different cards; unknown → 404 | I-8 |

Rules:
- Compilation is not proof of settlement.
- A quote is not proof of a swap.
- An explorer screenshot alone does not prove authorization or budget safety.
- Repeating the same command is not Verification B.
- When a check cannot run, record **NOT VERIFIED** with the blocker in §13.

---

## 11. Demo and submission checklist

**Whitechain** (VERIFIED-DOC requirements; all TODO)
- [ ] Contracts deployed on Whitechain Sepolia (1874) and verified on the Whitechain explorer (W-08)
- [ ] At least one main-flow payment in USDT `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, with the explorer link in the README. Self-minted tokens don't count
- [ ] README line explaining why the flow needs on-chain stablecoin settlement on Whitechain
- [ ] README covers setup, architecture and limitations; how the business pays gas; how the relayer gets WBT; what prevents draining it
- [ ] Payer flow with no visible crypto steps (W-06)
- [ ] 2–4 min demo video showing each party
- [ ] `WHITECHAIN_FEEDBACK.md` (what worked, where you got stuck, what the docs lacked)
- [ ] Public GitHub repo with a steady commit history

**Uniswap** (VERIFIED-DOC requirements; all TODO)
- [ ] Public open-source repo (license D-S3)
- [ ] `FEEDBACK.md` in the repo
- [ ] Uniswap Developer Feedback Form submitted (human action) with the FEEDBACK.md link
- [ ] README points to the exact contracts and lines that use Uniswap

**Demo outline (PROPOSED):**
1. A payer opens Meter with no wallet setup, runs the risk agent, and pays in USDT gaslessly; show the `PaymentSettled` explorer link.
2. The creator sees earnings.
3. Show the relayer caps.
4. Separately, a DCA subscription on Sepolia runs a real Uniswap swap; show `SwapExecuted` and the actual WETH received.

State plainly that the two networks are separate.

---

## 12. Open decisions, blockers, known limitations

### Decisions (none selected)

| ID | Decision | Options | Owner |
|---|---|---|---|
| D-W1 | Seedless onboarding on chain 1874 | An embedded-wallet vendor with verified custom-chain support (unverified for 1874) / an app-held key (seedless, but held in the browser; losing it loses funds) / other | Dev A |
| D-W2 | Gasless recurring subscriptions on Whitechain in scope? | Yes (W-07) / No | Both |
| D-W3 | USDT payee for one-time runs | Creator payout address / agent `Service` contract | Dev A |
| D-W4 | Platform fee on one-time runs | Remove `agent_invoke_fee` / keep and disclose | Both |
| D-W5 | Relayer caps | Values for the global daily cap, per-session cap, minimum payment, max gas price | Dev A |
| D-U1 | Uniswap network | Ethereum Sepolia / Base Sepolia | Dev B |
| D-U2 | Ask the judges whether self-deployed Uniswap code on Whitechain qualifies? | Ask / don't (the plan doesn't need it) | Dev B |
| D-U3 | Keep the paid `/v1/decide` per cycle? | Keep, with signed payment / make it internal and authenticated | Dev B |
| D-U4 | Quote max age and deadline window | e.g. ≤ 30 s quote, 60–120 s deadline | Dev B |
| D-S1 | Session mechanism | httpOnly cookie / bearer token | Dev A |
| D-S2 | Backend/agents test runner | e.g. Vitest / `node:test` | Dev A |
| D-S3 | Repository license (needed for "open source") | None exists today | Both |
| D-S4 | Keep Arbitrum Sepolia support? | Drop / keep behind the registry | Dev B |
| D-A1 | Agent card URI scheme. Today the frontend builds `<api>/agents/<slug>-<timestamp>/card.json`, but the API serves `/agents/:onchain_agent_id/card.json`, so the on-chain URI never resolves; with two chains, the ID must also carry `chain_id` | (a) factory builds the URI from `agentId`; (b) mint, then `setAgentCardURI` (contract change); (c) pre-generated off-chain ID mapped by the API to `(chain_id, agentId)` | Dev B (factory) + Dev A (API route) |

### Blockers

| ID | Blocker | Impact | Next action |
|---|---|---|---|
| B-W1 | No documented way to obtain test USDT `0xcedf…` (the faucet is WBT-only; `mint` is owner-only) | W-03, W-05, demo | Ask the Whitechain team (booth, Discord, workshop) |
| B-W2 | Faucet amount and cooldown disagree across sources (0.5 WBT per 24 h; one drip per GitHub account; config payout 2) | Relayer funding | Claim once and record the amount; ask Whitechain |
| B-W3 | No signed EIP-3009/permit simulation run; EIP-712 domain not recomputed | W-03/W-10 risk | First step of W-03 / W-10 |
| B-W4 | No documented embedded-wallet/AA vendor for 1874 | W-01/W-06 | Timeboxed evaluation in W-01 |
| B-U1 | Sepolia USDC permit/EIP-3009 support and Circle faucet availability not verified | U-01 | Check in U-01 |
| B-U2 | Exact wording on penalties for missing Uniswap deliverables | Submission risk | Re-read the prize page before submitting |
| B-S1 | The brief's workspace path differs from the inspected checkout | Line references could drift | Confirm commit `2eeed81` |

### Additional decisions from the architecture audit (ARCHITECTURE.md v2)

| ID | Decision | Options | Owner |
|---|---|---|---|
| D-A2 | Refund policy for paid-but-undelivered runs | Creator-signed EIP-3009 refund relayed through `MeterPayments.refund` (proposed) / no refunds; retry budget; auto-hide threshold | Both |
| D-A3 | Trust-score gating | Disable and say so (proposed for hackathon) / per-agent threshold with a named scorer | Dev B |
| D-A4 | Confirmation depth K per chain for delivery (`safe` head lags ~29 min on Whitechain, observed 2026-11-07) | e.g. K = 5 on Whitechain, 3 on Sepolia | Both |
| D-A5 | Secondary RPC per chain for failover | e.g. Ankr's Whitechain entry / none | Dev A |
| D-A6 | Several subscriptions per subscriber and token (I-5). Permit2 replaces the allowance, and `Subscriptions.subscribe` stores the permit expiration as the subscription's end date, so a shared permit would stretch a new subscription's lifetime | (a) limit to one active subscription per (subscriber, token, chain), enforced in API and UI; (b) contract change: explicit `endTime ≤ permit expiration`, plus budget-summed permits | Dev A |

D-U3 is narrowed: the executor authenticates to `agent_dca` with the signed dispatch envelope; only "is the decision also paid?" remains.

The architecture-audit task intake (I-1 … I-8) has been promoted to full tasks in §9 ("Architecture-audit tasks"), with I-1, I-4 and I-7 split into I-1/I-1b, I-4a/I-4b and I-7a/I-7b so that each task has one owner.

### Known limitations (by design)

- The Uniswap swaps run on a different network from the Whitechain payments: separate balances, no atomicity, no bridge.
- The executor chooses `amountOutMinimum` and is trusted to do so, because there is no on-chain oracle.
- Gas sponsorship covers Whitechain only.
- An app-held browser key (if D-W1 picks it) cannot be recovered.
- Testnet prices are arbitrary.
- DCA output is WETH.
- Injected wallets need a network prompt.

### Secrets and configuration

| Variable (placeholder) | Where | Required? | Notes |
|---|---|---|---|
| `WHITECHAIN_RELAYER_PRIVATE_KEY` | Backend relayer only | Required | A new key holding WBT only; never in the frontend or logs |
| `WHITECHAIN_DEPLOYER_PRIVATE_KEY` | Local deploy only | Required for W-08 | Not in runtime Compose |
| `EXECUTOR_PRIVATE_KEY` | Executor only (Uniswap network) | Required | Separate from the relayer key |
| Agent keys / payout addresses (e.g. `AGENT_RISK_PAYOUT_ADDRESS`) | Agent containers only | As needed | One per agent |
| `DATABASE_URL` | Backend | Required | Server-only |
| `WHITECHAIN_RPC_URL`, `UNISWAP_NETWORK_RPC_URL` | Backend/agents | Required | Public endpoints, or keyed endpoints kept server-side |
| `ETHERSCAN_API_KEY` | Local verify | Required for U-03 | Not needed for Blockscout |
| `EXECUTOR_AGENT_SHARED_SECRET` (if D-U3 = internal) | Executor + DCA agent | Conditional | Server-only |
| `ANTHROPIC_API_KEY`, `COINCAP_KEY`, `UNISWAP_API_KEY` | Server | Optional | Server-only |
| `NEXT_PUBLIC_*` | Frontend | Public values only: chain IDs, key-free public RPC URLs, contract addresses, **public** wallet/WalletConnect app IDs | Never a private key or secret API key |

Do not reuse the previous owner's `PRIVATE_KEY`, the committed RPC URL in `frontend/lib/wagmi.ts`, or any address in `contracts/deployments/arbitrum-sepolia.json`.

A key mentioned separately in chat is intentionally **not** referenced, used, or tested here.

Third-party notices:
- OpenZeppelin (MIT), Uniswap AI skills (MIT), Whitechain skills (MIT).
- If any Uniswap contract source is copied rather than written as fresh minimal interfaces, keep that file's SPDX header and license.

---

## 13. Evidence and change log

| Date | Entry |
|---|---|
| 2026-11-06 | Repository inspected at `2eeed81` (source only; nothing built or run) |
| 2026-11-06 | Whitechain research (subagent; read-only web and JSON-RPC). The main author re-checked via RPC: chain ID `0x752`; USDT `decimals()` = 6; impl slot = `0x2642…26f7`; `DOMAIN_SEPARATOR()` returns a value; Permit2 code present; EntryPoint v0.7 absent |
| 2026-11-06/07 | Uniswap research (subagent; read-only web and JSON-RPC). The main author re-checked on Ethereum Sepolia: SwapRouter02 `0x3bFA…` has code; pool `0x3289…` has non-zero `liquidity()` and `token0()` = Circle USDC |
| 2026-11-07 | Independent reviewer (read-only subagent) confirmed Q1–Q9 against source, confirmed the npm scripts exist, and confirmed no secret values appear in the document. Its findings were resolved in this revision:<br>• the worker could not tie a plain `Transfer` log to a payment → `MeterPayments` + `PaymentSettled` + consumed-ID store<br>• MetaMask's chainId check breaks "no network setup" → embedded/app key primary, injected fallback<br>• files assigned to both devs → §8.1 rewritten; S-04b; `Subscriptions.t.sol` → Dev A; W-08 from tagged commit after CP3<br>• dependency/BLOCKED annotations and the day-1 list corrected<br>• drain backstops expanded (global cap, minimum value, reverted relays counted, fee bump)<br>• DCA agent drain made a required task (P-04)<br>• fee-aware quoting; explicit deadline require<br>• unowned files assigned<br>• evidence labels downgraded where not re-checked<br>• missing task fields added<br>• README citation, `solc`/`evm_version` marked PROPOSED, WETH output noted |
| 2026-11-07 | ARCHITECTURE.md added (target architecture). Synced back here: S-05 schema steps 6–7 (chain-aware tables, `relayer_usage`, per-chain checkpoints) and new decision D-A1 (agent card URI). D-A1 has no task yet |
| 2026-11-07 | ARCHITECTURE.md v2 (self-audit). Synced here:<br>• §6.1 `MeterPayments` summary (paramsHash, exact-amount check, refund)<br>• §6.2 step 9 (signed dispatch)<br>• S-04b (API holds no funded key; relayer is its own process)<br>• decisions D-A2 to D-A5<br>• task intake I-1 to I-8<br><br>Read-only RPC check: Whitechain `safe`/`finalized` head ≈ 1,750 blocks behind `latest` |
| 2026-11-07 | Architecture-audit intake promoted to full tasks:<br>• I-1, I-1b, I-2, I-3, I-4a, I-4b, I-5, I-6, I-7a, I-7b, I-8 (all TODO or BLOCKED)<br>• W-10 updated (paramsHash, exact-amount check, holder impersonation on a fork, so it no longer waits on B-W1)<br>• dependencies wired into W-04, W-05, U-04, U-05, S-06; ownership, interfaces, checkpoints and test matrix updated<br><br>Correction found while specifying I-5: ARCHITECTURE.md v2's "budget-summed permit with expiry = latest" would extend a new subscription's end date, because `subscribe` stores the permit expiration as the subscription expiry. New decision D-A6 |
| — | S-01 acceptance: **not yet recorded** (names, date) |
