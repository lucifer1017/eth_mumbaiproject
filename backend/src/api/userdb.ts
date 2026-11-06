import { query } from '../db/pool.js'
import { newUserId } from './ids.js'

export interface UserRow {
  user_id: string
  user_address: string
  handle: string | null
  roles: string[]
  created_at: Date
}

export async function findUserByAddress(userAddress: string): Promise<UserRow | null> {
  const res = await query<UserRow>('SELECT * FROM users WHERE user_address = $1', [userAddress])
  return res.rows[0] ?? null
}

// Looked up across most user-scoped endpoints — auto-creates a bare record
// (handle=null, roles=[]) so the marketplace/billing flow works even before
// the frontend completes /user/onboard.
export async function findOrCreateUser(userAddress: string): Promise<UserRow> {
  const existing = await findUserByAddress(userAddress)
  if (existing) return existing

  const userId = newUserId()
  const res = await query<UserRow>(
    `INSERT INTO users (user_id, user_address, handle, roles) VALUES ($1, $2, NULL, '{}')
     ON CONFLICT (user_address) DO UPDATE SET user_address = EXCLUDED.user_address
     RETURNING *`,
    [userId, userAddress],
  )
  return res.rows[0]!
}

export function serializeUser(u: UserRow): object {
  return {
    user_id: u.user_id,
    user_address: u.user_address,
    handle: u.handle,
    roles: u.roles,
    created_at: u.created_at.toISOString(),
  }
}
