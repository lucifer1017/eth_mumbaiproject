// Types mirror API_SPEC.md (snake_case). Keep both in sync.

export type AgentMode = "subscription" | "one_time" | "both";
export type BillingInterval = "weekly" | "monthly" | "test_5min" | "test_2min";
export type SubscriptionStatus = "active" | "cancelled" | "expired" | "past_due";
export type AgentStatus = "draft" | "live" | "paused" | "delisted";
export type RunKind = "subscription" | "one_time";
export type UserRole = "subscriber" | "creator";
export type AgentCategory =
  | "finance"
  | "productivity"
  | "career"
  | "engineering"
  | "research"
  | "other";
export type SortOption = "popular" | "rating" | "price_asc" | "price_desc" | "newest";

export interface Money {
  amount: string;
  currency: string;
}

/** An input field an agent requires from a subscriber at subscribe/invoke time. */
export interface ParamField {
  key: string;
  label: string;
  type: "text" | "number";
  required: boolean;
  placeholder?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total_items: number;
  total_pages: number;
}

export interface User {
  user_id: string;
  user_address: string;
  handle: string | null;
  roles: UserRole[];
  created_at: string;
}

export interface Agent {
  agent_id: string;
  /** Service contract; null for one_time-only agents. */
  service_address: string | null;
  /** ERC-8004 identity token id (uint256 as string). */
  onchain_agent_id: string;
  name: string;
  icon: string;
  logo: string;
  category: AgentCategory;
  tagline: string;
  short_description: string;
  services: string[];
  mode: AgentMode;
  /** Subscription price per cycle; null unless subscription/both. */
  sub_price: Money | null;
  payment_frequency: BillingInterval | null;
  /** x402 price per run; null unless one_time/both. */
  one_time_price: Money | null;
  /** 0..100 from the ValidationRegistry, display only. */
  trust_score: number;
  rating: number;
  rating_count: number;
  subscriber_count: number;
  publisher_name: string;
  status: AgentStatus;
  created_at: string;
}

export interface AgentDetail extends Agent {
  description: string;
  interval_seconds: number | null;
  param_schema: ParamField[];
}

export interface Subscription {
  id: string;
  agent_id: string;
  agent: string;
  logo: string;
  status: SubscriptionStatus;
  billing_interval: BillingInterval;
  onchain_sub_id: string;
  last_payment_amount: Money | null;
  last_payment_time: string | null;
  next_payment_amount: Money | null;
  next_payment_time: string | null;
  started_at: string;
  cancelled_at: string | null;
}

/** One entry in the money + status ledger (a subscription cycle or one-time run). */
export interface Run {
  run_id: string;
  agent_id: string;
  agent: string;
  kind: RunKind;
  amount: Money;
  /** Output token received from a DCA swap (e.g. WETH); null for non-swap runs. */
  received: Money | null;
  status_message: string | null;
  link: string | null;
  success: boolean;
  tx_hash: string | null;
  ran_at: string;
}

export interface CreatorAgent {
  agent_id: string;
  name: string;
  icon: string;
  logo: string;
  category: AgentCategory;
  tagline: string;
  mode: AgentMode;
  status: AgentStatus;
  trust_score: number;
  subscriber_count: number;
  monthly_recurring_revenue: Money;
  created_at: string;
}

export interface SubscriberRow {
  user_address: string;
  handle: string | null;
  subscription_id: string;
  status: SubscriptionStatus;
  started_at: string;
  last_payment_time: string | null;
}

/** A run on one of a creator's agents, with the subscriber who triggered it. */
export interface CreatorRun {
  run_id: string;
  agent_id: string;
  agent: string;
  agent_logo: string | null;
  user_address: string;
  handle: string | null;
  subscription_id: string | null;
  kind: RunKind;
  amount: Money;
  /** Output token received from a DCA swap (e.g. WETH); null for non-swap runs. */
  received: Money | null;
  status_message: string | null;
  link: string | null;
  success: boolean;
  tx_hash: string | null;
  ran_at: string;
}

// ── request payloads ──────────────────────────────

export interface RegisterAgentInput {
  user_address: string;
  /** Service contract from createService(); null for one_time-only agents. */
  service_address: string | null;
  /** ERC-8004 agentId minted at registration. */
  onchain_agent_id: string;
  agent_card_uri: string;
  endpoint_url: string;
  mode: AgentMode;
  name: string;
  /** Square icon/avatar image URL shown on the agent card. */
  icon: string;
  /** Logo image URL; falls back to the icon / a monogram when empty. */
  logo: string;
  category: AgentCategory;
  description: string;
  services: string[];
  param_schema: ParamField[];
  sub_price: Money | null;
  payment_frequency: BillingInterval | null;
  one_time_price: Money | null;
}

export interface UpdateAgentInput {
  user_address: string;
  agent_id: string;
  name?: string;
  category?: AgentCategory;
  description?: string;
  services?: string[];
  status?: "live" | "paused";
}

// ── response `details` payloads ───────────────────

export interface AgentListDetails {
  agents: Agent[];
  pagination: Pagination;
}

export interface AgentDetailDetails {
  agent: AgentDetail;
}

export interface NonceDetails {
  nonce: string;
  sign_message: string;
  expires_at: string;
}

export interface VerifyDetails {
  is_new_user: boolean;
  user: User;
}

export interface UserDetails {
  user: User;
}

export interface SubscriptionListDetails {
  subscriptions: Subscription[];
  summary: {
    active_count: number;
    monthly_total: Money;
  };
}

export interface CreateSubscriptionDetails {
  subscription: Subscription;
}

export interface CancelSubscriptionDetails {
  subscription: Subscription;
}

export interface RunListDetails {
  runs: Run[];
  summary: { total_spent: Money };
  pagination: Pagination;
}

export interface RecordRunDetails {
  run: Run;
}

export interface CreatorAgentListDetails {
  agents: CreatorAgent[];
}

export interface SubscriberListDetails {
  subscribers: SubscriberRow[];
  pagination: Pagination;
}

export interface CreatorRunListDetails {
  runs: CreatorRun[];
  pagination: Pagination;
}

export interface AgentMutationDetails {
  agent: AgentDetail;
}

export interface EarningsDetails {
  stats: {
    monthly_recurring_revenue: Money;
    active_subscribers: number;
    subscriber_change: number;
    withdrawable_balance: Money;
    lifetime_revenue: Money;
    total_withdrawn: Money;
  };
  revenue_by_month: { month: string; amount: Money }[];
  withdrawals: {
    withdrawal_id: string;
    agent_id: string;
    amount: Money;
    tx_hash: string;
    withdrawn_at: string;
  }[];
  earnings_by_agent: {
    agent_id: string;
    agent_name: string;
    subscriber_count: number;
    monthly_recurring_revenue: Money;
    lifetime_revenue: Money;
    withdrawable_balance: Money;
    service_address: string | null;
  }[];
}

export interface PlatformConfigDetails {
  /** Permit2 spender for one-time agent payments; the executor's signer address. */
  platform_wallet_address: `0x${string}`;
}
