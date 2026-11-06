import express from 'express'
import { privateKeyToAccount } from 'viem/accounts'
import { config } from '../../config.js'
import { ok } from '../response.js'

export const configRouter = express.Router()

const platformWalletAddress = privateKeyToAccount(config.privateKey).address

// GET /config — public, non-secret platform info the frontend needs at
// runtime (e.g. the Permit2 spender for one-time agent payments). Derived
// from PRIVATE_KEY so it always matches the executor's signer, even if the
// key is rotated without a frontend rebuild.
configRouter.get('/', (_req, res) => {
  ok(res, 200, 'Platform config', { platform_wallet_address: platformWalletAddress })
})
