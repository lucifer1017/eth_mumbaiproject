import Anthropic                from '@anthropic-ai/sdk'
import { logger }              from '../logger.js'
import { ClaudeResponseError } from '../errors.js'

const SYSTEM_PROMPT = `You are a wallet risk analyzer for an Arbitrum wallet.

You are given the wallet's holdings (token, balance, USD value) and the total portfolio
value in USD. Assess concentration risk and overall portfolio health.

Respond ONLY with a JSON object. No markdown, no explanation outside the JSON:
{
  "risk_score": number,    // 0 (very safe) - 100 (very risky), driven mainly by concentration
  "risk_level": "low" | "medium" | "high",
  "summary": "one or two sentence overview",
  "findings": ["short bullet point", ...],
  "recommendations": ["short bullet point", ...]
}`

export interface Holding {
  symbol:        string
  balance:       string
  value_usd:     number
}

export interface RiskAnalysisInput {
  walletAddress: string
  holdings:      Holding[]
  totalValueUsd: number
}

export interface RiskReport {
  risk_score:      number
  risk_level:      'low' | 'medium' | 'high'
  summary:         string
  findings:        string[]
  recommendations: string[]
}

function isRiskReport(v: unknown): v is RiskReport {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    typeof r['risk_score'] === 'number' &&
    (r['risk_level'] === 'low' || r['risk_level'] === 'medium' || r['risk_level'] === 'high') &&
    typeof r['summary'] === 'string' &&
    Array.isArray(r['findings']) &&
    Array.isArray(r['recommendations'])
  )
}

export class RiskAnalyzer {
  private readonly client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async analyze(input: RiskAnalysisInput): Promise<RiskReport> {
    const holdingsLines = input.holdings.map(
      h => `- ${h.symbol}: ${h.balance} (~$${h.value_usd.toFixed(2)})`,
    )
    const userPrompt = [
      `Wallet: ${input.walletAddress}`,
      `Total portfolio value: $${input.totalValueUsd.toFixed(2)}`,
      'Holdings:',
      ...holdingsLines,
      '',
      'Analyze this wallet and respond with the JSON risk report.',
    ].join('\n')

    const msg = await this.client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 512,
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
    if (!isRiskReport(parsed)) throw new ClaudeResponseError(raw)

    parsed.risk_score = Math.max(0, Math.min(100, Math.round(parsed.risk_score)))

    logger.debug({ input, report: parsed }, 'risk analysis')
    return parsed
  }
}

// Deterministic fallback used when ANTHROPIC_API_KEY is not configured —
// flags concentration risk purely off the holdings' value distribution.
export function fallbackRiskReport(input: RiskAnalysisInput): RiskReport {
  const top = input.holdings.reduce((max, h) => (h.value_usd > max ? h.value_usd : max), 0)
  const concentration = input.totalValueUsd > 0 ? top / input.totalValueUsd : 0
  const riskScore = Math.round(concentration * 100)

  return {
    risk_score: riskScore,
    risk_level: riskScore >= 66 ? 'high' : riskScore >= 33 ? 'medium' : 'low',
    summary: `Portfolio is ${(concentration * 100).toFixed(0)}% concentrated in its largest holding — deterministic fallback, no Claude oracle configured.`,
    findings: [`Largest holding accounts for ${(concentration * 100).toFixed(0)}% of portfolio value`],
    recommendations: concentration > 0.5 ? ['Consider diversifying into additional assets'] : [],
  }
}
