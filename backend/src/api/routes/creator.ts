import { Router } from 'express'
import { isAddress } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail, money, tokenAmount } from '../response.js'
import { findOrCreateUser } from '../userdb.js'
import { newAgentId, newWithdrawalId } from '../ids.js'
import { serializeAgentCard, normalizeParamSchema, type AgentRow } from '../serializers.js'
import { generateAgentBlurb } from '../../utils/summarize.js'
import { getUsdcBalance } from '../chain.js'
import { logger } from '../../logger.js'

export const creatorRouter = Router()

const VALID_CATEGORIES = new Set(['finance', 'productivity', 'career', 'engineering', 'research', 'other'])
const VALID_MODES = new Set(['subscription', 'one_time', 'both'])
const VALID_PAYMENT_FREQUENCIES = new Set(['weekly', 'monthly', 'test_5min', 'test_2min'])

function validateAgentPayload(body: {
  name?: string
  category?: string
  description?: string
  short_description?: string
  services?: string[]
  mode?: string
  sub_price_amount?: string | number
  interval_seconds?: number
  one_time_price_amount?: string | number
  endpoint_url?: string
  payment_frequency?: string
}, requireFull: boolean): Record<string, string> | null {
  const errors: Record<string, string> = {}

  if (!body.name) errors['name'] = 'required'
  if (!body.category || !VALID_CATEGORIES.has(body.category)) errors['category'] = 'must be a valid agent_category'
  
  if (requireFull && !body.description && !body.short_description) {
    errors['description'] = 'required'
  }

  if (!body.mode || !VALID_MODES.has(body.mode)) {
    errors['mode'] = 'must be subscription, one_time, or both'
  } else {
    if (body.mode === 'subscription' || body.mode === 'both') {
      if (!body.sub_price_amount || !(Number(body.sub_price_amount) > 0)) {
        errors['sub_price_amount'] = 'must be > 0'
      }
      if (!body.interval_seconds || !(Number(body.interval_seconds) > 0)) {
        errors['interval_seconds'] = 'must be > 0'
      }
      if (body.payment_frequency && !VALID_PAYMENT_FREQUENCIES.has(body.payment_frequency)) {
        errors['payment_frequency'] = 'must be weekly, monthly, test_5min, or test_2min'
      }
    }
    if (body.mode === 'one_time' || body.mode === 'both') {
      if (!body.one_time_price_amount || !(Number(body.one_time_price_amount) > 0)) {
        errors['one_time_price_amount'] = 'must be > 0'
      }
    }
  }

  if (!Array.isArray(body.services) || body.services.length === 0) {
    errors['services'] = 'must be a non-empty array'
  }

  if (body.endpoint_url) {
    try {
      new URL(body.endpoint_url)
    } catch {
      errors['endpoint_url'] = 'must be a valid URL'
    }
  }

  return Object.keys(errors).length > 0 ? errors : null
}

async function loadAgentDetail(agentId: string): Promise<object | null> {
  const agentRes = await query<AgentRow & { live_subs: number | null }>(
    `SELECT a.*, COALESCE(sub.live_subs, 0) AS live_subs
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     WHERE a.agent_id = $1`,
    [agentId],
  )
  const agent = agentRes.rows[0]
  if (!agent) return null

  const card = serializeAgentCard(agent) as Record<string, unknown>
  card['subscriber_count'] = agent.base_subscriber_count + (agent.live_subs ?? 0)
  card['description'] = agent.description ?? agent.short_description
  return card
}

// POST /creator/agents/list
creatorRouter.post('/agents/list', async (req, res) => {
  const { user_address } = req.body as { user_address?: string }
  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const rows = await query<AgentRow & { live_subs: number | null; mrr: string | null }>(
    `SELECT a.*, COALESCE(sub.live_subs, 0) AS live_subs, COALESCE(mrr.total, 0) AS mrr
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     LEFT JOIN (
       SELECT s.agent_id, SUM(s.amount_per_cycle) AS total
       FROM subscriptions s
       WHERE s.status = 'active'
       GROUP BY s.agent_id
     ) mrr ON mrr.agent_id = a.agent_id
     WHERE a.publisher_user_id = $1
     ORDER BY a.created_at DESC`,
    [user.user_id],
  )

  const agents = rows.rows.map(row => ({
    agent_id: row.agent_id,
    name: row.name,
    icon: row.icon,
    logo: row.logo,
    category: row.category,
    tagline: row.tagline,
    status: row.status,
    subscriber_count: row.base_subscriber_count + (row.live_subs ?? 0),
    monthly_recurring_revenue: money(row.mrr || '0', 'USDC'),
    created_at: row.created_at.toISOString(),
  }))

  ok(res, 200, 'Data fetched successfully', { agents })
})

// POST /creator/agents/register
creatorRouter.post('/agents/register', async (req, res) => {
  const body = req.body as {
    user_address?: string
    name?: string
    category?: string
    description?: string
    short_description?: string
    icon?: string
    logo?: string
    logo_url?: string
    services?: string[]
    mode?: string
    sub_price_amount?: string | number
    interval_seconds?: number
    payment_frequency?: string
    one_time_price_amount?: string | number
    param_schema?: unknown
    service_address?: string
    onchain_agent_id?: string | number
    agent_card_uri?: string
    endpoint_url?: string
  }

  if (!body.user_address || !isAddress(body.user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const fieldErrors = validateAgentPayload(body, true)
  if (fieldErrors) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: fieldErrors })
    return
  }

  const user = await findOrCreateUser(body.user_address)
  const agentId = newAgentId()
  const slug = `${body.name!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${agentId.slice(-6).toLowerCase()}`

  const longDescription = (body.description ?? body.short_description ?? '').trim()
  const blurb = await generateAgentBlurb(body.name!, longDescription)
  // Icon is the square card avatar; logo falls back to the icon (and the
  // legacy logo_url field) so older clients keep working.
  const icon = body.icon?.trim() || body.logo_url?.trim() || null
  const logo = body.logo?.trim() || body.logo_url?.trim() || icon
  const paramSchema = normalizeParamSchema(body.param_schema)

  await query(
    `INSERT INTO agents (
      agent_id, slug, publisher_user_id, publisher_name, name, icon, logo, category, tagline, short_description, description,
      services, mode, sub_price_amount, sub_price_currency, interval_seconds, payment_frequency, one_time_price_amount,
      param_schema, service_address, onchain_agent_id, agent_card_uri, endpoint_url, trust_score, status, onchain
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'USDC',$15,$16,$17,$18,$19,$20,$21,$22,0,'live',true)`,
    [
      agentId,
      slug,
      user.user_id,
      user.handle ?? body.user_address,
      body.name,
      icon,
      logo,
      body.category,
      blurb.tagline,
      blurb.short_description,
      longDescription || blurb.short_description,
      body.services,
      body.mode,
      body.sub_price_amount ? String(body.sub_price_amount) : null,
      body.interval_seconds || null,
      body.payment_frequency || null,
      body.one_time_price_amount ? String(body.one_time_price_amount) : null,
      JSON.stringify(paramSchema),
      body.service_address || null,
      body.onchain_agent_id ? String(body.onchain_agent_id) : null,
      body.agent_card_uri || null,
      body.endpoint_url || null
    ],
  )

  const detail = await loadAgentDetail(agentId)
  ok(res, 201, 'Agent registered and live in the marketplace', { agent: detail })
})

// POST /creator/agents/update
creatorRouter.post('/agents/update', async (req, res) => {
  const body = req.body as {
    user_address?: string
    agent_id?: string
    name?: string
    category?: string
    description?: string
    short_description?: string
    services?: string[]
    mode?: string
    sub_price_amount?: string | number
    interval_seconds?: number
    one_time_price_amount?: string | number
    status?: string
  }

  if (!body.user_address || !isAddress(body.user_address, { strict: false }) || !body.agent_id) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', agent_id: 'required' } })
    return
  }

  const user = await findOrCreateUser(body.user_address)

  const agentRes = await query<{ agent_id: string; publisher_user_id: string | null }>(
    'SELECT agent_id, publisher_user_id FROM agents WHERE agent_id = $1',
    [body.agent_id],
  )
  const agent = agentRes.rows[0]
  if (!agent) {
    fail(res, 404, 'Agent not found', {})
    return
  }
  if (agent.publisher_user_id !== user.user_id) {
    fail(res, 403, 'You do not own this agent', {})
    return
  }

  const fieldErrors = validateAgentPayload(body, false)
  if (fieldErrors) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: fieldErrors })
    return
  }

  if (body.status !== undefined && body.status !== 'live' && body.status !== 'paused') {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { status: 'must be live or paused' } })
    return
  }

  const sets: string[] = []
  const params: unknown[] = []
  const addSet = (col: string, val: unknown): void => {
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }

  if (body.name !== undefined) addSet('name', body.name)
  if (body.category !== undefined) addSet('category', body.category)
  if (body.description !== undefined) addSet('description', body.description)
  if (body.short_description !== undefined) addSet('short_description', body.short_description)
  if (body.services !== undefined) addSet('services', body.services)
  if (body.mode !== undefined) addSet('mode', body.mode)
  if (body.sub_price_amount !== undefined) addSet('sub_price_amount', body.sub_price_amount ? String(body.sub_price_amount) : null)
  if (body.interval_seconds !== undefined) addSet('interval_seconds', body.interval_seconds || null)
  if (body.one_time_price_amount !== undefined) addSet('one_time_price_amount', body.one_time_price_amount ? String(body.one_time_price_amount) : null)
  if (body.status !== undefined) addSet('status', body.status)

  if (sets.length > 0) {
    params.push(body.agent_id)
    await query(`UPDATE agents SET ${sets.join(', ')} WHERE agent_id = $${params.length}`, params)
  }

  const detail = await loadAgentDetail(body.agent_id)
  ok(res, 200, 'Agent updated', { agent: detail })
})

// POST /creator/agents/subscribers
creatorRouter.post('/agents/subscribers', async (req, res) => {
  const { user_address, agent_id, page: pageRaw, limit: limitRaw } = req.body as {
    user_address?: string
    agent_id?: string
    page?: number
    limit?: number
  }

  if (!user_address || !isAddress(user_address, { strict: false }) || !agent_id) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', agent_id: 'required' } })
    return
  }

  const page = Math.max(1, Number(pageRaw) || 1)
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20))
  const offset = (page - 1) * limit

  const user = await findOrCreateUser(user_address)

  const agentRes = await query<{ agent_id: string; publisher_user_id: string | null }>(
    'SELECT agent_id, publisher_user_id FROM agents WHERE agent_id = $1',
    [agent_id],
  )
  const agent = agentRes.rows[0]
  if (!agent) {
    fail(res, 404, 'Agent not found', {})
    return
  }
  if (agent.publisher_user_id !== user.user_id) {
    fail(res, 403, 'You do not own this agent', {})
    return
  }

  const countRes = await query<{ count: string }>(
    'SELECT COUNT(*) FROM subscriptions WHERE agent_id = $1',
    [agent_id],
  )
  const totalItems = parseInt(countRes.rows[0]!.count)

  const rows = await query<{
    user_address: string
    handle: string | null
    subscription_id: string
    status: string
    started_at: Date
    last_payment_time: Date | null
  }>(
    `SELECT u.user_address, u.handle, s.id AS subscription_id, s.status, s.started_at, s.last_payment_time
     FROM subscriptions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.agent_id = $1
     ORDER BY s.started_at DESC
     LIMIT $2 OFFSET $3`,
    [agent_id, limit, offset],
  )

  const subscribers = rows.rows.map(r => ({
    user_address: r.user_address,
    handle: r.handle,
    subscription_id: r.subscription_id,
    status: r.status,
    started_at: r.started_at.toISOString(),
    last_payment_time: r.last_payment_time ? r.last_payment_time.toISOString() : null,
  }))

  ok(res, 200, 'Data fetched successfully', {
    subscribers,
    pagination: { page, limit, total_items: totalItems, total_pages: Math.ceil(totalItems / limit) },
  })
})

// POST /creator/agents/runs
// Execution history across the creator's agents (or a single agent if
// `agent_id` is given), so creators can see their subscribers' subscriptions
// being executed.
creatorRouter.post('/agents/runs', async (req, res) => {
  const { user_address, agent_id, page: pageRaw, limit: limitRaw } = req.body as {
    user_address?: string
    agent_id?: string
    page?: number
    limit?: number
  }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const page = Math.max(1, Number(pageRaw) || 1)
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20))
  const offset = (page - 1) * limit

  const user = await findOrCreateUser(user_address)

  let agentIds: string[]
  if (agent_id) {
    const agentRes = await query<{ agent_id: string; publisher_user_id: string | null }>(
      'SELECT agent_id, publisher_user_id FROM agents WHERE agent_id = $1',
      [agent_id],
    )
    const agent = agentRes.rows[0]
    if (!agent) {
      fail(res, 404, 'Agent not found', {})
      return
    }
    if (agent.publisher_user_id !== user.user_id) {
      fail(res, 403, 'You do not own this agent', {})
      return
    }
    agentIds = [agent_id]
  } else {
    const agentsRes = await query<{ agent_id: string }>(
      'SELECT agent_id FROM agents WHERE publisher_user_id = $1',
      [user.user_id],
    )
    agentIds = agentsRes.rows.map(r => r.agent_id)
  }

  if (agentIds.length === 0) {
    ok(res, 200, 'Data fetched successfully', { runs: [], pagination: { page, limit, total_items: 0, total_pages: 0 } })
    return
  }

  const countRes = await query<{ count: string }>('SELECT COUNT(*) FROM runs WHERE agent_id = ANY($1)', [agentIds])
  const totalItems = parseInt(countRes.rows[0]!.count)

  const rows = await query<{
    run_id: string
    agent_id: string
    agent_name: string
    agent_logo: string | null
    user_address: string
    handle: string | null
    subscription_id: string | null
    kind: string
    amount: string
    currency: string
    status_message: string | null
    link: string | null
    success: boolean
    tx_hash: string | null
    output_token_address: string | null
    output_amount: string | null
    ran_at: Date
  }>(
    `SELECT r.run_id, r.agent_id, a.name AS agent_name, a.logo AS agent_logo,
            u.user_address, u.handle, r.subscription_id, r.kind, r.amount, r.currency,
            r.status_message, r.link, r.success, r.tx_hash, r.output_token_address, r.output_amount, r.ran_at
     FROM runs r
     JOIN agents a ON a.agent_id = r.agent_id
     JOIN users u ON u.user_id = r.user_id
     WHERE r.agent_id = ANY($1)
     ORDER BY r.ran_at DESC LIMIT $2 OFFSET $3`,
    [agentIds, limit, offset],
  )

  const runs = rows.rows.map(r => ({
    run_id: r.run_id,
    agent_id: r.agent_id,
    agent: r.agent_name,
    agent_logo: r.agent_logo,
    user_address: r.user_address,
    handle: r.handle,
    subscription_id: r.subscription_id,
    kind: r.kind,
    amount: money(r.amount, r.currency),
    received: r.output_amount ? tokenAmount(r.output_amount, 'WETH') : null,
    status_message: r.status_message,
    link: r.link,
    success: r.success,
    tx_hash: r.tx_hash,
    ran_at: r.ran_at.toISOString(),
  }))

  ok(res, 200, 'Data fetched successfully', {
    runs,
    pagination: { page, limit, total_items: totalItems, total_pages: Math.ceil(totalItems / limit) },
  })
})

// POST /creator/earnings
creatorRouter.post('/earnings', async (req, res) => {
  const { user_address } = req.body as { user_address?: string }
  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const agentsRes = await query<{ agent_id: string; name: string; base_subscriber_count: number; live_subs: number | null; mrr: string | null; service_address: string | null; lifetime: string | null }>(
    `SELECT a.agent_id, a.name, a.base_subscriber_count, a.service_address, COALESCE(sub.live_subs, 0) AS live_subs, COALESCE(mrr.total, 0) AS mrr, COALESCE(rev.total, 0) AS lifetime
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     LEFT JOIN (
       SELECT s.agent_id, SUM(s.amount_per_cycle) AS total
       FROM subscriptions s
       WHERE s.status = 'active'
       GROUP BY s.agent_id
     ) mrr ON mrr.agent_id = a.agent_id
     LEFT JOIN (
       SELECT r.agent_id, SUM(r.amount) AS total
       FROM runs r
       WHERE r.success = true
       GROUP BY r.agent_id
     ) rev ON rev.agent_id = a.agent_id
     WHERE a.publisher_user_id = $1`,
    [user.user_id],
  )

  const agentIds = agentsRes.rows.map(r => r.agent_id)
  const serviceAddresses = agentsRes.rows.map(r => r.service_address).filter(Boolean) as string[]

  const grossMrr = agentsRes.rows.reduce((sum, r) => sum + Number(r.mrr ?? 0), 0)
  const activeSubscribers = agentsRes.rows.reduce((sum, r) => sum + r.base_subscriber_count + (r.live_subs ?? 0), 0)

  let lifetimeRevenue = 0
  if (agentIds.length > 0) {
    const lifetimeRes = await query<{ total: string | null }>(
      `SELECT SUM(amount) AS total
       FROM runs
       WHERE agent_id = ANY($1) AND success = true`,
      [agentIds],
    )
    lifetimeRevenue = Number(lifetimeRes.rows[0]?.total ?? 0)
  }

  // Trailing 8 months, oldest first
  const revenueByMonth: { month: string; amount: object }[] = []
  const now = new Date()
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    let amountVal = 0
    if (agentIds.length > 0) {
      const monthRes = await query<{ total: string | null }>(
        `SELECT SUM(amount) AS total
         FROM runs
         WHERE agent_id = ANY($1) AND success = true
           AND date_trunc('month', ran_at) = $2`,
        [agentIds, d],
      )
      amountVal = Number(monthRes.rows[0]?.total ?? 0)
    }
    revenueByMonth.push({ month: monthKey, amount: money(amountVal, 'USDC') })
  }

  // Fetch withdrawals
  let withdrawals: object[] = []
  let totalWithdrawn = 0
  if (agentIds.length > 0) {
    const wRes = await query<{ withdrawal_id: string; agent_id: string | null; amount: string; currency: string; tx_hash: string | null; withdrawn_at: Date }>(
      `SELECT withdrawal_id, agent_id, amount, currency, tx_hash, withdrawn_at
       FROM withdrawals WHERE agent_id = ANY($1) ORDER BY withdrawn_at DESC LIMIT 12`,
      [agentIds],
    )
    withdrawals = wRes.rows.map(w => ({
      withdrawal_id: w.withdrawal_id,
      agent_id: w.agent_id,
      amount: money(w.amount, w.currency),
      tx_hash: w.tx_hash,
      withdrawn_at: w.withdrawn_at.toISOString(),
    }))

    const sumW = await query<{ total: string | null }>(
      'SELECT SUM(amount) AS total FROM withdrawals WHERE agent_id = ANY($1)',
      [agentIds]
    )
    totalWithdrawn = Number(sumW.rows[0]?.total ?? 0)
  }

  // Live withdrawable balances read from contracts in parallel
  let withdrawableBalance = 0
  for (const sAddr of serviceAddresses) {
    try {
      const bal = await getUsdcBalance(sAddr as `0x${string}`)
      withdrawableBalance += Number(bal)
    } catch (err) {
      logger.warn({ err, service_address: sAddr }, 'failed to read live Service USDC balance')
    }
  }

  const earningsByAgent = agentsRes.rows.map(r => ({
    agent_id: r.agent_id,
    agent_name: r.name,
    subscriber_count: r.base_subscriber_count + (r.live_subs ?? 0),
    monthly_recurring_revenue: money(r.mrr || '0', 'USDC'),
    lifetime_revenue: money(r.lifetime || '0', 'USDC'),
    service_address: r.service_address,
  }))

  ok(res, 200, 'Data fetched successfully', {
    stats: {
      monthly_recurring_revenue: money(grossMrr, 'USDC'),
      active_subscribers: activeSubscribers,
      subscriber_change: 0,
      withdrawable_balance: money(withdrawableBalance, 'USDC'),
      total_withdrawn: money(totalWithdrawn, 'USDC'),
      lifetime_revenue: money(lifetimeRevenue, 'USDC'),
    },
    revenue_by_month: revenueByMonth,
    withdrawals,
    earnings_by_agent: earningsByAgent,
  })
})
