import { parseAbiItem, formatUnits, type Address, type PublicClient } from 'viem'
import { logger }    from '../logger.js'
import { withRetry } from '../utils/retry.js'
import { query }     from '../db/pool.js'
import { findOrCreateUser } from '../api/userdb.js'
import { newSubscriptionId } from '../api/ids.js'
import { newRunId, newWithdrawalId } from '../api/ids.js'
import { config } from '../config.js'

// Subscriptions events
const EV_SUBSCRIPTION_CREATED = parseAbiItem(
  'event SubscriptionCreated(bytes32 indexed id, address indexed subscriber, address indexed service, address spendToken, uint96 amountPerCycle, uint32 interval, uint48 permitExpiry, bytes params)'
)
const EV_SUBSCRIPTION_CANCELLED = parseAbiItem(
  'event SubscriptionCancelled(bytes32 indexed id, address indexed subscriber)'
)
const EV_EXECUTED = parseAbiItem(
  'event Executed(bytes32 indexed id, address indexed subscriber, address indexed service, uint96 amount, uint48 executedAt, bytes params)'
)

// ServiceFactory events
const EV_SERVICE_CREATED = parseAbiItem(
  'event ServiceCreated(address indexed agent, address indexed service, address indexed spendToken, uint256 amount, address feeReceiver, uint256 agentId)'
)

// Service events
const EV_WITHDRAWN = parseAbiItem(
  'event Withdrawn(address indexed token, address indexed to, uint256 amount)'
)

// ValidationRegistry events
const EV_SCORE_UPDATED = parseAbiItem(
  'event ScoreUpdated(uint256 indexed agentId, address indexed validator, uint256 score)'
)

const CHUNK = 10_000n

export class Indexer {
  private lastBlock: bigint
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly client:       PublicClient,
    private readonly contractAddr: Address,
    startBlock: bigint,
    private readonly pollMs: number = 20_000,
  ) {
    this.lastBlock = startBlock > 0n ? startBlock - 1n : 0n
  }

  async start(): Promise<void> {
    try {
      const res = await query<{ value: string }>('SELECT value FROM system_constants WHERE key = $1', ['last_processed_block'])
      const firstRow = res.rows[0]
      if (firstRow) {
        this.lastBlock = BigInt(firstRow.value)
        logger.info({ lastBlock: this.lastBlock }, 'loaded last processed block from database')
      }
    } catch (err) {
      logger.warn({ err }, 'could not load last processed block from DB, using constructor default')
    }

    logger.info({ fromBlock: this.lastBlock + 1n, contract: this.contractAddr }, 'indexer starting scan')
    await this.sync()
    logger.info('indexer initial sync complete')

    this.timer = setInterval(() => {
      this.sync().catch((err: unknown) => logger.error({ err }, 'indexer poll error'))
    }, this.pollMs)
  }

  async stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    try {
      await query(
        `INSERT INTO system_constants (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        ['last_processed_block', this.lastBlock.toString()]
      )
      logger.info({ lastBlock: this.lastBlock }, 'saved last processed block before stopping')
    } catch (err) {
      logger.error({ err }, 'failed to save last processed block during stop')
    }
  }

  private async sync(): Promise<void> {
    const latest = await withRetry(
      () => this.client.getBlockNumber(),
      { label: 'indexer:getBlockNumber', maxAttempts: 3 },
    )

    if (this.lastBlock >= latest) return

    const from = this.lastBlock + 1n
    const to   = latest

    // Fetch dynamic Service addresses from agents table to query Withdrawn logs
    const agentsRes = await query<{ service_address: string }>(
      'SELECT DISTINCT service_address FROM agents WHERE service_address IS NOT NULL'
    )
    const serviceAddresses = agentsRes.rows.map(r => r.service_address as Address).filter(Boolean)

    logger.info({ fromBlock: from, toBlock: to, latest, blocksToCatchUp: to - from + 1n }, 'indexer sync starting')

    for (let chunk = from; chunk <= to; chunk += CHUNK) {
      const end = chunk + CHUNK - 1n < to ? chunk + CHUNK - 1n : to

      // Batch query all core logs in parallel
      const [
        createdLogs,
        cancelledLogs,
        executedLogs,
        serviceCreatedLogs,
        scoreUpdatedLogs
      ] = await withRetry(
        () => Promise.all([
          this.client.getLogs({ address: config.subscriptionsAddr, event: EV_SUBSCRIPTION_CREATED,   fromBlock: chunk, toBlock: end }),
          this.client.getLogs({ address: config.subscriptionsAddr, event: EV_SUBSCRIPTION_CANCELLED, fromBlock: chunk, toBlock: end }),
          this.client.getLogs({ address: config.subscriptionsAddr, event: EV_EXECUTED,               fromBlock: chunk, toBlock: end }),
          this.client.getLogs({ address: config.serviceFactoryAddr, event: EV_SERVICE_CREATED,        fromBlock: chunk, toBlock: end }),
          this.client.getLogs({ address: config.validationRegistryAddr, event: EV_SCORE_UPDATED,    fromBlock: chunk, toBlock: end })
        ]),
        { label: `indexer:getLogs:${chunk}-${end}`, maxAttempts: 3 },
      )

      // Query dynamic Service Withdrawn events if any exist
      let withdrawnLogs: any[] = []
      if (serviceAddresses.length > 0) {
        withdrawnLogs = await withRetry(
          () => this.client.getLogs({
            address: serviceAddresses,
            event: EV_WITHDRAWN,
            fromBlock: chunk,
            toBlock: end
          }),
          { label: `indexer:getLogs:withdrawn:${chunk}-${end}`, maxAttempts: 3 }
        )
      }

      // 1. Process SubscriptionCreated
      for (const log of createdLogs) {
        const { id, subscriber, service, amountPerCycle, interval, params } = log.args
        if (!id || !subscriber || !service || amountPerCycle === undefined || interval === undefined) continue

        try {
          const paramBuffer = params ? Buffer.from(params.slice(2), 'hex') : null
          const amountDec = formatUnits(amountPerCycle, 6)

          // Try updating existing record first
          const updateRes = await query(
            `UPDATE subscriptions SET
              status = 'active',
              service_address = $1,
              amount_per_cycle = $2,
              interval_seconds = $3,
              params = $4,
              cancelled_at = NULL,
              tx_hash = $5
             WHERE onchain_sub_id = $6`,
            [service, amountDec, Number(interval), paramBuffer, log.transactionHash, id]
          )

          if (updateRes.rowCount === 0) {
            // Created directly on-chain
            const user = await findOrCreateUser(subscriber)
            
            // Resolve agent by service contract
            const agentRes = await query<{ agent_id: string }>(
              'SELECT agent_id FROM agents WHERE service_address = $1',
              [service]
            )
            const agent = agentRes.rows[0]

            if (agent) {
              const subId = newSubscriptionId()
              await query(
                `INSERT INTO subscriptions (
                  id, user_id, agent_id, service_address, status, onchain_sub_id,
                  amount_per_cycle, interval_seconds, params, tx_hash, started_at
                ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, now())
                 ON CONFLICT (user_id, agent_id) DO UPDATE SET
                   status = 'active',
                   service_address = EXCLUDED.service_address,
                   onchain_sub_id = EXCLUDED.onchain_sub_id,
                   amount_per_cycle = EXCLUDED.amount_per_cycle,
                   interval_seconds = EXCLUDED.interval_seconds,
                   params = EXCLUDED.params,
                   tx_hash = EXCLUDED.tx_hash,
                   cancelled_at = NULL`,
                [
                  subId,
                  user.user_id,
                  agent.agent_id,
                  service,
                  id,
                  amountDec,
                  Number(interval),
                  paramBuffer,
                  log.transactionHash
                ]
              )
              logger.info({ subId: id.slice(0, 10), service }, 'subscription created on-chain and synced')
            } else {
              logger.warn({ service }, 'on-chain subscription created but no matching service agent found in DB')
            }
          } else {
            logger.info({ subId: id.slice(0, 10) }, 'subscription updated to active in DB')
          }
        } catch (err) {
          logger.error({ err, subId: id }, 'error processing SubscriptionCreated event')
        }
      }

      // 2. Process SubscriptionCancelled
      for (const log of cancelledLogs) {
        const { id } = log.args
        if (!id) continue
        try {
          await query(
            "UPDATE subscriptions SET status = 'cancelled', cancelled_at = now() WHERE onchain_sub_id = $1",
            [id]
          )
          logger.info({ subId: id.slice(0, 10) }, 'subscription cancelled')
        } catch (err) {
          logger.error({ err, subId: id }, 'error processing SubscriptionCancelled event')
        }
      }

      // 3. Process Executed (Payment reconciliation)
      for (const log of executedLogs) {
        const { id, amount, executedAt } = log.args
        if (!id || amount === undefined || executedAt === undefined) continue
        try {
          const amountDec = formatUnits(amount, 6)
          const runTime = new Date(Number(executedAt) * 1000)

          // Find subscription details
          const subRes = await query<{ id: string; agent_id: string; user_id: string; interval_seconds: number }>(
            'SELECT id, agent_id, user_id, interval_seconds FROM subscriptions WHERE onchain_sub_id = $1',
            [id]
          )
          const sub = subRes.rows[0]

          if (sub) {
            const nextTime = new Date(runTime.getTime() + sub.interval_seconds * 1000)

            // Update subscription execution status
            await query(
              `UPDATE subscriptions SET
                last_payment_amount = $1,
                last_payment_time = $2,
                next_payment_amount = $3,
                next_payment_time = $4,
                usage_count = usage_count + 1
               WHERE id = $5`,
              [amountDec, runTime, amountDec, nextTime, sub.id]
            )

            // Backstop: ensure a run row exists
            const runCheck = await query('SELECT 1 FROM runs WHERE tx_hash = $1', [log.transactionHash])
            if (runCheck.rowCount === 0) {
              const runId = newRunId()
              await query(
                `INSERT INTO runs (
                  run_id, agent_id, user_id, subscription_id, kind, amount,
                  currency, status_message, success, tx_hash, ran_at
                ) VALUES ($1, $2, $3, $4, 'subscription', $5, 'USDC', 'executed on-chain', true, $6, $7)`,
                [runId, sub.agent_id, sub.user_id, sub.id, amountDec, log.transactionHash, runTime]
              )
            }
            logger.info({ subId: id.slice(0, 10), amount: amountDec }, 'subscription execution reconciled')
          }
        } catch (err) {
          logger.error({ err, subId: id }, 'error processing Executed event')
        }
      }

      // 4. Process ServiceCreated (Factory deployment backstop)
      for (const log of serviceCreatedLogs) {
        const { agent, service, agentId } = log.args
        if (!agent || !service || agentId === undefined) continue

        try {
          // Resolve publisher user
          const userRes = await query<{ user_id: string }>('SELECT user_id FROM users WHERE user_address = $1', [agent])
          const user = userRes.rows[0]

          if (user) {
            // Update agent that matches this owner but doesn't have a service address registered yet
            const updateRes = await query(
              `UPDATE agents SET
                service_address = $1,
                onchain_agent_id = $2
               WHERE publisher_user_id = $3 AND service_address IS NULL`,
              [service, agentId.toString(), user.user_id]
            )
            if (updateRes.rowCount && updateRes.rowCount > 0) {
              logger.info({ agentId: agentId.toString(), service }, 'agent service address configured via indexer backstop')
            }
          }
        } catch (err) {
          logger.error({ err, service }, 'error processing ServiceCreated event')
        }
      }

      // 5. Process Withdrawn
      for (const log of withdrawnLogs) {
        const { token, to, amount } = log.args
        const serviceAddress = log.address
        if (!token || !to || amount === undefined) continue

        try {
          const amountDec = formatUnits(amount, 6)
          
          // Map service to agent
          const agentRes = await query<{ agent_id: string }>(
            'SELECT agent_id FROM agents WHERE service_address = $1',
            [serviceAddress]
          )
          const agent = agentRes.rows[0]

          const wId = newWithdrawalId()
          await query(
            `INSERT INTO withdrawals (
              withdrawal_id, agent_id, service_address, amount, currency, tx_hash, withdrawn_at
            ) VALUES ($1, $2, $3, $4, 'USDC', $5, now())`,
            [wId, agent ? agent.agent_id : null, serviceAddress, amountDec, log.transactionHash]
          )
          logger.info({ serviceAddress, amount: amountDec }, 'withdrawal event recorded')
        } catch (err) {
          logger.error({ err, serviceAddress }, 'error processing Withdrawn event')
        }
      }

      // 6. Process ScoreUpdated
      for (const log of scoreUpdatedLogs) {
        const { agentId, score } = log.args
        if (agentId === undefined || score === undefined) continue

        try {
          await query(
            'UPDATE agents SET trust_score = $1 WHERE onchain_agent_id = $2',
            [Number(score), agentId.toString()]
          )
          logger.info({ onchain_agent_id: agentId.toString(), score: Number(score) }, 'trust score updated via registry')
        } catch (err) {
          logger.error({ err, agentId: agentId.toString() }, 'error processing ScoreUpdated event')
        }
      }

      // Checkpoint after every chunk so progress survives a restart, and log
      // how far behind the chain head the indexer still is.
      this.lastBlock = end
      try {
        await query(
          `INSERT INTO system_constants (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          ['last_processed_block', end.toString()]
        )
      } catch (err) {
        logger.error({ err, block: end }, 'failed to save last processed block to database')
      }
      logger.info({ indexedTo: end, latest, remaining: latest - end }, 'indexer chunk processed')
    }
  }
}
