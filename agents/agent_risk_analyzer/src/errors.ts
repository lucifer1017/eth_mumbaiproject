// Typed error hierarchy.
// Operational errors are expected failures (bad feed, gas too high, sub expired).
// Non-operational errors are programmer bugs — they should crash the process.

export class AppError extends Error {
  readonly isOperational: boolean
  readonly code: string

  constructor(
    message: string,
    code: string,
    options?: { isOperational?: boolean; cause?: unknown },
  ) {
    super(message, { cause: options?.cause })
    this.name = 'AppError'
    this.code = code
    this.isOperational = options?.isOperational ?? true
    Error.captureStackTrace(this, this.constructor)
  }
}

export class PriceFeedError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PRICE_FEED_ERROR', { cause, isOperational: true })
    this.name = 'PriceFeedError'
  }
}

export class ClaudeResponseError extends AppError {
  constructor(raw: string) {
    super(`Claude returned non-JSON response: ${raw.slice(0, 80)}`, 'CLAUDE_RESPONSE_ERROR', { isOperational: true })
    this.name = 'ClaudeResponseError'
  }
}
