import SubscriptionsABI from './abis/Subscriptions.json' with { type: 'json' }
import ValidationRegistryABI from './abis/ValidationRegistry.json' with { type: 'json' }
import ServiceFactoryABI from './abis/ServiceFactory.json' with { type: 'json' }
import ServiceABI from './abis/Service.json' with { type: 'json' }
import IdentityRegistryABI from './abis/IdentityRegistry.json' with { type: 'json' }
import ERC20ABI from './abis/ERC20.json' with { type: 'json' }
import Permit2ABI from './abis/Permit2.json' with { type: 'json' }

/** Canonical Permit2 deployment address, same on every EVM chain. */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

// TestAggregator.swap() — only the one function the agent needs to encode calldata for
export const TestAggregatorSwapABI = [{
  name: 'swap',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spendToken',   type: 'address' },
    { name: 'spendAmount',  type: 'uint256' },
    { name: 'outputToken',  type: 'address' },
    { name: 'outputAmount', type: 'uint256' },
  ],
  outputs: [],
}] as const

export {
  SubscriptionsABI,
  ValidationRegistryABI,
  ServiceFactoryABI,
  ServiceABI,
  IdentityRegistryABI,
  ERC20ABI,
  Permit2ABI
}
