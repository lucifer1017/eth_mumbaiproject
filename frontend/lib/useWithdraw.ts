"use client";

import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { CONTRACT_CHAIN, USDC_ADDRESS, serviceAbi } from "./contracts";
import { getGasFees } from "./gas";

/** Withdraws a creator's accrued USDC fees from their SIPService contract (onlyOwner). */
export function useWithdraw() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CONTRACT_CHAIN.id });
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const withdraw = useCallback(
    async (serviceAddress: `0x${string}`): Promise<`0x${string}`> => {
      if (!USDC_ADDRESS) throw new Error("contract addresses not configured: set NEXT_PUBLIC_USDC_ADDRESS");
      if (!publicClient) throw new Error("no RPC client for Arbitrum Sepolia");

      setIsWithdrawing(true);
      try {
        if (chainId !== CONTRACT_CHAIN.id) {
          await switchChainAsync({ chainId: CONTRACT_CHAIN.id });
        }

        const fees = await getGasFees(publicClient);
        const txHash = await writeContractAsync({
          address: serviceAddress,
          abi: serviceAbi,
          functionName: "withdraw",
          args: [USDC_ADDRESS],
          chainId: CONTRACT_CHAIN.id,
          ...fees,
        });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        return txHash;
      } finally {
        setIsWithdrawing(false);
      }
    },
    [chainId, publicClient, switchChainAsync, writeContractAsync]
  );

  return { withdraw, isWithdrawing };
}
