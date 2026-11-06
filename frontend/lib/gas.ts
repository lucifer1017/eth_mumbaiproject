import type { PublicClient } from "viem";

/**
 * Estimate EIP-1559 fees for a "medium" speed default with headroom over the
 * current base fee, so the tx doesn't get rejected if the base fee ticks up
 * between estimation and submission (the "max fee per gas less than block
 * base fee" RPC error). The wallet's confirmation UI still lets the user
 * raise or lower these before signing.
 */
export async function getGasFees(
  publicClient: PublicClient,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? BigInt(100_000_000); // 0.1 gwei fallback

  let maxPriorityFeePerGas: bigint;
  try {
    maxPriorityFeePerGas = await publicClient.estimateMaxPriorityFeePerGas();
  } catch {
    maxPriorityFeePerGas = BigInt(100_000_000); // 0.1 gwei fallback
  }

  // "Medium": 2x the current base fee plus the priority fee, giving enough
  // headroom for a few blocks of base fee increase.
  const maxFeePerGas = baseFee * BigInt(2) + maxPriorityFeePerGas;

  return { maxFeePerGas, maxPriorityFeePerGas };
}
