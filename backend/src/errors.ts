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

export class ExecutionError extends AppError {
  constructor(subId: string, cause: unknown) {
    super(`execution failed for ${subId.slice(0, 10)}...`, 'EXECUTION_FAILED', { cause, isOperational: true })
    this.name = 'ExecutionError'
  }
}

export class TrustScoreError extends AppError {
  constructor(score: bigint, minimum: bigint) {
    super(`agent trust score ${score} below minimum ${minimum}`, 'TRUST_SCORE_LOW', { isOperational: true })
    this.name = 'TrustScoreError'
  }
}

export class PriceFeedError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PRICE_FEED_ERROR', { cause, isOperational: true })
    this.name = 'PriceFeedError'
  }
}

export class AgentEndpointError extends AppError {
  constructor(subId: string) {
    super(`agent for ${subId.slice(0, 10)}... has no endpoint_url registered`, 'AGENT_ENDPOINT_MISSING', { isOperational: true })
    this.name = 'AgentEndpointError'
  }
}

export class GasCeilingError extends AppError {
  constructor(gasGwei: number, ceilingGwei: number) {
    super(`gas ${gasGwei.toFixed(6)} gwei exceeds ceiling ${ceilingGwei} gwei`, 'GAS_CEILING', { isOperational: true })
    this.name = 'GasCeilingError'
  }
}

export class X402PaymentError extends AppError {
  constructor(url: string, message: string, cause?: unknown) {
    super(`x402 payment to ${url} failed: ${message}`, 'X402_PAYMENT_ERROR', { cause, isOperational: true })
    this.name = 'X402PaymentError'
  }
}
