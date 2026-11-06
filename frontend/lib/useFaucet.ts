"use client";

import { useCallback, useState } from "react";
import { parseUnits } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { CONTRACT_CHAIN, USDC_ADDRESS, USDC_DECIMALS } from "./contracts";
import { getGasFees } from "./gas";

// TestERC20.mint(address,uint256) — open mint on testnet, used as a faucet.
const testErc20Abi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const FAUCET_AMOUNT = "100"; // USDC

/** Mints test USDC directly to the connected wallet via TestERC20's open mint(). */
export function useFaucet() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CONTRACT_CHAIN.id });
  const [isMinting, setIsMinting] = useState(false);

  const mint = useCallback(async (): Promise<`0x${string}`> => {
    if (!address) throw new Error("wallet not connected");
    if (!USDC_ADDRESS) throw new Error("contract addresses not configured: set NEXT_PUBLIC_USDC_ADDRESS");
    if (!publicClient) throw new Error("no RPC client for Arbitrum Sepolia");

    setIsMinting(true);
    try {
      if (chainId !== CONTRACT_CHAIN.id) {
        await switchChainAsync({ chainId: CONTRACT_CHAIN.id });
      }

      const fees = await getGasFees(publicClient);
      const txHash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: testErc20Abi,
        functionName: "mint",
        args: [address, parseUnits(FAUCET_AMOUNT, USDC_DECIMALS)],
        chainId: CONTRACT_CHAIN.id,
        ...fees,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      return txHash;
    } finally {
      setIsMinting(false);
    }
  }, [address, chainId, publicClient, switchChainAsync, writeContractAsync]);

  return { mint, isMinting, faucetAmount: FAUCET_AMOUNT };
}
