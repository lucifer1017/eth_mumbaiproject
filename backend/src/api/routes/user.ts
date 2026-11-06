import { Router } from 'express'
import { isAddress } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail, money, tokenAmount } from '../response.js'
import { findUserByAddress, findOrCreateUser, serializeUser } from '../userdb.js'
import { serializeSubscription, type SubscriptionJoinRow } from '../serializers.js'
import { getUsdcBalance } from '../chain.js'


export const userRouter = Router()

const VALID_STATUSES = new Set(['active', 'cancelled', 'expired'])

const SUBSCRIPTION_SELECT = `
  SELECT s.id, s.status, s.usage_count,
         s.last_payment_amount, s.last_payment_time,
         s.next_payment_amount, s.next_payment_time,
         s.started_at, s.cancelled_at,
         s.service_address, s.onchain_sub_id,
         s.amount_per_cycle, s.interval_seconds,
         a.agent_id, a.name AS agent_name, a.logo AS agent_logo, a.payment_frequency
  FROM subscriptions s
  JOIN agents a ON a.agent_id = s.agent_id
`

// POST /user/onboard
userRouter.post('/onboard', async (req, res) => {
  const { user_address, handle, role } = req.body as { user_address?: string; handle?: string; role?: string }

  if (!user_address || !isAddress(user_address, { strict: false }) || !handle || !role) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', handle: 'required', role: 'required' } })
    return
  }

  if (role !== 'subscriber' && role !== 'creator') {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { role: 'must be subscriber or creator' } })
    return
  }

  const handleTaken = await query('SELECT 1 FROM users WHERE handle = $1 AND user_address != $2', [handle, user_address])
  if (handleTaken.rows.length > 0) {
    fail(res, 409, 'Handle already taken', {})
    return
  }

  const user = await findOrCreateUser(user_address)
  const roles = Array.from(new Set([...user.roles, role]))

  const updated = await query<typeof user>(
    'UPDATE users SET handle = $2, roles = $3 WHERE user_address = $1 RETURNING *',
    [user_address, handle, roles],
  )

  ok(res, 201, 'User onboarded', { user: serializeUser(updated.rows[0]!) })
})

// POST /user/subscriptions
userRouter.post('/subscriptions', async (req, res) => {
  const { user_address, status } = req.body as { user_address?: string; status?: string }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const filterStatus = status ?? 'active'
  if (!VALID_STATUSES.has(filterStatus)) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { status: 'invalid subscription_status' } })
    return
  }

  const user = await findUserByAddress(user_address)

  const rows = user
    ? await query<SubscriptionJoinRow>(
        `${SUBSCRIPTION_SELECT} WHERE s.user_id = $1 AND s.status = $2 ORDER BY s.started_at DESC`,
        [user.user_id, filterStatus],
      )
    : { rows: [] as SubscriptionJoinRow[] }

  const subscriptions = rows.rows.map(serializeSubscription)

  const monthlyTotal = rows.rows
    .filter(r => r.status === 'active' && r.payment_frequency === 'monthly')
    .reduce((sum, r) => sum + Number(r.next_payment_amount ?? r.amount_per_cycle ?? 0), 0)

  ok(res, 200, 'Data fetched successfully', {
    subscriptions,
    summary: {
      active_count: rows.rows.filter(r => r.status === 'active').length,
      monthly_total: money(monthlyTotal, 'USDC'),
    },
  })
})

// POST /user/billing
userRouter.post('/billing', async (req, res) => {
  const { user_address } = req.body as { user_address?: string }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const user = await findOrCreateUser(user_address)
  const balance = await getUsdcBalance(user_address)

  const nextRows = await query<{ amount: string; currency: string; next_payment_time: Date }>(
    `SELECT next_payment_amount AS amount, next_payment_time
     FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND next_payment_time IS NOT NULL
     ORDER BY next_payment_time ASC LIMIT 1`,
    [user.user_id],
  )
  const next = nextRows.rows[0]

  ok(res, 200, 'Data fetched successfully', {
    user_address,
    balance: money(balance, 'USDC'),
    next_charge: next
      ? { amount: money(next.amount, 'USDC'), charge_at: next.next_payment_time.toISOString() }
      : null,
  })
})

// POST /user/runs
userRouter.post('/runs', async (req, res) => {
  const { user_address, page: pageRaw, limit: limitRaw } = req.body as { user_address?: string; page?: number; limit?: number }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const page  = Math.max(1, Number(pageRaw) || 1)
  const limit = Math.min(100, Math.max(1, Number(limitRaw) || 20))
  const offset = (page - 1) * limit

  const user = await findUserByAddress(user_address)
  if (!user) {
    ok(res, 200, 'Data fetched successfully', { runs: [], pagination: { page, limit, total_items: 0, total_pages: 0 } })
    return
  }

  const countRes = await query<{ count: string }>('SELECT COUNT(*) FROM runs WHERE user_id = $1', [user.user_id])
  const totalItems = parseInt(countRes.rows[0]!.count)

  const spentRes = await query<{ total: string | null }>(
    'SELECT SUM(amount) AS total FROM runs WHERE user_id = $1 AND success = true',
    [user.user_id],
  )
  const totalSpent = Number(spentRes.rows[0]?.total ?? 0)

  const rows = await query<{
    run_id: string
    agent_id: string
    agent_name: string
    agent_logo: string | null
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
    `SELECT r.run_id, r.agent_id, a.name AS agent_name, a.logo AS agent_logo, r.subscription_id, r.kind, r.amount, r.currency, r.status_message, r.link, r.success, r.tx_hash, r.output_token_address, r.output_amount, r.ran_at
     FROM runs r
     JOIN agents a ON a.agent_id = r.agent_id
     WHERE r.user_id = $1 ORDER BY r.ran_at DESC LIMIT $2 OFFSET $3`,
    [user.user_id, limit, offset],
  )

  const runs = rows.rows.map(r => ({
    run_id: r.run_id,
    agent_id: r.agent_id,
    agent: r.agent_name,
    agent_logo: r.agent_logo,
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
    summary: { total_spent: money(totalSpent, 'USDC') },
    pagination: { page, limit, total_items: totalItems, total_pages: Math.ceil(totalItems / limit) },
  })
})
