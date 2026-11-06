import express, { type Request, type Response } from 'express'
import { encodeFunctionData, formatUnits } from 'viem'
import { logger }             from '../logger.js'
import { TestAggregatorSwapABI, ERC20ABI } from '../contracts/index.js'
import type { PaymentRequirements, Payment } from './types.js'
import { fetchLivePrice } from '../prices/coincap.js'
import type { Clients } from '../chain/client.js'
import type { ClaudeAgent, Decision } from '../agent/claude.js'

interface RouteResult {
  output_amount:     string
  min_output_amount: string
  swap_data:         `0x${string}`
  aggregator?:       string
}

// Builds TestAggregator.swap() calldata + expected output amounts for a spend of
// `spendAmount` (smallest units) from `from` token to `to` token, priced off `priceUsd`.
function buildRoute(from: string, to: string, spendAmount: bigint, aggregator: string | undefined, priceUsd: number): RouteResult {
  const outputAmount = (spendAmount * BigInt(1e18)) / BigInt(Math.round(priceUsd) * 1_000_000)
  const minOutput    = (outputAmount * 9950n) / 10_000n

  const swapData = encodeFunctionData({
    abi:          TestAggregatorSwapABI,
    functionName: 'swap',
    args: [
      from as `0x${string}`,
      spendAmount,
      to   as `0x${string}`,
      outputAmount,
    ],
  })

  return {
    output_amount:     outputAmount.toString(),
    min_output_amount: minOutput.toString(),
    swap_data:         swapData,
    aggregator,
  }
}

// Mock x402 server — speaks a minimal 402-payment protocol.
// Prices: live from CoinCap Pro when COINCAP_KEY is set, synthetic otherwise.
// Routing: synthetic TestAggregator calldata — replace with real DEX router for mainnet.
//
// /v1/decide is the "DCA agent" worker endpoint: payment is settled for real on-chain
// via USDC.transferFrom(payer -> this agent's wallet), using a standing allowance the
// payer approved up front. /price and /route remain mock (no real settlement).
export function startMockX402Server(
  port:        number,
  assetAddr:   `0x${string}`,
  payToAddr:   `0x${string}`,
  network:     string,
  coincapKey:  string | undefined,
  clients:     Clients,
  claude:      ClaudeAgent | null,
  decidePriceUsdc: string,
): void {
  const app           = express()
  const FALLBACK_PRICE = 1647.0
  const serverLog      = logger.child({ component: 'x402-mock' })

  app.use(express.json())

  function demand402(res: Response, amount: string, description: string): void {
    const req: PaymentRequirements = {
      scheme: 'exact', network, maxAmountRequired: amount,
      asset: assetAddr, payTo: payToAddr, description,
    }
    res.status(402).json(req)
  }

  async function getPrice(token: string): Promise<{ priceUsd: number; changePercent24Hr: number; source: string }> {
    if (coincapKey) {
      try {
        const live = await fetchLivePrice(token, coincapKey)
        return { priceUsd: live.priceUsd, changePercent24Hr: live.changePercent24Hr, source: 'coincap-pro' }
      } catch (err) {
        serverLog.warn({ err, token }, 'CoinCap fetch failed, using fallback price')
      }
    }
    return { priceUsd: FALLBACK_PRICE, changePercent24Hr: 0, source: coincapKey ? 'coincap-pro' : 'mock' }
  }

  // GET /price/:token
  // Round 1 (no X-Payment): 402. Round 2 (X-Payment present): price JSON.
  app.get('/price/:token', async (req: Request, res: Response) => {
    const token = req.params['token']?.toUpperCase() ?? 'ETH'

    if (!req.headers['x-payment']) {
      demand402(res, '1000', `${token}/USDC price data`) // 0.001 USDC
      return
    }

    const { priceUsd, changePercent24Hr, source } = await getPrice(token)

    res.json({
      token,
      price_usdc:           priceUsd,
      change_percent_24hr:  changePercent24Hr,
      source,
      timestamp:            Math.floor(Date.now() / 1000),
    })
  })

  // GET /route?from=<addr>&to=<addr>&amount=<uint>&aggregator=<addr>
  // Returns TestAggregator.swap() calldata and expected output amounts.
  app.get('/route', async (req: Request, res: Response) => {
    if (!req.headers['x-payment']) {
      demand402(res, '2000', 'DEX swap routing') // 0.002 USDC
      return
    }

    const { from, to, amount, aggregator } = req.query as Record<string, string | undefined>
    if (!from || !to || !amount) {
      res.status(400).json({ error: 'missing query params: from, to, amount' })
      return
    }

    const { priceUsd } = await getPrice('ETH')
    res.json(buildRoute(from, to, BigInt(amount), aggregator, priceUsd))
  })

  // POST /v1/decide
  // The DCA agent's paid "work" endpoint: fetches the live price, runs the Claude
  // execution-safety check, and builds the swap route in one call.
  //
  // Round 1 (no X-Payment): 402 with maxAmountRequired = decidePriceUsdc.
  // Round 2 (X-Payment present): settle payment via USDC.transferFrom(payer -> payTo),
  // then return { price, decision, route, settlement }.
  app.post('/v1/decide', async (req: Request, res: Response) => {
    if (!req.headers['x-payment']) {
      demand402(res, decidePriceUsdc, 'DCA execution-safety decision + swap route')
      return
    }

    const body = req.body as {
      token?:        string
      spendToken?:   string
      outputToken?:  string
      spendAmount?:  string
      aggregator?:   string
      gasPriceGwei?: number
    }

    if (!body.spendToken || !body.outputToken || !body.spendAmount) {
      res.status(400).json({ error: 'missing required fields: spendToken, outputToken, spendAmount' })
      return
    }

    let payment: Payment
    try {
      payment = JSON.parse(req.headers['x-payment'] as string) as Payment
    } catch {
      res.status(400).json({ error: 'invalid X-Payment header' })
      return
    }

    const payer = payment.payload?.from as `0x${string}` | undefined
    if (!payer) {
      res.status(400).json({ error: 'X-Payment payload missing "from"' })
      return
    }

    // ── Settle payment on-chain via standing allowance ──────────────────────
    let txHash: `0x${string}`
    try {
      txHash = await clients.walletClient.writeContract({
        address:      assetAddr,
        abi:          ERC20ABI,
        functionName: 'transferFrom',
        args:         [payer, payToAddr, BigInt(decidePriceUsdc)],
        account:      clients.account,
        chain:        clients.chain,
      })
      await clients.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })
    } catch (err) {
      serverLog.warn({ err, payer }, '/v1/decide: payment settlement failed — missing USDC allowance?')
      demand402(res, decidePriceUsdc, `payment failed — approve USDC allowance to ${payToAddr}`)
      return
    }

    serverLog.info({ payer, txHash, amount: decidePriceUsdc }, '/v1/decide: payment settled')

    const token = (body.token ?? 'ETH').toUpperCase()
    const { priceUsd, changePercent24Hr, source } = await getPrice(token)

    const spendAmount = BigInt(body.spendAmount)
    const route       = buildRoute(body.spendToken, body.outputToken, spendAmount, body.aggregator, priceUsd)

    let decision: Decision
    if (claude) {
      decision = await claude.decide({
        token,
        priceUsdc:         priceUsd,
        changePercent24Hr,
        amountUsdc:        formatUnits(spendAmount, 6),
        gasPriceGwei:      body.gasPriceGwei ?? 0,
      })
    } else {
      decision = {
        should_execute:   true,
        slippage_bps:     50,
        anomaly_detected: false,
        reasoning:        'deterministic fallback — no Claude safety oracle configured',
      }
    }

    res.json({
      price: {
        token,
        price_usdc:          priceUsd,
        change_percent_24hr: changePercent24Hr,
        source,
        timestamp:           Math.floor(Date.now() / 1000),
      },
      decision,
      route,
      settlement: { txHash },
    })
  })

  app.listen(port, () => {
    serverLog.info({
      port,
      network,
      payTo:           payToAddr,
      decidePriceUsdc,
      priceSource: coincapKey ? 'coincap-pro' : `mock-$${FALLBACK_PRICE}`,
    }, 'mock x402 server listening')
  })
}
