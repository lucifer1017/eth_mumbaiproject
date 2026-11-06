import pino from 'pino'

// Structured JSON logger (pino). Log level controlled by LOG_LEVEL env var.
// In production ship the JSON output to a log aggregator; in dev pipe through pino-pretty.
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
})
