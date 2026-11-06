import { logger }      from '../logger.js'
import { AppError }    from '../errors.js'
import { query }       from '../db/pool.js'
import type { Executor } from '../executor/executor.js'

// Scheduler ticks on a fixed interval. Each tick it queries the shared DB
// for active subscriptions and calls tryExecute() for each.
// Uses Promise.allSettled so one failing execution never blocks the others.
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly executor:   Executor,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    logger.info({ intervalSecs: this.intervalMs / 1000 }, 'scheduler started')
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    logger.info('scheduler stopped')
  }

  private async tick(): Promise<void> {
    try {
      // Query the shared database for active subscriptions
      const res = await query<{ onchain_sub_id: string }>(
        "SELECT onchain_sub_id FROM subscriptions WHERE status = 'active' AND onchain_sub_id IS NOT NULL"
      )
      
      const active = res.rows.map(r => r.onchain_sub_id as `0x${string}`)

      if (active.length === 0) {
        logger.debug('scheduler tick — no active subscriptions')
        return
      }

      logger.info({ count: active.length }, 'scheduler tick')

      const results = await Promise.allSettled(
        active.map(id => this.executor.tryExecute(id)),
      )

      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        const id     = active[i]
        if (result === undefined || id === undefined) continue
        if (result.status === 'rejected') {
          const err        = result.reason as unknown
          const isAppError = err instanceof AppError
          logger.error(
            { subId: id.slice(0, 10), err, code: isAppError ? err.code : undefined },
            'execution failed',
          )
        }
      }
    } catch (err) {
      logger.error({ err }, 'scheduler tick error')
    }
  }
}
