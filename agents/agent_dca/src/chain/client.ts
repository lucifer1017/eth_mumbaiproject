import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia, arbitrum } from 'viem/chains'

function getChain(chainId: number) {
  if (chainId === 421614) return arbitrumSepolia
  if (chainId === 42161)  return arbitrum
  // Fallback for any custom chain ID
  return defineChain({ id: chainId, name: 'custom', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [] } } })
}

export function buildClients(rpcUrl: string, chainId: number, privateKey: `0x${string}`) {
  const chain   = getChain(chainId)
  const account = privateKeyToAccount(privateKey)

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  return { publicClient, walletClient, account, chain }
}

export type Clients = ReturnType<typeof buildClients>
