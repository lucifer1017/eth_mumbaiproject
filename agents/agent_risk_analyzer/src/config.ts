import 'dotenv/config'

// All env-var access is centralised here. The process fails fast at startup
// if any required variable is missing.

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Required env var "${key}" is not set`)
  return v
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

const mockPort = parseInt(optionalEnv('MOCK_X402_PORT', '8403'))

export const config = {
  // Chain
  rpcUrl:  requireEnv('RPC_URL'),
  chainId: parseInt(optionalEnv('CHAIN_ID', '421614')),

  // Agent identity
  privateKey:      requireEnv('PRIVATE_KEY') as `0x${string}`,
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] as string | undefined,
  coincapKey:      process.env['COINCAP_KEY']       as string | undefined,

  // x402 settings
  mockX402Port: mockPort,
  usdcAddr:     requireEnv('USDC_ADDR') as `0x${string}`,

  // Price of one /v1/risk-report call, in USDC smallest units (6 decimals). 40000 = 0.04 USDC.
  riskReportPriceUsdc: optionalEnv('RISK_REPORT_PRICE_USDC', '40000'),
} as const
