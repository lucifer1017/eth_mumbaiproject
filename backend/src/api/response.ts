import type { Response } from 'express'

export interface Money {
  amount: string
  currency: string
}

export function money(amount: number | string, currency = 'USDC'): Money {
  const n = typeof amount === 'string' ? Number(amount) : amount
  return { amount: n.toFixed(2), currency }
}

// For non-stablecoin token amounts (e.g. WETH received from a DCA swap),
// where 2 decimal places would round tiny amounts to zero.
export function tokenAmount(amount: number | string, currency: string, decimals = 6): Money {
  const n = typeof amount === 'string' ? Number(amount) : amount
  return { amount: n.toFixed(decimals), currency }
}

// Universal response envelope per API.md §1.1
export function ok(res: Response, code: number, message: string, details: object = {}): void {
  res.status(code).json({
    success: true,
    data: { code: String(code), message, details },
  })
}

export function fail(res: Response, code: number, message: string, details: object = {}): void {
  res.status(code).json({
    success: false,
    data: { code: String(code), message, details },
  })
}
