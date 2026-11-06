import { Router } from 'express'
import { isAddress, formatUnits } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail, money } from '../response.js'
import { newRunId } from '../ids.js'
import { serializeAgentCard, type AgentRow } from '../serializers.js'
import { config } from '../../config.js'
import { findOrCreateUser } from '../userdb.js'
import { buildClients } from '../../chain/client.js'
import { X402Client } from '../../x402/client.js'
import { logger } from '../../logger.js'
import { parseUnits } from 'viem'
import { AgentInvokeService } from '../../agent-invoke/invoke.js'

export const marketplaceRouter = Router()

const x402Clients = buildClients(config.rpcUrl, config.chainId, config.privateKey)
const x402Client  = new X402Client(x402Clients, config.usdcAddr)
const agentInvokeService = new AgentInvokeService(x402Clients, x402Client)

interface PermitSingleInput {
  details: { token: string; amount: string; expiration: number; nonce: number }
  spender: string
  sigDeadline: string
}

const VALID_CATEGORIES = new Set(['finance', 'productivity', 'career', 'engineering', 'research', 'other'])
const VALID_SORTS = new Set(['popular', 'rating', 'price_asc', 'price_desc', 'newest'])

function sortClause(sort: string): string {
  switch (sort) {
    case 'rating':     return 'a.rating DESC'
    case 'price_asc':  return 'COALESCE(a.sub_price_amount, a.one_time_price_amount) ASC NULLS LAST'
    case 'price_desc': return 'COALESCE(a.sub_price_amount, a.one_time_price_amount) DESC NULLS LAST'
    case 'newest':     return 'a.created_at DESC'
    case 'popular':
    default:           return 'subscriber_count DESC'
  }
}

// GET /agents
marketplaceRouter.get('/', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined
  const search   = typeof req.query.search === 'string' ? req.query.search : undefined
  const sort     = typeof req.query.sort === 'string' && VALID_SORTS.has(req.query.sort) ? req.query.sort : 'popular'
  const page     = Math.max(1, parseInt(String(req.query.page ?? '1')) || 1)
  const limit    = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20')) || 20))
  const offset   = (page - 1) * limit

  if (category !== undefined && !VALID_CATEGORIES.has(category)) {
    fail(res, 404, 'Agents not found', {})
    return
  }

  const conditions: string[] = [`a.status = 'live'`]
  const params: unknown[] = []

  if (category) {
    params.push(category)
    conditions.push(`a.category = $${params.length}`)
  }
  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(a.name ILIKE $${params.length} OR a.short_description ILIKE $${params.length})`)
  }

  const where = conditions.join(' AND ')

  const baseFrom = `
    FROM agents a
    LEFT JOIN (
      SELECT agent_id, COUNT(*)::int AS live_subs
      FROM subscriptions WHERE status = 'active' GROUP BY agent_id
    ) sub ON sub.agent_id = a.agent_id
    WHERE ${where}
  `

  const countRes = await query<{ count: string }>(`SELECT COUNT(*) ${baseFrom}`, params)
  const totalItems = parseInt(countRes.rows[0]!.count)

  if (totalItems === 0) {
    ok(res, 200, 'Data fetched successfully', {
      agents: [],
      pagination: { page, limit, total_items: 0, total_pages: 0 },
    })
    return
  }

  const rowsRes = await query<AgentRow & { live_subs: number | null }>(
    `SELECT a.*,
            COALESCE(sub.live_subs, 0) AS live_subs,
            (a.base_subscriber_count + COALESCE(sub.live_subs, 0)) AS subscriber_count
     ${baseFrom}
     ORDER BY ${sortClause(sort)}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  )

  const agents = rowsRes.rows.map(row => {
    const card = serializeAgentCard(row) as Record<string, unknown>
    card['subscriber_count'] = row.base_subscriber_count + (row.live_subs ?? 0)
    return card
  })

  ok(res, 200, 'Data fetched successfully', {
    agents,
    pagination: { page, limit, total_items: totalItems, total_pages: Math.ceil(totalItems / limit) },
  })
})

// GET /agents/:agent_id
marketplaceRouter.get('/:agent_id', async (req, res) => {
  const { agent_id } = req.params

  const agentRes = await query<AgentRow & { live_subs: number | null }>(
    `SELECT a.*, COALESCE(sub.live_subs, 0) AS live_subs
     FROM agents a
     LEFT JOIN (
       SELECT agent_id, COUNT(*)::int AS live_subs
       FROM subscriptions WHERE status = 'active' GROUP BY agent_id
     ) sub ON sub.agent_id = a.agent_id
     WHERE a.agent_id = $1`,
    [agent_id],
  )

  const agent = agentRes.rows[0]
  if (!agent) {
    fail(res, 404, 'Agent not found', {})
    return
  }

  const card = serializeAgentCard(agent) as Record<string, unknown>
  card['subscriber_count'] = agent.base_subscriber_count + (agent.live_subs ?? 0)
  card['from_price'] = agent.sub_price_amount 
    ? money(agent.sub_price_amount, agent.sub_price_currency || 'USDC') 
    : agent.one_time_price_amount 
      ? money(agent.one_time_price_amount, 'USDC') 
      : null
  card['description'] = agent.description ?? agent.short_description

  ok(res, 200, 'Data fetched successfully', { agent: card })
})

// GET /agents/:onchain_agent_id/card.json (AgentCard ERC-8004 hosting)
marketplaceRouter.get('/:onchain_agent_id/card.json', async (req, res) => {
  const { onchain_agent_id } = req.params

  const agentRes = await query<{
    onchain_agent_id: string
    name: string
    description: string | null
    short_description: string | null
    services: string[]
    endpoint_url: string | null
    service_address: string | null
    user_address: string | null
  }>(
    `SELECT a.onchain_agent_id, a.name, a.description, a.short_description, a.services, a.endpoint_url, a.service_address, u.user_address
     FROM agents a
     LEFT JOIN users u ON u.user_id = a.publisher_user_id
     WHERE a.onchain_agent_id::text = $1`,
    [onchain_agent_id],
  )

  const agent = agentRes.rows[0]
  if (!agent) {
    res.status(404).json({ error: 'AgentCard not found' })
    return
  }

  res.json({
    agentId: agent.onchain_agent_id,
    name: agent.name,
    description: agent.description ?? agent.short_description,
    capabilities: agent.services,
    serviceEndpoints: agent.endpoint_url ? [agent.endpoint_url] : [],
    x402PaymentAddress: agent.user_address,
    service_address: agent.service_address
  })
})

// POST /agents/:agent_id/invoke — runs a one-time agent's paid x402 endpoint.
// Settles the subscriber's Permit2-signed fee, splits it between the platform
// and the creator, and delegates to AgentInvokeService to call the agent and
// return its report (see ../../agent-invoke/invoke.ts).
marketplaceRouter.post('/:agent_id/invoke', async (req, res) => {
  const { agent_id } = req.params
  const body = req.body as {
    param_values?: Record<string, string>
    permit?: { owner: string; permitSingle: PermitSingleInput; signature: string }
  }
  const paramValues = body.param_values ?? {}
  const permit = body.permit

  if (!permit) {
    fail(res, 402, 'Payment required', { error_code: 'payment_required' })
    return
  }

  const agentRes = await query<{
    agent_id: string; name: string; mode: string
    one_time_price_amount: string | null; agent_invoke_fee: string | null; endpoint_url: string | null
    creator_address: string | null
  }>(
    `SELECT a.agent_id, a.name, a.mode, a.one_time_price_amount, a.agent_invoke_fee, a.endpoint_url, u.user_address AS creator_address
     FROM agents a LEFT JOIN users u ON u.user_id = a.publisher_user_id
     WHERE a.agent_id = $1`,
    [agent_id],
  )
  const agent = agentRes.rows[0]
  if (!agent || (agent.mode !== 'one_time' && agent.mode !== 'both')) {
    fail(res, 404, 'Agent not found', {})
    return
  }
  if (!agent.endpoint_url) {
    fail(res, 502, 'Agent has no endpoint configured', { error_code: 'no_endpoint' })
    return
  }
  if (!agent.one_time_price_amount || !agent.creator_address) {
    fail(res, 502, 'Agent is not configured for one-time payments', { error_code: 'no_payout_address' })
    return
  }

  // ── Settle the one-time fee from the subscriber via Permit2, split between
  // the platform (executor wallet) and the creator, then have the executor
  // call the agent's paid endpoint and return its report. The subscriber
  // signed a PermitSingle naming the platform wallet as spender.
  const owner   = permit.owner as `0x${string}`
  const creator = agent.creator_address as `0x${string}`
  const ps      = permit.permitSingle
  const permitSingle = {
    details: {
      token:      ps.details.token as `0x${string}`,
      amount:     BigInt(ps.details.amount),
      expiration: ps.details.expiration,
      nonce:      ps.details.nonce,
    },
    spender:     ps.spender as `0x${string}`,
    sigDeadline: BigInt(ps.sigDeadline),
  }
  const agentInvokeFee = parseUnits(agent.agent_invoke_fee ?? '0', 6)

  let result: Awaited<ReturnType<typeof agentInvokeService.run>>
  try {
    const invokeUrl = `${agent.endpoint_url.replace(/\/$/, '')}/v1/invoke`
    result = await agentInvokeService.run({
      owner,
      creator,
      permitSingle,
      signature: permit.signature as `0x${string}`,
      agentInvokeFee,
      invokeUrl,
      paramValues,
    })
  } catch (err) {
    logger.error({ err, agent_id }, 'invoke: agent-invoke flow failed')
    fail(res, 502, 'Payment or agent invocation failed', { error_code: 'invoke_failed' })
    return
  }

  const settlementTxHash = result.creatorTxHash ?? result.platformTxHash

  // Record the run for the subscriber's portfolio + creator earnings (creator's
  // actual cut, not the full price the subscriber paid).
  const user = await findOrCreateUser(owner)
  await query(
    `INSERT INTO runs (run_id, agent_id, user_id, subscription_id, kind, amount, currency, status_message, link, success, tx_hash, ran_at)
     VALUES ($1, $2, $3, NULL, 'one_time', $4, 'USDC', $5, NULL, true, $6, now())`,
    [newRunId(), agent.agent_id, user.user_id, formatUnits(result.creatorAmount, 6), `Ran ${agent.name}`, settlementTxHash],
  )

  ok(res, 200, 'Run completed', {
    invocation_id: newRunId(),
    status: 'completed',
    agent: { agent_id: agent.agent_id, name: agent.name },
    inputs: paramValues,
    output: result.output,
    receipt: {
      amount: { amount: agent.one_time_price_amount, currency: 'USDC' },
      tx_hash: settlementTxHash,
      settled_at: new Date().toISOString(),
    },
  })
})

// POST /runs (Recording a completed one-time run result)
marketplaceRouter.post('/runs', async (req, res) => {
  const { user_address, agent_id, amount, status_message, link, tx_hash, success } = req.body as {
    user_address?: string
    agent_id?: string
    amount?: { amount?: string; currency?: string }
    status_message?: string
    link?: string
    tx_hash?: string
    success?: boolean
  }

  if (!user_address || !isAddress(user_address, { strict: false }) || !agent_id || !amount?.amount) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', agent_id: 'required', amount: 'required' } })
    return
  }

  const agentCheck = await query('SELECT 1 FROM agents WHERE agent_id = $1', [agent_id])
  if (agentCheck.rowCount === 0) {
    fail(res, 404, 'Agent not found', {})
    return
  }

  const user = await findOrCreateUser(user_address)
  const runId = newRunId()
  const currency = amount.currency || 'USDC'

  await query(
    `INSERT INTO runs (
      run_id, agent_id, user_id, subscription_id, kind, amount, currency, status_message, link, success, tx_hash, ran_at
    ) VALUES ($1, $2, $3, NULL, 'one_time', $4, $5, $6, $7, $8, $9, now())`,
    [
      runId,
      agent_id,
      user.user_id,
      amount.amount,
      currency,
      status_message || null,
      link || null,
      success !== false,
      tx_hash || null
    ]
  )

  ok(res, 201, 'Run recorded successfully', {
    run: {
      run_id: runId,
      agent_id,
      user_id: user.user_id,
      kind: 'one_time',
      amount: money(amount.amount, currency),
      status_message,
      link,
      success: success !== false,
      tx_hash,
      ran_at: new Date().toISOString()
    }
  })
})
