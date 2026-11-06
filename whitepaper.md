# SIP Protocol: Non-Custodial On-Chain Systematic Investment Plans

**Version:** 0.1 - Draft  
**Date:** May 2026  
**Status:** Pre-release

---

## Abstract

SIP is a non-custodial, on-chain systematic investment plan (DCA) protocol for EVM-compatible blockchains. It enables any user with a self-custody wallet to schedule recurring purchases of crypto assets and tokenized real-world assets - without surrendering control of their funds to any centralized party at any point.

The protocol is built on two smart contract primitives: **Subscriptions**, which manages user-defined investment schedules and enforces execution parameters, and **SIPService**, which routes each trade through a best-price DEX aggregator and delivers purchased tokens directly to the user's wallet. Funds flow `user wallet → protocol (transient) → aggregator → user wallet`. The protocol never takes custody.

Approximately 100 million investors in India and a comparable number in the United States already practice systematic investing in traditional asset classes. Crypto adoption of DCA strategies is accelerating: a 2024 Kraken study found that 60% of their active users employ dollar-cost averaging. Despite this demand, no non-custodial, on-chain DCA solution exists with meaningful scale. Every major crypto DCA platform today is custodial - they hold user funds, represent a single point of failure, and can restrict withdrawals at any time.

SIP brings the SIP/DCA primitive on-chain, where users retain full custody, every execution is verifiable on a public blockchain, and the protocol is permissionless and composable. The initial deployment targets Robinhood Chain (an Arbitrum-based L2) and Arbitrum mainnet, enabling automated DCA into crypto assets and tokenized stocks (Tesla, Apple, Google, and others).

---

## 1. Introduction

### 1.1 The DCA Thesis

Dollar-cost averaging (DCA) or Systematic Investment Plan (SIP) is one of the most well-studied and empirically supported long-term investment strategies. The core thesis is simple: by investing a fixed amount at regular intervals regardless of price, an investor accumulates more units when prices are low and fewer when prices are high, lowering the average cost basis over time and reducing the emotional and financial impact of market timing errors.

SIP as an investment vehicle is not new. In India alone, over 90 million SIP accounts are active as of early 2026, processing over ₹26,000 crore (~$3.1B USD) in monthly investments through mutual funds (AMFI, 2026). In the United States, systematic investing underlies the majority of 401(k) contributions, representing trillions of dollars in assets under management. The behavioral finance literature consistently shows that DCA reduces anxiety around market volatility and improves long-term adherence to investment plans - even if mathematically, lump-sum investing outperforms DCA approximately two-thirds of the time in trending markets (Vanguard Research, 2012: [*Dollar-cost averaging just means taking risk later*](https://investor.vanguard.com/investor-resources-education/online-trading/dollar-cost-averaging-vs-lump-sum).

In crypto, the case for DCA is even stronger. Volatility in crypto markets is dramatically higher than in equities, making the psychological benefits of removing market-timing decisions more valuable. Historical data shows that investors who consistently DCA'd into Bitcoin over any rolling 4-year window have never lost money, regardless of entry point. A 2024 Kraken study found that 60% of active users on their platform employ a DCA strategy, underscoring that demand for automated systematic investing in crypto is both real and growing ([Kraken, 2024](https://www.kraken.com/learn/dca-strategy-crypto)).

> "The best time to invest was yesterday. The second best time is on a fixed schedule." - [Tom Nash, @iamtomnash](https://x.com/iamtomnash/status/1905179305056874920?s=20)

Despite the strong demand signal, there is no dedicated, non-custodial platform for on-chain DCA. SIP fills that gap.

### 1.2 Why Crypto Is Different

Crypto carries a reputation for volatility and speculation - a reputation that is statistically warranted in the short term but misleading over longer time horizons. Investors who held Bitcoin or Ethereum through any sustained 4+ year period have, historically, outperformed virtually every other asset class, including S&P 500 index funds, gold, and real estate.

The more fundamental difference between crypto and traditional finance is ownership. In traditional finance, your assets are held in your name but administered by intermediaries - a broker, a custodian, a clearinghouse. When you hold crypto in a self-custody wallet, you hold the actual asset. No intermediary can freeze it, confiscate it, restrict access to it, or fail in a way that makes it inaccessible. Your assets are portable across every border, transferable in seconds, and verifiable by anyone on a public ledger.

This is the promise of crypto: *genuine financial sovereignty*. The challenge is that accessing this sovereignty currently requires navigating complex UX, managing private keys, and making precise timing decisions - barriers that prevent most retail investors from participating in the long-term wealth accumulation that systematic investing enables.

### 1.3 The Gap in the Market

Every major platform offering automated DCA in crypto today is a centralized exchange: Coinbase, Kraken, Binance, and others offer recurring buy features. The problem is structural. These platforms:

- **Take custody of your funds.** When you hold assets on a CEX, you hold an IOU, not the asset itself. The collapse of FTX ($8B in user funds lost), Celsius ($4.7B frozen), and BlockFi illustrated this risk at catastrophic scale.
- **Can restrict or block withdrawals.** Multiple exchanges have suspended withdrawals during periods of stress, at exactly the moment users most need access to their funds.
- **Are opaque.** You cannot independently verify that your trades executed at the stated price, that your assets are held 1:1, or that the platform is solvent.
- **Are not composable.** Assets held on a CEX cannot interact with the broader DeFi ecosystem - they are siloed.

A dedicated non-custodial DCA platform - one where users control their assets at all times, every execution is verifiable on-chain, and the protocol is permissionless - does not yet exist at scale. SIP is that platform.

---

## 2. Problem Statement

### 2.1 The Custodial Trap

The dominant crypto DCA offerings today are provided by centralized exchanges. While convenient, they require users to deposit and leave funds with the exchange - creating a concentration of risk that is fundamentally at odds with the original promise of cryptocurrency.

The risks of custodial DCA platforms are not theoretical:

- **FTX (2022):** $8 billion in user funds lost to fraud and mismanagement. Users with active DCA plans lost everything on the platform.
- **Celsius (2022):** $4.7 billion in user assets frozen. Celsius had explicitly marketed its platform as a safe, yield-bearing alternative to banks.
- **BlockFi (2022):** Filed for bankruptcy following FTX contagion. Users' assets were locked for months.
- **Binance.US (2023):** Restricted USD withdrawals for weeks amid regulatory pressure.

Each of these events shared a common root cause: users had trusted a third party with their assets. On-chain, self-custodial execution eliminates this category of risk entirely. If the SIP protocol or its operators were to disappear tomorrow, users would still hold their assets in their own wallets and could cancel subscriptions directly via the contract.

### 2.2 The Manual Execution Problem

The alternative to custodial DCA is manual execution - buying on a schedule without automation. This works in theory but fails in practice for several well-documented reasons:

**Behavioral interference:** When markets are falling, the rational DCA investor should be buying more. In practice, most retail investors stop buying or sell during drawdowns. Studies show that retail investor behavior tends to be procyclical - buying high during euphoria and stopping or selling during fear - the opposite of what DCA requires ([JP Morgan, Guide to the Markets, Q1 2025](https://am.jpmorgan.com/us/en/asset-management/adv/insights/market-insights/guide-to-the-markets/)).

**Attention cost:** Executing a recurring investment requires showing up on a schedule, navigating a trading interface, and making an active decision. Life events, work, and distractions frequently interrupt this cadence. Automation eliminates the attention cost entirely.

**Precision:** DCA's statistical benefits compound with consistency. Missed intervals disproportionately affect returns because the intervals that feel worst to execute (during sharp drawdowns) are often the most valuable ones in retrospect. One study of S&P 500 investing found that missing the 10 best days in a decade roughly halved long-term returns ([Investsec](https://www.investec.com/en_za/focus/investing/why-it-doesnt-pay-to-time-the-market.html)).

### 2.3 The Missing On-Chain Primitive

DeFi has built sophisticated primitives for spot trading (Uniswap), lending (Aave), derivatives (dYdX, GMX), and yield (Yearn, Convex). What it lacks is a simple, composable, non-custodial recurring investment primitive.

An on-chain subscription service for DCA would unlock:
- **Self-custody DCA** at scale for retail investors
- **Programmable investment schedules** composable with other DeFi protocols
- **Transparent, verifiable execution** with every trade auditable on-chain
- **Access to tokenized real-world assets** (stocks, commodities) via RWA protocols, expanding DCA beyond crypto

SIP is that primitive.

---

## 3. The SIP Protocol

### 3.1 Vision

Enable any user to invest in a curated basket of crypto assets and tokenized real-world assets on a schedule they define, with full control over their funds at every step. SIP's goal is to make disciplined, systematic investing as simple as setting a calendar reminder - without requiring trust in any intermediary.

### 3.2 Design Principles

- **Non-custodial by construction.** The protocol is architecturally incapable of holding user funds beyond the duration of a single transaction. Funds flow through the contract atomically or not at all.
- **Permissionless and transparent.** Contracts are open source. Every execution is an on-chain event, visible to anyone. Users can verify every trade.
- **User-controlled and cancellable at any time.** Users can cancel their SIP in a single transaction. No lock-up periods, no withdrawal queues, no approval required.
- **Extensible beyond DCA.** The Subscriptions contract is a generic on-chain subscription primitive. Any recurring on-chain service can be built on top of it by implementing the `IService` interface.
- **Minimal trust assumptions.** The only trusted party in the system is the executor bot (a dedicated EOA). Its authority is scoped strictly: it can trigger execution of due subscriptions and nothing else. It cannot move funds, modify subscription parameters, or access balances.

### 3.3 What SIP Is Not

SIP is not an investment advisor or a guarantee of returns. DCA is a strategy for reducing timing risk, not eliminating market risk. Assets can decline in value over any time horizon, including long ones.

SIP does not promise any specific return. It provides the infrastructure to execute a DCA strategy with full self-custody - the investment decisions (which assets, what amount, what interval) remain entirely with the user.

SIP is also not a custodial service, a lending protocol, or a yield product. There is no pooling of user funds, no interest paid or charged, and no leverage.

---

## 4. How It Works

### 4.1 Protocol Overview

SIP is composed of two contracts and an off-chain executor bot:

1. **Subscriptions.sol** - Stores and manages investment subscriptions. Validates execution timing. Pulls funds from users via ERC-20 `transferFrom` and forwards them to the registered service.
2. **SIPService.sol** - Receives funds from Subscriptions, fetches optimal swap calldata from a DEX aggregator (1inch/Paraswap), executes the swap, and delivers purchased tokens directly to the subscriber's wallet.
3. **Executor Bot** - An off-chain service that monitors subscription due times and calls `execute()` on the Subscriptions contract. The bot is the only entity with permission to trigger execution, but it cannot access funds or modify subscriptions.

### 4.2 The Subscription Lifecycle

```
1. User selects token, amount, and interval (e.g., $100 USDC → ETH, every 7 days)
2. User signs an ERC-20 approval (or Permit2 signature) for the Subscriptions contract
3. User calls subscribe() - subscription is recorded on-chain
4. At each interval, the executor bot calls execute(subscriptionId)
5. Subscriptions pulls amountPerCycle USDC from the user's wallet
6. Funds are forwarded to SIPService
7. SIPService fetches best-price swap calldata from the aggregator
8. Swap executes: USDC → ETH at current best market price
9. ETH lands directly in the user's wallet - never in any contract
10. User can cancel() at any time, immediately stopping future executions
```

### 4.3 The Execution Model

The executor bot is a dedicated off-chain service that:
- Indexes `SubscriptionCreated` and `SubscriptionCancelled` events from the Subscriptions contract
- Maintains an internal schedule of due subscription IDs
- At each due time, fetches swap calldata from the aggregator API, estimates gas, and submits `execute(subscriptionId)` signed by the bot's EOA
- Retries on transient failures (RPC timeouts, mempool congestion)
- Skips execution if gas exceeds a configured ceiling, and retries in the next window
- Never holds private keys to user wallets - only its own EOA key, stored in a secrets manager

The bot has a single, scoped permission: to call `execute()` on subscriptions that are due. It cannot modify subscription parameters, withdraw funds, or call any other contract function.

### 4.4 Price Aggregation

For each execution, SIPService queries a DEX aggregator - either 1inch or Paraswap - to find the best available swap price across all major liquidity sources (Uniswap, Curve, Balancer, and others). The aggregator returns optimized swap calldata that maximizes the amount of output token received for the given input.

This means every SIP execution gets the best available on-chain price at the moment of execution, not a fixed or platform-set rate. Users benefit from the same price optimization available to sophisticated DeFi traders - automatically, on a schedule.

The user's average cost basis improves over time not just through DCA mechanics, but through best-execution on each individual trade.

### 4.5 Fund Flow Diagram

```
User Wallet (USDC)
      │
      │  transferFrom (ERC-20 approval)
      ▼
Subscriptions.sol
      │
      │  forward to registered service
      ▼
SIPService.sol
      │
      │  swap calldata from aggregator (1inch/Paraswap)
      ▼
DEX Aggregator
      │
      │  purchased tokens (ETH/BTC/HYPE/Tokenized stocks)
      ▼
User Wallet

Funds are never held at rest in any contract.
Every step is a single atomic on-chain transaction.
```

---

## 5. Smart Contract Architecture

### 5.1 Subscriptions.sol

`Subscriptions.sol` is the core protocol contract. It is the only contract that users interact with directly (via `subscribe()` and `cancel()`).

**Storage:** Each subscription is stored as a struct containing: subscriber address, service address, spend token, amount per cycle, interval (in seconds), next execution timestamp, optional maximum execution count, and execution count to date.

**Key functions:**
- `subscribe(service, spendToken, amountPerCycle, interval, maxExecutions, permitData)` - Creates a new subscription. Validates that the registered service is whitelisted. Accepts either a pre-existing ERC-20 approval or an EIP-2612 Permit2 signature to avoid requiring a separate approval transaction.
- `cancel(subscriptionId)` - Deactivates a subscription. Can only be called by the subscriber. Takes effect immediately.
- `execute(subscriptionId)` - Executes a due subscription. Can only be called by the registered `executor` EOA. Validates timing, pulls funds via `transferFrom`, and calls `IService.execute()` on the registered service.
- `setExecutor(address)` - Admin function to update the executor EOA (owner only).
- `registerService(address)` / `removeService(address)` - Admin functions to whitelist/delist service contracts.
- `pause()` / `unpause()` - Circuit breaker. Halts all executions in an emergency (owner only).

**Inherited from OpenZeppelin:** `ReentrancyGuard`, `Pausable`, `Ownable`, `SafeERC20`.

### 5.2 SIPService.sol

`SIPService.sol` implements the `IService` interface. It is called by Subscriptions during execution and is responsible for converting the spend token into the buy token at the best available price.

**Key responsibilities:**
- Receives spend tokens from Subscriptions
- Calls the configured DEX aggregator (1inch or Paraswap) with pre-fetched swap calldata
- Validates that the output amount meets the user's slippage tolerance
- Transfers purchased tokens directly to the subscriber's wallet
- Collects the protocol fee ($0.10 maximum, deducted from the spend amount)
- Maintains a whitelist of supported buy tokens

The service contract has no ability to hold funds beyond a single transaction. If any step in the swap fails, the entire transaction reverts atomically.

### 5.3 IService Interface

The `IService` interface is the extension point for the protocol. Any contract implementing this interface can be registered as a service in Subscriptions, enabling recurring on-chain actions beyond token purchases.

```solidity
interface IService {
    function execute(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool);
}
```

Potential future services built on this interface include: recurring yield deposits, scheduled NFT purchases, recurring charitable donations in stablecoins, or automated portfolio rebalancing.

### 5.4 Extensibility: Beyond DCA

Subscriptions.sol is intentionally generic. The separation between the subscription management layer (Subscriptions.sol) and the action layer (IService implementations) means the same subscription infrastructure can power any recurring on-chain action.

This creates a platform, not just a product: third-party developers can deploy their own `IService` contracts and, once whitelisted, offer their services to SIP subscribers without rebuilding the subscription and scheduling infrastructure.

---

## 6. Security Model

### 6.1 Non-Custodial Guarantees

The protocol's non-custodial property is enforced architecturally, not by policy. It is not a promise - it is a consequence of the contract logic:

- `Subscriptions.sol` only moves funds via `transferFrom` during an active `execute()` call. It does not store a balance.
- `SIPService.sol` receives funds and must swap and deliver them in the same transaction. There is no state in which funds sit in the service contract between transactions.
- If a swap fails for any reason (insufficient output, slippage exceeded, aggregator failure), the entire transaction reverts and no funds move.
- The executor EOA has no access to user funds. It can only trigger the execution of subscriptions that are due - all value movement is handled by the contracts themselves.

Users do not need to trust SIP's operators. They need only to trust the audited contract code, which is open source and verifiable.

### 6.2 Access Controls

| Role | Permissions | Cannot Do |
|------|-------------|-----------|
| **User / Subscriber** | subscribe(), cancel() | Execute others' subscriptions |
| **Executor EOA** | execute() on due subscriptions | Modify subscriptions, move funds |
| **Owner (Multisig)** | Set executor, whitelist services, pause | Move user funds, modify subscriptions |
| **Anyone** | Read subscription state | Write to contracts |

The owner is a multisig wallet, not a single key. Protocol upgrades and emergency pauses require multiple signers.

### 6.3 What the Bot Can and Cannot Do

The executor bot's authority is deliberately minimized:

**Can do:**
- Call `execute(subscriptionId)` on subscriptions where `block.timestamp >= nextExecutionAt`
- Pay gas fees for executions (funded separately)

**Cannot do:**
- Access user wallets or private keys
- Modify subscription parameters (amount, interval, token)
- Cancel subscriptions
- Call any function other than `execute()`
- Move funds to any address other than what the contract specifies

If the bot were compromised, the attacker could at most trigger early execution of due subscriptions (bounded by contract timing checks) or cause missed executions by going offline. They could not steal funds.

### 6.4 Risk Vectors and Mitigations

| Risk | Description | Mitigation |
|------|-------------|------------|
| **Smart contract bug** | Vulnerability in Subscriptions or SIPService allows fund extraction | Third-party audit pre-mainnet; open source code; bug bounty program |
| **Executor key compromise** | Attacker gains access to executor EOA | Executor can only trigger due subscriptions; funds are unaffected; rotate key via owner multisig |
| **Aggregator failure** | 1inch/Paraswap returns bad calldata or goes offline | Transaction reverts atomically; no funds move; execution retried next window |
| **Slippage / MEV** | Sandwich attack extracts value during swap | User-configured slippage tolerance enforced in SIPService; MEV protection via private RPC (Flashbots Protect) |
| **ERC-20 approval abuse** | Approval set to unlimited amount is exploited | SIP uses Permit2 with exact-amount, time-limited signatures; users can set approval to minimum required |
| **Owner multisig compromise** | Attacker controls admin keys | Multisig requires multiple signers; timelock on sensitive operations; cannot access user funds regardless |
| **Price oracle manipulation** | Aggregator price is manipulated | No oracle dependency; market price is discovered live by the aggregator at execution time |

### 6.5 Audits

A full third-party security audit of `Subscriptions.sol` and `SIPService.sol` is planned prior to mainnet deployment. The audit will cover reentrancy, access control, token handling, arithmetic safety, and aggregator integration.

**Audit status:** Planned pre-mainnet. Audit firm to be confirmed.

Bug reports and responsible disclosure: [security contact to be added]

---

## 7. Supported Assets and Chains

### 7.1 Supported Spend Tokens (v1)

Users fund their SIPs using stablecoins, ensuring the fixed-dollar-amount property of DCA is preserved regardless of crypto market conditions:

- **USDC** - USD Coin (Circle). The primary spend token.
- **USDT** - Tether USD. Supported on chains where USDT liquidity is deep.

Native chain tokens (ETH, ARB) may be added in a future release, enabling ETH-denominated DCA into other assets.

### 7.2 Supported Buy Tokens (v1)

**Crypto assets:**
- BTC (wrapped: WBTC or native bridge equivalent)
- ETH
- HYPE (Hyperliquid)
- BNB

**Tokenized real-world assets (via Robinhood Chain):**
- Tesla (TSLA)
- Apple (AAPL)
- Google (GOOGL)
- Additional stocks to be confirmed at launch

Tokenized stocks on Robinhood Chain are issued as on-chain tokens representing fractional ownership in the underlying equity, enabling DCA into traditional equities through the same non-custodial mechanism as crypto assets. This is the first time retail investors can automate systematic investment into stocks without using a custodial broker.

### 7.3 Supported Chains (v1)

| Chain | Type | Notes |
|-------|------|-------|
| **Robinhood Chain** | Arbitrum-based L2 | Primary launch chain. Native support for tokenized stocks and crypto assets. |
| **Arbitrum** | Ethereum L2 | Deep DeFi liquidity. Low gas costs. Full EVM compatibility. |

Additional chains (Base, Optimism, Polygon) are on the roadmap for Phase 3.

### 7.4 Whitelisting Policy

All supported buy tokens and registered service contracts go through a review process before being made available to users:

- Smart contract or token contract is reviewed for known vulnerabilities
- Sufficient on-chain liquidity is verified (minimum depth to execute SIP orders without excessive slippage)
- Aggregator support is confirmed (1inch/Paraswap must include the token in routing)
- Tokenized stocks additionally require confirmation of the issuer's redemption and legal framework

The whitelist is managed by the protocol owner multisig. Token additions will eventually be governed by a community process.

---

## 8. Simulation and Transparency

### 8.1 Historical DCA Simulator

Before committing to any SIP, users can simulate how their chosen strategy would have performed historically. The SIP simulator ([sip.web3cook.com/simulate.html](https://sip.web3cook.com/simulate.html)) accepts:

- Token selection (BTC, ETH, BNB, SOL, HYPE)
- Investment amount per interval
- Interval (daily, weekly, monthly)
- Date range (custom start and end date)

The simulator replays the DCA strategy using historical OHLCV price data, computing the total amount invested, current portfolio value, unrealized P&L, and return multiple. No wallet is required.

### 8.2 DCA vs. Lump-Sum Comparison

The simulator surfaces a direct comparison between the DCA strategy and an equivalent lump-sum investment on the same start date. This gives users an honest picture of the trade-offs:

- **DCA typically underperforms lump sum in sustained bull markets** - because capital is deployed gradually into a rising asset.
- **DCA significantly outperforms lump sum in volatile or sideways markets** - because it accumulates more units during dips.
- **DCA wins on risk-adjusted returns** - lower variance, lower maximum drawdown, and better adherence to the plan.

The simulator makes these trade-offs visible without editorializing. Users can see for themselves. ([Try it here](https://sip.web3cook.com/simulate.html))

### 8.3 On-Chain Execution History

Every execution of a SIP subscription emits an `Executed` event on-chain, containing the subscription ID, amount spent, tokens received, and block timestamp. This data is:

- Publicly verifiable by anyone using a block explorer
- Accessible via the SIP dashboard for each user's wallet
- Queryable via subgraph for third-party integrations

Users never need to take SIP's word for what happened. Every trade is a matter of public record.

---

## 9. Fee Structure

SIP is designed to be the lowest-friction, most cost-transparent DCA product available. All fees are disclosed upfront and cannot change without a governance process.

### 9.1 Protocol Fee

SIP charges a flat **$0.10 per execution**, regardless of the investment amount. This fee is deducted from the spend amount before the swap.

| Investment amount | Frequency | Annual executions | Annual protocol fee | Protocol fee % |
|---|---|---|---|---|
| $100 | Weekly | 52 | $5.20 | 0.10% |
| $500 | Monthly | 12 | $1.20 | 0.02% |
| $50 | Daily | 365 | $36.50 | 0.20% |

For the vast majority of users, the protocol fee is lower than the fee charged by centralized DCA platforms (Coinbase charges 0.5–1.5% per recurring buy; Kraken charges 0.25–1.6%).

The fee is capped at $0.10 per execution. This cap is hardcoded in `SIPService.sol` and cannot be changed by the owner.

### 9.2 Gas Cost Model

Each SIP execution is an on-chain transaction. Gas costs are paid by the executor bot and are not charged to users. The protocol absorbs gas costs as an operational expense, recovered through the protocol fee.

On Arbitrum and Robinhood Chain (both Arbitrum-based), gas costs for a typical swap execution are $0.01–$0.05, well within the protocol fee margin at current gas prices.

If gas costs spike above a configured ceiling, the executor skips the execution window and retries in the next interval. Users are not charged for skipped executions.

### 9.3 Aggregator Fee

DEX aggregators (1inch, Paraswap) may charge a small positive-slippage fee or routing fee on swaps. These fees are absorbed into the swap output amount and are not separately itemized. Aggregator fees are typically 0.01–0.03% of the swap amount.

### 9.4 No Hidden Costs

| Cost | Who pays | Amount |
|------|----------|--------|
| Protocol fee | User (deducted from spend amount) | $0.10 per execution, flat |
| Gas | Executor bot (absorbed by protocol) | $0.01–$0.05 per execution |
| Aggregator fee | Embedded in swap price | ~0.01–0.03% |
| Slippage | User (market-determined) | Max 1% (user-configurable) |

There are no subscription fees, no platform fees, no withdrawal fees, and no performance fees.

---

## 10. Competitive Landscape

| Platform | Custodial | On-Chain | Non-Custodial | Tokenized Stocks | Open Source |
|----------|:---------:|:--------:|:-------------:|:----------------:|:-----------:|
| **SIP Protocol** | ✗ | ✓ | ✓ | ✓ | ✓ |
| Coinbase (recurring buys) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Kraken (recurring buys) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Binance (auto-invest) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Mean Finance | ✗ | ✓ | ✓ | ✗ | ✓ |
| DeFi Saver (automation) | ✗ | ✓ | ✓ | ✗ | ✓ |

**Mean Finance** ([mean.finance](https://mean.finance)) is the closest on-chain DCA protocol. It supports ERC-20 token pairs on multiple EVM chains. SIP differentiates by: (1) a simpler UX designed for retail investors, (2) native support for tokenized RWAs (stocks) via Robinhood Chain, (3) best-price execution via aggregator routing (Mean Finance uses fixed TWAP pairs), and (4) a built-in simulation tool for strategy validation.

---

## 11. Roadmap

### Phase 1 - Foundation (Current)

- Deploy and audit `Subscriptions.sol` and `SIPService.sol`
- Launch on **Robinhood Chain** (Arbitrum-based L2): the first DCA protocol native to a chain with tokenized stocks
- Enable DCA into: USDC → BTC, ETH, HYPE, TSLA, AAPL, GOOGL
- Launch the simulation tool at [sip.web3cook.com](https://sip.web3cook.com)
- Open beta for early users with executor bot running on Robinhood Chain and Arbitrum

### Phase 2 - Mainnet and Scale

- Full mainnet launch on Arbitrum following successful beta and audit
- Expand supported buy tokens based on community demand and liquidity
- Launch the full SIP dashboard: active subscriptions, execution history, aggregate P&L, portfolio view
- Implement the Create SIP multi-step flow with wallet connection (MetaMask, WalletConnect, Coinbase Wallet)
- Subgraph deployment for on-chain data indexing
- Transparent executor bot monitoring (public uptime and execution logs)

### Phase 3 - Expansion

- Expand to additional EVM chains: Base, Optimism, Polygon
- Raise institutional funding to support mobile app development and growth
- Mobile application (iOS and Android) with simplified key management for users unfamiliar with seed phrase custody
- Explore account abstraction (ERC-4337) for gasless SIP management - users pay no gas directly
- Open the `IService` interface to third-party service developers
- Community governance for token whitelisting and protocol parameter changes

---

## 12. Team

**Rohit Aggarwal** - CEO  
**Arham Chordia** - CTO  
**Garima Yadav** - CMO

---

## 13. Conclusion

Systematic investing is one of the most powerful and accessible tools for long-term wealth creation. Over 100 million people in India and comparable numbers in the US practice it in traditional asset classes. In crypto, demand is growing - but the infrastructure to do it non-custodially doesn't exist at scale.

SIP brings the DCA primitive on-chain. Users invest on their schedule, in assets they choose, with funds that never leave their control. Every execution is transparent, every trade is verifiable, and the user can walk away at any moment. No custodian, no counterparty risk, no lock-ups.

By launching first on Robinhood Chain, SIP occupies a unique position: the only automated DCA protocol that spans both crypto-native assets and tokenized real-world stocks, non-custodially, on-chain.

The technology is built. The demand is proven. The gap in the market is real.

---

## Appendix A: Contract Interface Reference

```solidity
interface IService {
    function execute(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool);
}
```

```solidity
struct Subscription {
    address subscriber;
    address service;
    address spendToken;
    uint256 amountPerCycle;
    uint256 interval;          // in seconds
    uint256 nextExecutionAt;   // unix timestamp
    uint256 maxExecutions;     // 0 = unlimited
    uint256 executionsCount;
    bool active;
}
```

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **SIP** | Systematic Investment Plan - a recurring, fixed-amount investment strategy |
| **DCA** | Dollar-Cost Averaging - investing a fixed amount at regular intervals regardless of price |
| **EOA** | Externally Owned Account - a standard Ethereum wallet controlled by a private key |
| **DEX** | Decentralized Exchange - a protocol for peer-to-peer token swaps on-chain |
| **DEX Aggregator** | A service (e.g., 1inch, Paraswap) that finds the best swap price across multiple DEXes |
| **ERC-20** | The standard token interface on Ethereum and EVM-compatible chains |
| **Permit2** | A Uniswap protocol for gasless, signature-based ERC-20 approvals with expiry |
| **L2** | Layer 2 - a blockchain that settles to Ethereum for security while reducing gas costs |
| **RWA** | Real-World Asset - a traditional financial asset (e.g., stock, bond) tokenized on-chain |
| **TWAP** | Time-Weighted Average Price - a trading strategy that spreads orders over time |
| **MEV** | Maximal Extractable Value - value extracted by reordering or sandwiching transactions |

## Appendix C: References

1. AMFI India - SIP Industry Data, 2026: https://www.amfiindia.com/research-information/mf-data
2. Vanguard Research - *How to invest*,: https://investor.vanguard.com/investor-resources-education/online-trading/dollar-cost-averaging-vs-lump-sum
3. Kraken - *DCA Strategy in Crypto*, 2024: https://www.kraken.com/learn/dca-strategy-crypto
4. Tom Nash - DCA thread, 2025: https://x.com/iamtomnash/status/1905179305056874920?s=20
5. JP Morgan - Guide to the Markets, Q1 2025: https://am.jpmorgan.com/us/en/asset-management/adv/insights/market-insights/guide-to-the-markets/
6. Bank of America Research - *Timing the market vs. time in the market*, 2022: https://www.investec.com/en_za/focus/investing/why-it-doesnt-pay-to-time-the-market.html
7. Mean Finance - On-chain DCA protocol: https://mean.finance
8. 1inch Network - DEX aggregation: https://1inch.io
9. Paraswap - DEX aggregation: https://www.paraswap.io
10. Uniswap Permit2 - https://github.com/Uniswap/permit2
11. OpenZeppelin Contracts - https://github.com/OpenZeppelin/openzeppelin-contracts
