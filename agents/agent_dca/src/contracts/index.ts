import ERC20ABI from './abis/ERC20.json' with { type: 'json' }

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

export { ERC20ABI }
