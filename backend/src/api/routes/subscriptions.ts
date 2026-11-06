import { Router } from 'express'
import { isAddress } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail, money } from '../response.js'
import { findOrCreateUser } from '../userdb.js'
import { newSubscriptionId } from '../ids.js'
import { serializeSubscription } from '../serializers.js'
import { config } from '../../config.js'

export const subscriptionsRouter = Router()

const SUBSCRIPTION_SELECT = `
  SELECT s.id, s.status, s.usage_count,
         s.amount_per_cycle, s.interval_seconds,
         s.last_payment_amount, s.last_payment_time,
         s.next_payment_amount, s.next_payment_time,
         s.started_at, s.cancelled_at,
         s.service_address, s.onchain_sub_id,
         a.agent_id, a.name AS agent_name, a.logo AS agent_logo, a.payment_frequency
  FROM subscriptions s
  JOIN agents a ON a.agent_id = s.agent_id
`

function nextPaymentDate(intervalSeconds: number, from: Date): Date {
  const d = new Date(from)
  d.setSeconds(d.getSeconds() + intervalSeconds)
  return d
}

// POST /subscriptions
subscriptionsRouter.post('/', async (req, res) => {
  const { user_address, agent_id, subscription_id: onchain_sub_id, tx_hash } = req.body as {
    user_address?: string
    agent_id?: string
    subscription_id?: string
    tx_hash?: string
  }

  if (!user_address || !isAddress(user_address, { strict: false }) || !agent_id || !onchain_sub_id) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', agent_id: 'required', subscription_id: 'required' } })
    return
  }

  const agentRes = await query<{
    agent_id: string
    name: string
    status: string
    sub_price_amount: string
    sub_price_currency: string
    interval_seconds: number
    service_address: string
  }>(
    `SELECT agent_id, name, status, sub_price_amount, sub_price_currency, interval_seconds, service_address
     FROM agents WHERE agent_id = $1`,
    [agent_id],
  )
  const agent = agentRes.rows[0]
  if (!agent || agent.status !== 'live') {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { agent_id: 'agent not available' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const existing = await query(
    `SELECT 1 FROM subscriptions WHERE user_id = $1 AND agent_id = $2 AND status = 'active'`,
    [user.user_id, agent_id],
  )
  if (existing.rows.length > 0) {
    fail(res, 409, 'Already subscribed to this agent', {})
    return
  }

  const subId = newSubscriptionId()
  const now = new Date()
  const interval = agent.interval_seconds || 0
  const next = nextPaymentDate(interval, now)

  // A user can only have one subscriptions row per agent (unique on
  // user_id, agent_id), so re-subscribing after a cancellation must update
  // the existing row rather than insert a new one.
  const upserted = await query<{ id: string }>(
    `INSERT INTO subscriptions (
      id, user_id, agent_id, service_address, status, onchain_sub_id,
      amount_per_cycle, interval_seconds, next_payment_amount, next_payment_time, tx_hash, started_at
    ) VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (user_id, agent_id) DO UPDATE SET
      status = 'active',
      service_address = EXCLUDED.service_address,
      onchain_sub_id = EXCLUDED.onchain_sub_id,
      amount_per_cycle = EXCLUDED.amount_per_cycle,
      interval_seconds = EXCLUDED.interval_seconds,
      usage_count = 0,
      last_payment_amount = NULL,
      last_payment_time = NULL,
      next_payment_amount = EXCLUDED.next_payment_amount,
      next_payment_time = EXCLUDED.next_payment_time,
      tx_hash = EXCLUDED.tx_hash,
      started_at = EXCLUDED.started_at,
      cancelled_at = NULL
    RETURNING id`,
    [
      subId,
      user.user_id,
      agent_id,
      agent.service_address || null,
      onchain_sub_id,
      agent.sub_price_amount,
      interval,
      agent.sub_price_amount,
      next,
      tx_hash || null,
      now
    ],
  )

  const subRow = await query<any>(`${SUBSCRIPTION_SELECT} WHERE s.id = $1`, [upserted.rows[0]!.id])

  ok(res, 201, 'Subscription created', {
    subscription: serializeSubscription(subRow.rows[0]!),
    payment: {
      contract_address: config.subscriptionsAddr,
      network: 'arbitrum-sepolia',
      amount: money(agent.sub_price_amount || '0', agent.sub_price_currency || 'USDC'),
      memo: subId,
    },
  })
})

// POST /subscriptions/:subscription_id/cancel
subscriptionsRouter.post('/:subscription_id/cancel', async (req, res) => {
  const { subscription_id } = req.params
  const { user_address } = req.body as { user_address?: string }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)

  const subRes = await query<{ id: string; status: string }>(
    'SELECT id, status FROM subscriptions WHERE id = $1 AND user_id = $2',
    [subscription_id, user.user_id],
  )
  if (subRes.rows.length === 0) {
    fail(res, 404, 'Subscription not found', {})
    return
  }

  await query(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
    [subscription_id],
  )

  const updated = await query<any>(`${SUBSCRIPTION_SELECT} WHERE s.id = $1`, [subscription_id])
  const sub = updated.rows[0]!

  const cancelDate = sub.next_payment_time ?? new Date()
  const formatted = cancelDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  ok(res, 200, `Subscription cancelled — active until ${formatted}`, {
    subscription: serializeSubscription(sub),
  })
})
