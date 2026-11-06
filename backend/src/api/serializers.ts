import { money } from './response.js'

export interface SubscriptionJoinRow {
  id: string
  status: string
  usage_count: number
  last_payment_amount: string | null
  last_payment_time: Date | null
  next_payment_amount: string | null
  next_payment_time: Date | null
  started_at: Date
  cancelled_at: Date | null
  agent_id: string
  agent_name: string
  agent_logo: string | null
  service_address: string | null
  onchain_sub_id: string | null
  amount_per_cycle: string | null
  interval_seconds: number | null
  payment_frequency: string | null
}

export function serializeSubscription(row: SubscriptionJoinRow): object {
  return {
    id: row.id,
    agent_id: row.agent_id,
    agent: row.agent_name,
    logo: row.agent_logo,
    status: row.status,
    service_address: row.service_address,
    onchain_sub_id: row.onchain_sub_id,
    amount_per_cycle: row.amount_per_cycle !== null ? money(row.amount_per_cycle, 'USDC') : null,
    interval_seconds: row.interval_seconds,
    last_payment_amount: row.last_payment_amount !== null ? money(row.last_payment_amount, 'USDC') : null,
    last_payment_time: row.last_payment_time ? row.last_payment_time.toISOString() : null,
    next_payment_amount: row.status === 'cancelled' || row.next_payment_amount === null ? null : money(row.next_payment_amount, 'USDC'),
    next_payment_time: row.status === 'cancelled' || row.next_payment_time === null ? null : row.next_payment_time.toISOString(),
    started_at: row.started_at.toISOString(),
    cancelled_at: row.cancelled_at ? row.cancelled_at.toISOString() : null,
  }
}

/** A single input field an agent requires from a subscriber. */
export interface ParamField {
  key: string
  label: string
  type: 'text' | 'number'
  required: boolean
  placeholder?: string
}

/** Coerce arbitrary JSON into a clean, validated ParamField[]. */
export function normalizeParamSchema(raw: unknown): ParamField[] {
  if (!Array.isArray(raw)) return []
  const fields: ParamField[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const label = typeof o['label'] === 'string' ? o['label'].trim() : ''
    if (!label) continue
    const rawKey = typeof o['key'] === 'string' && o['key'].trim() ? o['key'] : label
    const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${fields.length + 1}`
    const type = o['type'] === 'number' ? 'number' : 'text'
    fields.push({
      key,
      label,
      type,
      required: o['required'] !== false,
      ...(typeof o['placeholder'] === 'string' ? { placeholder: o['placeholder'] } : {}),
    })
  }
  return fields
}

export interface AgentRow {
  agent_id: string
  slug: string
  publisher_user_id: string | null
  publisher_name: string | null
  name: string
  icon: string | null
  logo: string | null
  category: string
  tagline: string | null
  short_description: string | null
  description: string | null
  services: string[]
  mode: string
  sub_price_amount: string | null
  sub_price_currency: string
  interval_seconds: number | null
  payment_frequency: string | null
  one_time_price_amount: string | null
  param_schema: unknown
  service_address: string | null
  onchain_agent_id: string | null
  agent_card_uri: string | null
  endpoint_url: string | null
  trust_score: number
  rating: string
  rating_count: number
  base_subscriber_count: number
  status: string
  onchain: boolean
  created_at: Date
}

export function serializeAgentCard(row: AgentRow): object {
  return {
    agent_id: row.agent_id,
    slug: row.slug,
    publisher_user_id: row.publisher_user_id,
    publisher_name: row.publisher_name,
    name: row.name,
    icon: row.icon,
    logo: row.logo,
    category: row.category,
    tagline: row.tagline,
    short_description: row.short_description,
    description: row.description,
    services: row.services,
    mode: row.mode,
    sub_price: row.sub_price_amount !== null
      ? money(row.sub_price_amount, row.sub_price_currency || 'USDC')
      : null,
    interval_seconds: row.interval_seconds,
    payment_frequency: row.payment_frequency,
    one_time_price: row.one_time_price_amount !== null
      ? money(row.one_time_price_amount, 'USDC')
      : null,
    param_schema: normalizeParamSchema(row.param_schema),
    service_address: row.service_address,
    onchain_agent_id: row.onchain_agent_id ? row.onchain_agent_id.toString() : null,
    agent_card_uri: row.agent_card_uri,
    trust_score: row.trust_score,
    rating: Number(row.rating),
    rating_count: row.rating_count,
    subscriber_count: 0, // Overridden by caller with live count if needed
    status: row.status,
    onchain: row.onchain,
    created_at: row.created_at.toISOString(),
  }
}
