import { logger }           from '../logger.js'
import { PriceFeedError }   from '../errors.js'
import { fetchWithTimeout } from '../utils/fetchWithTimeout.js'
import { withRetry }        from '../utils/retry.js'

const BASE_URL = 'https://rest.coincap.io/v3'

// Map token symbols → CoinCap asset slugs
const SLUG: Record<string, string> = {
  ETH:  'ethereum',
  BTC:  'bitcoin',
  WETH: 'ethereum',
  WBTC: 'bitcoin',
  ARB:  'arbitrum',
  SOL:  'solana',
}

export interface LivePrice {
  symbol:            string
  priceUsd:          number
  changePercent24Hr: number
}

interface CoinCapResponse {
  data: {
    symbol:            string
    priceUsd:          string
    changePercent24Hr: string | null
  }
}

function isCoinCapResponse(v: unknown): v is CoinCapResponse {
  if (typeof v !== 'object' || v === null) return false
  const obj = v as Record<string, unknown>
  if (typeof obj['data'] !== 'object' || obj['data'] === null) return false
  const data = obj['data'] as Record<string, unknown>
  return typeof data['priceUsd'] === 'string'
}

export async function fetchLivePrice(symbol: string, apiKey: string): Promise<LivePrice> {
  const slug = SLUG[symbol.toUpperCase()] ?? symbol.toLowerCase()
  const url  = `${BASE_URL}/assets/${slug}`

  const json = await withRetry(async () => {
    const resp = await fetchWithTimeout(url, {
      headers:   { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 8_000,
    })

    if (!resp.ok) {
      const body = await resp.text()
      throw new PriceFeedError(`CoinCap ${resp.status} for "${slug}": ${body}`)
    }

    const parsed: unknown = await resp.json()
    if (!isCoinCapResponse(parsed)) {
      throw new PriceFeedError(`CoinCap response missing data.priceUsd for "${slug}"`)
    }
    return parsed
  }, { label: `coincap/${slug}`, maxAttempts: 3 })

  const priceUsd = parseFloat(json.data.priceUsd)
  if (!isFinite(priceUsd) || priceUsd <= 0) {
    throw new PriceFeedError(`CoinCap returned invalid price "${json.data.priceUsd}" for "${slug}"`)
  }

  logger.debug({ slug, priceUsd, changePercent24Hr: json.data.changePercent24Hr }, 'price fetched')

  return {
    symbol:            json.data.symbol,
    priceUsd,
    changePercent24Hr: parseFloat(json.data.changePercent24Hr ?? '0'),
  }
}
