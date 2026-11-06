import { logger } from '../logger.js'

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  label?: string
}

// Exponential backoff with jitter. Only retries on Error instances.
// Do NOT use for write operations (wallet.writeContract) — duplicate submissions are dangerous.
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 150, label = 'op' } = opts

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === maxAttempts) throw err
      const jitter = Math.random() * baseDelayMs
      const delay  = baseDelayMs * 2 ** (attempt - 1) + jitter
      logger.warn({ label, attempt, maxAttempts, delayMs: Math.round(delay), err }, 'retrying after error')
      await new Promise<void>(resolve => setTimeout(resolve, delay))
    }
  }

  // TypeScript needs this — the loop above always throws or returns
  throw new Error('withRetry: unreachable')
}
