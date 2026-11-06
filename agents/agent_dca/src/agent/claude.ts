import Anthropic                from '@anthropic-ai/sdk'
import { logger }              from '../logger.js'
import { ClaudeResponseError } from '../errors.js'

// PRD §3.1 — agent intelligence is scoped to execution safety checks only.
// Timing and amounts are fixed on-chain and must never be overridden here.
const SYSTEM_PROMPT = `You are an execution safety oracle for an autonomous DCA agent on Arbitrum.

CONSTRAINTS — never override these, they are enforced on-chain:
- Amount per cycle: fixed by the user's subscription
- Execution timing: fixed by the subscription interval

CRITICAL — price level knowledge:
The price you receive is the live market price from CoinCap Pro. It is the ground truth.
You have NO knowledge of what any token "should" cost. Do NOT compare the price against
your training data or any prior expectation. The absolute price level is irrelevant to you.

YOUR SCOPE (execution safety checks only):
1. Gas gate: skip if Arbitrum gas > 0.1 gwei (hard rule from PRD §9.1)
2. Volatility check: flag anomaly only if 24h change is extreme (beyond ±25%)
3. Broken feed: flag anomaly only if price is zero, negative, or clearly nonsensical
4. Slippage: recommend tighter slippage (lower bps) on calm days, wider on volatile days

Respond ONLY with a JSON object. No markdown, no explanation outside the JSON:
{"should_execute": boolean, "slippage_bps": number, "anomaly_detected": boolean, "reasoning": "one sentence"}`

export interface DecisionInput {
  token:             string
  priceUsdc:         number
  changePercent24Hr: number
  amountUsdc:        string
  gasPriceGwei:      number
}

export interface Decision {
  should_execute:   boolean
  slippage_bps:     number
  anomaly_detected: boolean
  reasoning:        string
}

function isDecision(v: unknown): v is Decision {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return (
    typeof d['should_execute']   === 'boolean' &&
    typeof d['slippage_bps']     === 'number'  &&
    typeof d['anomaly_detected'] === 'boolean' &&
    typeof d['reasoning']        === 'string'
  )
}

export class ClaudeAgent {
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async decide(input: DecisionInput): Promise<Decision> {
    const direction  = input.changePercent24Hr >= 0 ? '+' : ''
    const userPrompt = [
      `Token: ${input.token}`,
      `Current price: $${input.priceUsdc.toFixed(2)} USDC`,
      `24h change: ${direction}${input.changePercent24Hr.toFixed(2)}%`,
      `Cycle amount: ${input.amountUsdc} USDC`,
      `Arbitrum gas: ${input.gasPriceGwei.toFixed(6)} gwei`,
      '',
      'Analyze for execution safety and respond with the JSON decision.',
    ].join('\n')

    const msg = await this.client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    })

    const raw = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const start   = jsonStr.indexOf('{')
    const end     = jsonStr.lastIndexOf('}')
    if (start === -1 || end === -1) throw new ClaudeResponseError(raw)

    const parsed: unknown = JSON.parse(jsonStr.slice(start, end + 1))
    if (!isDecision(parsed)) throw new ClaudeResponseError(raw)

    // Clamp slippage to PRD §11 safe range — bad price data reverts on-chain, no funds lost
    parsed.slippage_bps = Math.max(25, Math.min(200, parsed.slippage_bps))

    logger.debug({ input, decision: parsed }, 'claude decision')
    return parsed
  }
}
