import express, { type Request, type Response } from 'express'
import { formatUnits, isAddress } from 'viem'
import { logger }       from '../logger.js'
import { ERC20ABI }     from '../contracts/index.js'
import type { PaymentRequirements, Payment } from './types.js'
import { fetchLivePrice } from '../prices/coincap.js'
import type { Clients } from '../chain/client.js'
import { RiskAnalyzer, fallbackRiskReport, type Holding } from '../agent/riskAnalyzer.js'

// x402 worker for the Wallet Risk Analyzer one-time agent.
//
// POST /v1/invoke is the paid "work" endpoint: payment is settled for real
// on-chain via USDC.transferFrom(payer -> this agent's wallet), using a standing
// allowance the payer approved up front (same pattern as the DCA agent's /v1/decide).
export function startRiskAnalyzerServer(
  port:                number,
  usdcAddr:            `0x${string}`,
  payToAddr:           `0x${string}`,
  network:             string,
  coincapKey:          string | undefined,
  clients:             Clients,
  riskAnalyzer:        RiskAnalyzer | null,
  riskReportPriceUsdc: string,
): void {
  const app           = express()
  const FALLBACK_ETH_PRICE = 1647.0
  const serverLog      = logger.child({ component: 'agent-risk-analyzer' })

  app.use(express.json())

  function demand402(res: Response, amount: string, description: string): void {
    const req: PaymentRequirements = {
      scheme: 'exact', network, maxAmountRequired: amount,
      asset: usdcAddr, payTo: payToAddr, description,
    }
    res.status(402).json(req)
  }

  async function getEthPrice(): Promise<{ priceUsd: number; source: string }> {
    if (coincapKey) {
      try {
        const live = await fetchLivePrice('ETH', coincapKey)
        return { priceUsd: live.priceUsd, source: 'coincap-pro' }
      } catch (err) {
        serverLog.warn({ err }, 'CoinCap fetch failed, using fallback price')
      }
    }
    return { priceUsd: FALLBACK_ETH_PRICE, source: coincapKey ? 'coincap-pro' : 'mock' }
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'agent-risk-analyzer' })
  })

  // POST /v1/invoke
  // Body: { wallet_address: "0x..." }
  //
  // Round 1 (no X-Payment): 402 with maxAmountRequired = riskReportPriceUsdc.
  // Round 2 (X-Payment present): settle payment via USDC.transferFrom(payer -> payTo),
  // then read the wallet's ETH + USDC balances and respond with a risk report.
  app.post('/v1/invoke', async (req: Request, res: Response) => {
    if (!req.headers['x-payment']) {
      demand402(res, riskReportPriceUsdc, 'Wallet risk analysis report')
      return
    }

    const body = req.body as { wallet_address?: string }
    const walletAddress = body.wallet_address as `0x${string}` | undefined
    if (!walletAddress) {
      res.status(400).json({ error: 'missing required field: wallet_address' })
      return
    }
    if (!isAddress(walletAddress)) {
      res.status(400).json({ error: `invalid wallet_address: ${walletAddress}` })
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
        address:      usdcAddr,
        abi:          ERC20ABI,
        functionName: 'transferFrom',
        args:         [payer, payToAddr, BigInt(riskReportPriceUsdc)],
        account:      clients.account,
        chain:        clients.chain,
      })
      await clients.publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })
    } catch (err) {
      serverLog.warn({ err, payer }, '/v1/invoke: payment settlement failed — missing USDC allowance?')
      demand402(res, riskReportPriceUsdc, `payment failed — approve USDC allowance to ${payToAddr}`)
      return
    }

    serverLog.info({ payer, txHash, amount: riskReportPriceUsdc }, '/v1/invoke: payment settled')

    // ── Read on-chain holdings ────────────────────────────────────────────────
    try {
      const [ethBalance, usdcBalance, { priceUsd: ethPriceUsd, source: priceSource }] = await Promise.all([
        clients.publicClient.getBalance({ address: walletAddress }),
        clients.publicClient.readContract({
          address:      usdcAddr,
          abi:          ERC20ABI,
          functionName: 'balanceOf',
          args:         [walletAddress],
        }) as Promise<bigint>,
        getEthPrice(),
      ])

      const ethValueUsd  = Number(formatUnits(ethBalance, 18)) * ethPriceUsd
      const usdcValueUsd = Number(formatUnits(usdcBalance, 6))

      const holdings: Holding[] = [
        { symbol: 'ETH',  balance: formatUnits(ethBalance, 18),  value_usd: ethValueUsd },
        { symbol: 'USDC', balance: formatUnits(usdcBalance, 6), value_usd: usdcValueUsd },
      ].filter(h => Number(h.balance) > 0)

      const totalValueUsd = ethValueUsd + usdcValueUsd

      const analysisInput = { walletAddress, holdings, totalValueUsd }
      const report = riskAnalyzer
        ? await riskAnalyzer.analyze(analysisInput)
        : fallbackRiskReport(analysisInput)

      res.json({
        wallet_address:  walletAddress,
        total_value_usd: totalValueUsd,
        holdings,
        price_source:    priceSource,
        report,
        settlement: { txHash },
        generated_at: new Date().toISOString(),
      })
    } catch (err) {
      serverLog.error({ err, walletAddress }, '/v1/invoke: failed to build risk report after settling payment')
      res.status(500).json({ error: 'failed to generate risk report', settlement: { txHash } })
    }
  })

  app.listen(port, () => {
    serverLog.info({
      port,
      network,
      payTo:               payToAddr,
      riskReportPriceUsdc,
      priceSource: coincapKey ? 'coincap-pro' : `mock-$${FALLBACK_ETH_PRICE}`,
    }, 'agent-risk-analyzer x402 server listening')
  })
}
