import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from './pool.js'
import { logger } from '../logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8')
  await pool.query(sql)
  logger.info('database schema migrated')
  await pool.end()
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'migration failed')
  process.exit(1)
})
