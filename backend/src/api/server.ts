import { config } from '../config.js'
import { logger } from '../logger.js'
import { buildApp } from './app.js'

const app = buildApp()

app.listen(config.apiPort, () => {
  logger.info({ port: config.apiPort }, 'API server listening')
})
