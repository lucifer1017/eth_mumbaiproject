import { Router } from 'express'
import { recoverMessageAddress, isAddress } from 'viem'
import { query } from '../../db/pool.js'
import { ok, fail } from '../response.js'
import { findUserByAddress, findOrCreateUser, serializeUser } from '../userdb.js'

export function signMessageFor(userAddress: string, nonce: string): string {
  return `daemon wants you to sign in with your wallet:\n${userAddress}\nNonce: ${nonce}`
}

export const authRouter = Router()

const NONCE_TTL_MS = 5 * 60 * 1000

function randomNonce(): string {
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)
}

// POST /auth/nonce
authRouter.post('/nonce', async (req, res) => {
  const { user_address } = req.body as { user_address?: string }

  if (!user_address || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required' } })
    return
  }

  const nonce = randomNonce()
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS)

  await query(
    `INSERT INTO auth_nonces (user_address, nonce, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_address) DO UPDATE SET nonce = EXCLUDED.nonce, expires_at = EXCLUDED.expires_at`,
    [user_address, nonce, expiresAt],
  )

  ok(res, 200, 'Nonce generated', {
    nonce,
    sign_message: signMessageFor(user_address, nonce),
    expires_at: expiresAt.toISOString(),
  })
})

// POST /auth/verify
authRouter.post('/verify', async (req, res) => {
  const { user_address, signature } = req.body as { user_address?: string; signature?: string }

  if (!user_address || !signature || !isAddress(user_address, { strict: false })) {
    fail(res, 400, 'Request validation failed', { error_code: 'validation_failed', field_errors: { user_address: 'required', signature: 'required' } })
    return
  }

  const nonceRow = await query<{ nonce: string; expires_at: Date }>(
    'SELECT nonce, expires_at FROM auth_nonces WHERE user_address = $1',
    [user_address],
  )
  const row = nonceRow.rows[0]

  if (!row || row.expires_at.getTime() < Date.now()) {
    fail(res, 401, 'Invalid signature', {})
    return
  }

  const message = signMessageFor(user_address, row.nonce)

  let recovered: string
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as `0x${string}` })
  } catch {
    fail(res, 401, 'Invalid signature', {})
    return
  }

  if (recovered.toLowerCase() !== user_address.toLowerCase()) {
    fail(res, 401, 'Invalid signature', {})
    return
  }

  // Nonce is single-use
  await query('DELETE FROM auth_nonces WHERE user_address = $1', [user_address])

  const existing = await findUserByAddress(user_address)
  const isNewUser = existing === null
  const user = existing ?? await findOrCreateUser(user_address)

  ok(res, 200, 'Wallet verified', {
    is_new_user: isNewUser,
    user: serializeUser(user),
  })
})
