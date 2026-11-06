import { createPublicClient, http, formatUnits, type Address } from 'viem'
import { arbitrumSepolia, arbitrum } from 'viem/chains'
import { config } from '../config.js'

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const chain = config.chainId === 421614 ? arbitrumSepolia : arbitrum

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) })

export const chainName = config.chainId === 421614 ? 'arbitrum-sepolia' : 'arbitrum-one'

// Returns the user's USDC balance, formatted as a decimal string. Falls back
// to "0" if the read fails (e.g. RPC hiccup) so billing endpoints stay available.
export async function getUsdcBalance(userAddress: Address): Promise<string> {
  try {
    const raw = await publicClient.readContract({
      address: config.usdcAddr,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    })
    return formatUnits(raw, 6)
  } catch {
    return '0'
  }
}
