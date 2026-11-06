import { config }       from './config.js'
import { logger }       from './logger.js'
import { AppError }     from './errors.js'
import { buildClients } from './chain/client.js'
import { Indexer }      from './indexer/indexer.js'

// ── Global error handlers ──────────────────────────────────────────────────
process.on('uncaughtException', (err: unknown) => {
  logger.fatal({ err }, 'uncaught exception — exiting')
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  logger.fatal({ reason }, 'unhandled promise rejection — exiting')
  process.exit(1)
})

async function main(): Promise<void> {
  // ── Chain clients ──────────────────────────────────────────────────────────
  const clients = buildClients(config.rpcUrl, config.chainId, config.privateKey)
  logger.info({ chainId: config.chainId, address: clients.account.address }, 'chain connected')

  // ── Indexer ────────────────────────────────────────────────────────────────
  const indexer = new Indexer(
    clients.publicClient,
    config.subscriptionsAddr,
    config.indexerStartBlock,
    config.indexerPollMs,
  )
  await indexer.start()

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutdown signal received')
    await indexer.stop()
    process.exit(0)
  }
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(err => logger.error({ err })) })
  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(err => logger.error({ err })) })
}

main().catch((err: unknown) => {
  const isAppErr = err instanceof AppError
  logger.fatal({ err, code: isAppErr ? err.code : undefined }, 'indexer startup failed')
  process.exit(1)
})
