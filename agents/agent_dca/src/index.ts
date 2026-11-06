import { config }              from './config.js'
import { logger }              from './logger.js'
import { startMockX402Server } from './x402/server.js'
import { buildClients }        from './chain/client.js'
import { ClaudeAgent }          from './agent/claude.js'

async function main(): Promise<void> {
  const clients    = buildClients(config.rpcUrl, config.chainId, config.privateKey)
  const chainName  = config.chainId === 421614 ? 'arbitrum-sepolia' : 'arbitrum-one'
  const claude     = config.anthropicApiKey ? new ClaudeAgent(config.anthropicApiKey) : null

  logger.info({ address: clients.account.address, port: config.mockX402Port, claudeEnabled: claude !== null }, 'starting mock x402 server...')

  startMockX402Server(
    config.mockX402Port,
    config.usdcAddr,
    clients.account.address,
    chainName,
    config.coincapKey,
    clients,
    claude,
    config.decidePriceUsdc,
  )

  logger.info('agents daemon running')
}

main().catch(err => {
  logger.error({ err }, 'agents daemon failed')
  process.exit(1)
})
