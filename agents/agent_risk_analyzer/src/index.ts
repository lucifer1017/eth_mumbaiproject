import { config }                  from './config.js'
import { logger }                  from './logger.js'
import { startRiskAnalyzerServer } from './x402/server.js'
import { buildClients }            from './chain/client.js'
import { RiskAnalyzer }            from './agent/riskAnalyzer.js'

async function main(): Promise<void> {
  const clients   = buildClients(config.rpcUrl, config.chainId, config.privateKey)
  const chainName = config.chainId === 421614 ? 'arbitrum-sepolia' : 'arbitrum-one'
  const analyzer  = config.anthropicApiKey ? new RiskAnalyzer(config.anthropicApiKey) : null

  logger.info({ address: clients.account.address, port: config.mockX402Port, claudeEnabled: analyzer !== null }, 'starting agent-risk-analyzer x402 server...')

  startRiskAnalyzerServer(
    config.mockX402Port,
    config.usdcAddr,
    clients.account.address,
    chainName,
    config.coincapKey,
    clients,
    analyzer,
    config.riskReportPriceUsdc,
  )

  logger.info('agent-risk-analyzer daemon running')
}

main().catch(err => {
  logger.error({ err }, 'agent-risk-analyzer daemon failed')
  process.exit(1)
})
