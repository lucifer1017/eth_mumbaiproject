import 'dotenv/config'

// All env-var access is centralised here. The process fails fast at startup
// if any required variable is missing — never silently mid-execution.

function requireEnv(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`Required env var "${key}" is not set`)
  return v
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue
}

export const config = {
  // Chain
  rpcUrl:  requireEnv('RPC_URL'),
  chainId: parseInt(optionalEnv('CHAIN_ID', '421614')),

  // Agent identity
  privateKey:    requireEnv('PRIVATE_KEY') as `0x${string}`,
  agentId:       BigInt(optionalEnv('AGENT_ID', '1')),
  minTrustScore: BigInt(optionalEnv('MIN_TRUST_SCORE', '50')),

  // Contracts
  subscriptionsAddr:      requireEnv('SUBSCRIPTIONS_ADDR')       as `0x${string}`,
  serviceFactoryAddr:     requireEnv('SERVICE_FACTORY_ADDR')     as `0x${string}`,
  validationRegistryAddr: requireEnv('VALIDATION_REGISTRY_ADDR') as `0x${string}`,
  aggregatorAddr:         requireEnv('AGGREGATOR_ADDR')           as `0x${string}`,
  outputTokenAddr:        requireEnv('OUTPUT_TOKEN_ADDR')         as `0x${string}`,
  usdcAddr:               requireEnv('USDC_ADDR')                 as `0x${string}`,

  // Indexer
  indexerStartBlock: BigInt(optionalEnv('INDEXER_START_BLOCK', '0')),
  indexerPollMs:     parseInt(optionalEnv('INDEXER_POLL_SECS', '20')) * 1000,

  // Gas ceiling
  maxGasGwei: parseFloat(optionalEnv('MAX_GAS_GWEI', '0.1')),

  // Executor scheduler tick interval
  schedulerIntervalMs: parseInt(optionalEnv('SCHEDULER_INTERVAL_SECS', '30')) * 1000,

  // Optional integrations
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'] as string | undefined,

  // API server
  databaseUrl: optionalEnv('DATABASE_URL', 'postgres://localhost:5432/sip_daemon'),
  apiPort:     parseInt(optionalEnv('API_PORT', '3001')),
} as const
