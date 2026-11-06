import { arbitrumSepolia } from "wagmi/chains";
import type { BillingInterval } from "./api/types";

/**
 * On-chain config for the Daemon contracts (Arbitrum Sepolia).
 * Addresses come from contracts/deployments/arbitrum-sepolia.json after
 * running DeployTestnet.s.sol, then paste them into .env.local.
 */
export const CONTRACT_CHAIN = arbitrumSepolia;

export const SERVICE_FACTORY_ADDRESS = process.env
  .NEXT_PUBLIC_SERVICE_FACTORY_ADDRESS as `0x${string}` | undefined;

export const SUBSCRIPTIONS_ADDRESS = process.env
  .NEXT_PUBLIC_SUBSCRIPTIONS_ADDRESS as `0x${string}` | undefined;

export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as | `0x${string}` | undefined;

export const USDC_DECIMALS = 6;

export const WETH_ADDRESS = process.env.NEXT_PUBLIC_WETH_ADDRESS as `0x${string}` | undefined;

export const WBTC_ADDRESS = process.env.NEXT_PUBLIC_WBTC_ADDRESS as `0x${string}` | undefined;

export const AGGREGATOR_ADDRESS = process.env
  .NEXT_PUBLIC_AGGREGATOR_ADDRESS as `0x${string}` | undefined;

/** Output tokens a DCA agent can swap into, available for selection at registration. */
export const DCA_OUTPUT_TOKENS: { symbol: string; address?: `0x${string}` }[] = [
  { symbol: "WETH", address: WETH_ADDRESS },
  { symbol: "WBTC", address: WBTC_ADDRESS },
];

/** Max fee (bps) hard cap and default starting fee for newly created SIPServices. */
export const SIP_SERVICE_MAX_FEE_BPS = 100;
export const SIP_SERVICE_DEFAULT_FEE_BPS = 0;

/** Canonical Permit2, same address on every EVM chain. */
export const PERMIT2_ADDRESS =
  "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`;

/**
 * How long a subscription's Permit2 allowance stays valid (its permitExpiry).
 * The on-chain subscription auto-renews each cycle until this window closes.
 */
export const SUBSCRIPTION_DURATION_SECONDS = 365 * 24 * 60 * 60; // 1 year

/** Seconds between executions for each billing interval. */
export function billingIntervalSeconds(interval: BillingInterval): number {
  switch (interval) {
    case "weekly":
      return 7 * 24 * 60 * 60;
    case "test_5min":
      return 5 * 60;
    case "test_2min":
      return 2 * 60;
    case "monthly":
    default:
      return 30 * 24 * 60 * 60;
  }
}

/** Minimal ABI for ServiceFactory: createService + registerAgent + events. */
export const serviceFactoryAbi = [
  {
    type: "function",
    name: "createService",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feeReceiver", type: "address" },
      { name: "spendToken", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "interval", type: "uint32" },
      { name: "agentCardURI", type: "string" },
    ],
    outputs: [
      { name: "service", type: "address" },
      { name: "agentId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "createSwapService",
    stateMutability: "nonpayable",
    inputs: [
      { name: "feeReceiver", type: "address" },
      { name: "spendToken", type: "address" },
      { name: "minAmountPerCycle", type: "uint256" },
      { name: "interval", type: "uint32" },
      { name: "agentCardURI", type: "string" },
      { name: "maxFee", type: "uint256" },
      { name: "aggregator", type: "address" },
      { name: "outputTokens", type: "address[]" },
      { name: "fee", type: "uint256" },
    ],
    outputs: [
      { name: "service", type: "address" },
      { name: "agentId", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "registerAgent",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentCardURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "event",
    name: "ServiceCreated",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "service", type: "address", indexed: true },
      { name: "spendToken", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "feeReceiver", type: "address", indexed: false },
      { name: "agentId", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
    ],
  },
] as const;

/** Minimal ABI for Subscriptions.subscribe + its event. */
export const subscriptionsAbi = [
  {
    type: "function",
    name: "subscribe",
    stateMutability: "nonpayable",
    inputs: [
      { name: "service", type: "address" },
      { name: "spendToken", type: "address" },
      { name: "amountPerCycle", type: "uint256" },
      { name: "interval", type: "uint256" },
      {
        name: "permitSingle",
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "params", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancel",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "event",
    name: "SubscriptionCreated",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "subscriber", type: "address", indexed: true },
      { name: "service", type: "address", indexed: true },
      { name: "spendToken", type: "address", indexed: false },
      { name: "amountPerCycle", type: "uint96", indexed: false },
      { name: "interval", type: "uint32", indexed: false },
      { name: "permitExpiry", type: "uint48", indexed: false },
      { name: "params", type: "bytes", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SubscriptionCancelled",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "subscriber", type: "address", indexed: true },
    ],
  },
] as const;

/** Permit2 nonce lookup for building a PermitSingle. */
export const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

/** Minimal ABI for Service.withdraw (creator sweeps accrued fees to feeReceiver). */
export const serviceAbi = [
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** EIP-712 types for Permit2's PermitSingle, must match Permit2 exactly. */
export const permit2Types = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
} as const;
