import { logger }                     from '../logger.js'
import { Permit2ABI, PERMIT2_ADDRESS } from '../contracts/index.js'
import type { Clients }               from '../chain/client.js'
import type { X402Client }            from '../x402/client.js'

export interface PermitSingleStruct {
  details: {
    token:      `0x${string}`
    amount:     bigint
    expiration: number
    nonce:      number
  }
  spender:     `0x${string}`
  sigDeadline: bigint
}

export interface AgentInvokeParams {
  owner:          `0x${string}`
  creator:        `0x${string}`
  permitSingle:   PermitSingleStruct
  signature:      `0x${string}`
  agentInvokeFee: bigint // smallest units (USDC), platform's cut of permitSingle.details.amount
  invokeUrl:      string
  paramValues:    unknown
}

export interface AgentInvokeResult {
  output:         unknown
  platformTxHash: `0x${string}` | null
  creatorTxHash:  `0x${string}` | null
  platformAmount: bigint
  creatorAmount:  bigint
}

// Settles a one-time agent's fee via the subscriber's Permit2 allowance, splits
// it between the platform (executor wallet) and the agent's creator, then pays
// the agent's own x402 /v1/invoke demand from the platform's just-received cut
// and returns its report.
export class AgentInvokeService {
  constructor(
    private readonly clients:    Clients,
    private readonly x402Client: X402Client,
  ) {}

  async run(params: AgentInvokeParams): Promise<AgentInvokeResult> {
    const { owner, creator, permitSingle, signature, agentInvokeFee, invokeUrl, paramValues } = params
    const totalAmount   = permitSingle.details.amount
    const creatorAmount = totalAmount - agentInvokeFee
    const platformAddr  = this.clients.account.address
    const token         = permitSingle.details.token

    // 1. Register the Permit2 allowance.
    const permitTxHash = await this.clients.walletClient.writeContract({
      address:      PERMIT2_ADDRESS,
      abi:          Permit2ABI,
      functionName: 'permit',
      args:         [owner, permitSingle, signature],
      account:      this.clients.account,
      chain:        this.clients.chain,
    })
    await this.clients.publicClient.waitForTransactionReceipt({ hash: permitTxHash, timeout: 60_000 })

    // 2. Platform cut.
    let platformTxHash: `0x${string}` | null = null
    if (agentInvokeFee > 0n) {
      platformTxHash = await this.clients.walletClient.writeContract({
        address:      PERMIT2_ADDRESS,
        abi:          Permit2ABI,
        functionName: 'transferFrom',
        args:         [owner, platformAddr, agentInvokeFee, token],
        account:      this.clients.account,
        chain:        this.clients.chain,
      })
      await this.clients.publicClient.waitForTransactionReceipt({ hash: platformTxHash, timeout: 60_000 })
    }

    // 3. Creator cut.
    let creatorTxHash: `0x${string}` | null = null
    if (creatorAmount > 0n) {
      creatorTxHash = await this.clients.walletClient.writeContract({
        address:      PERMIT2_ADDRESS,
        abi:          Permit2ABI,
        functionName: 'transferFrom',
        args:         [owner, creator, creatorAmount, token],
        account:      this.clients.account,
        chain:        this.clients.chain,
      })
      await this.clients.publicClient.waitForTransactionReceipt({ hash: creatorTxHash, timeout: 60_000 })
    }

    logger.info({ owner, creator, platformTxHash, creatorTxHash, agentInvokeFee: agentInvokeFee.toString(), creatorAmount: creatorAmount.toString() }, 'agent-invoke: payment settled')

    // 4-5. Pay the agent's own x402 demand from the platform's cut and get its report.
    const output = await this.x402Client.invoke(invokeUrl, paramValues)

    return { output, platformTxHash, creatorTxHash, platformAmount: agentInvokeFee, creatorAmount }
  }
}
