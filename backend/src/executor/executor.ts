import { randomUUID } from 'node:crypto'
import { encodeAbiParameters, formatUnits } from 'viem'
import { logger }                           from '../logger.js'
import { TrustScoreError, GasCeilingError, ExecutionError, AgentEndpointError } from '../errors.js'
import { withRetry }                        from '../utils/retry.js'
import { SubscriptionsABI, ValidationRegistryABI } from '../contracts/index.js'
import { query }             from '../db/pool.js'
import type { Clients }     from '../chain/client.js'
import type { X402Client }  from '../x402/client.js'
import { config }           from '../config.js'

// Reflects the deployed Subscription struct (Subscriptions.sol). Timing
// fields are uint48/uint32, decoded by viem as `number`; amountPerCycle is
// uint96, decoded as `bigint`.
interface SubscriptionData {
  subscriber:            `0x${string}`
  service:               `0x${string}`
  spendToken:            `0x${string}`
  amountPerCycle:        bigint
  interval:              number
  lastExecutionTime:     number
  subscriptionStartTime: number
  permitExpiry:          number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export class Executor {
  constructor(
    private readonly clients: Clients,
    private readonly x402:    X402Client,
  ) {}

  async tryExecute(subId: `0x${string}`): Promise<void> {
    const label = subId.slice(0, 10) + '...'
    const log   = logger.child({ subId: label })
    const { publicClient, walletClient, account } = this.clients

    // ── 1. Read subscription ─────────────────────────────────────────────────
    const sub = await withRetry(
      () => publicClient.readContract({
        address:      config.subscriptionsAddr,
        abi:          SubscriptionsABI,
        functionName: 'getSubscription',
        args:         [subId],
      }),
      { label: `readContract:getSubscription:${label}`, maxAttempts: 3 },
    ) as SubscriptionData

    if (sub.subscriber === ZERO_ADDRESS) {
      log.debug('subscription not found — skipping')
      return
    }

    const nowSecs = Math.floor(Date.now() / 1000)

    // ── 2. Timing and expiry checks ──────────────────────────────────────────
    if (sub.permitExpiry <= nowSecs) {
      log.debug({ permitExpiry: sub.permitExpiry }, 'permit expired — skipping')
      return
    }

    const nextDue   = sub.lastExecutionTime + sub.interval
    const remaining = nextDue - nowSecs
    if (nowSecs < nextDue) {
      log.debug({ remainingSecs: remaining }, 'not due yet — skipping')
      return
    }

    // ── 3. Look up the agent's x402 endpoint (registered by the creator) ──────
    const agentRes = await query<{ endpoint_url: string | null }>(
      `SELECT a.endpoint_url FROM subscriptions s
       JOIN agents a ON a.agent_id = s.agent_id
       WHERE s.onchain_sub_id = $1`,
      [subId],
    )
    const endpointUrl = agentRes.rows[0]?.endpoint_url ?? null
    if (!endpointUrl) {
      throw new AgentEndpointError(subId)
    }

    // ── 4. ERC-8004 trust score check ─────────────────────────────────────────
    const score = await withRetry(
      () => publicClient.readContract({
        address:      config.validationRegistryAddr,
        abi:          ValidationRegistryABI,
        functionName: 'getScore',
        args:         [config.agentId],
      }),
      { label: 'readContract:getScore', maxAttempts: 3 },
    ) as bigint

    if (score < config.minTrustScore) {
      throw new TrustScoreError(score, config.minTrustScore)
    }

    log.info({
      subscriber: sub.subscriber.slice(0, 10),
      amountUsdc: formatUnits(sub.amountPerCycle, 6),
      score: score.toString(),
    }, 'executing subscription')

    // ── 5. Gas price ceiling (PRD §9.1, hard rule) ────────────────────────────
    const gasPrice     = await withRetry(
      () => publicClient.getGasPrice(),
      { label: 'getGasPrice', maxAttempts: 3 },
    )
    const gasPriceGwei = Number(gasPrice) / 1e9
    log.info({ gasPriceGwei: gasPriceGwei.toFixed(6), ceilingGwei: config.maxGasGwei }, 'gas check')

    if (gasPriceGwei > config.maxGasGwei) {
      throw new GasCeilingError(gasPriceGwei, config.maxGasGwei)
    }

    // ── 6. Price + execution-safety decision + swap route ─────────────────────
    // Paid x402 call to the agent's own decision endpoint — settles a real
    // on-chain USDC transferFrom() before returning the plan.
    const result = await this.x402.decide(`${endpointUrl.replace(/\/$/, '')}/v1/decide`, {
      token:        'ETH',
      spendToken:   sub.spendToken,
      outputToken:  config.outputTokenAddr,
      spendAmount:  sub.amountPerCycle.toString(),
      aggregator:   config.aggregatorAddr,
      gasPriceGwei,
    })

    log.info({
      priceUsd:  result.price.price_usdc,
      change24h: `${result.price.change_percent_24hr >= 0 ? '+' : ''}${result.price.change_percent_24hr.toFixed(2)}%`,
      source:    result.price.source,
      settlementTx: result.settlement.txHash,
    }, 'price + decision fetched from agent (x402)')

    const decision         = result.decision
    const routeResp        = result.route
    const settlementTxHash = result.settlement.txHash

    log.info({
      shouldExecute: decision.should_execute,
      slippageBps:   decision.slippage_bps,
      anomaly:       decision.anomaly_detected,
      reasoning:     decision.reasoning,
    }, 'execution decision')

    if (!decision.should_execute) {
      log.warn({ reasoning: decision.reasoning }, 'execution skipped by decision')
      return
    }
    if (decision.anomaly_detected) {
      log.warn({ reasoning: decision.reasoning }, 'anomaly detected — proceeding with caution')
    }

    // ── 7. Compute minOutputAmount from the decision's slippage ───────────────
    const outputAmount    = BigInt(routeResp.output_amount)
    const minOutputAmount = (outputAmount * BigInt(10_000 - decision.slippage_bps)) / 10_000n

    // ── 8. ABI-encode SwapParams for SIPService ────────────────────────────────
    const params = encodeAbiParameters(
      [{ type: 'tuple', components: [
        { name: 'outputToken',     type: 'address' },
        { name: 'minOutputAmount', type: 'uint256' },
        { name: 'swapData',        type: 'bytes'   },
      ]}],
      [{ outputToken: config.outputTokenAddr, minOutputAmount, swapData: routeResp.swap_data }],
    )

    // ── 9. Broadcast execute() ───────────────────────────────────────────────
    // Do NOT wrap writeContract in withRetry — duplicate submissions would double-spend.
    let txHash: `0x${string}`
    try {
      txHash = await walletClient.writeContract({
        address:      config.subscriptionsAddr,
        abi:          SubscriptionsABI,
        functionName: 'execute',
        args:         [subId, params],
        account,
      })
    } catch (err) {
      throw new ExecutionError(subId, err)
    }

    log.info({ txHash, decideSettlementTx: settlementTxHash }, 'tx submitted')

    // ── 10. Wait for confirmation ──────────────────────────────────────────────
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })

    if (receipt.status === 'reverted') {
      throw new ExecutionError(subId, new Error(`tx ${txHash} reverted in block ${receipt.blockNumber}`))
    }

    log.info({ block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() }, 'confirmed')

    // Only record to the DB once the tx is confirmed successful on-chain —
    // failed/reverted attempts are logged (see scheduler) but not persisted.
    await this.recordRun(subId, sub, txHash, config.outputTokenAddr, outputAmount)
  }

  // Writes a successful execute() to the shared DB so the subscriber and
  // creator dashboards can show execution history. Looks up the internal
  // subscription/agent/user ids by the on-chain subscription id.
  private async recordRun(
    subId: `0x${string}`,
    sub: SubscriptionData,
    txHash: `0x${string}`,
    outputToken: `0x${string}`,
    outputAmount: bigint,
  ): Promise<void> {
    const subRes = await query<{ id: string; user_id: string; agent_id: string }>(
      'SELECT id, user_id, agent_id FROM subscriptions WHERE onchain_sub_id = $1',
      [subId],
    )
    const subRow = subRes.rows[0]
    if (!subRow) {
      logger.warn({ subId: subId.slice(0, 10) }, 'recordRun: no matching subscription row')
      return
    }

    const amount       = formatUnits(sub.amountPerCycle, 6)
    const outputAmtStr = formatUnits(outputAmount, 18)
    const link         = `https://sepolia.arbiscan.io/tx/${txHash}`

    await query(
      `INSERT INTO runs (run_id, agent_id, user_id, subscription_id, kind, amount, currency, status_message, link, success, tx_hash, output_token_address, output_amount, ran_at)
       VALUES ($1,$2,$3,$4,'subscription',$5,'USDC',$6,$7,true,$8,$9,$10, now())`,
      [`run_${randomUUID()}`, subRow.agent_id, subRow.user_id, subRow.id, amount, 'Subscription executed successfully', link, txHash, outputToken, outputAmtStr],
    )

    await query(
      `UPDATE subscriptions
       SET usage_count = usage_count + 1,
           last_payment_amount = $1,
           last_payment_time = now(),
           next_payment_amount = $1,
           next_payment_time = now() + ($2 || ' seconds')::interval
       WHERE id = $3`,
      [amount, sub.interval.toString(), subRow.id],
    )
  }
}
