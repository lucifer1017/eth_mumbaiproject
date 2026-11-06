// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console}               from "forge-std/Script.sol";
import {Subscriptions, Subscription}   from "../src/Subscriptions.sol";
import {SwapParams}                    from "../src/SIPService.sol";
import {TestERC20, TestAggregator}     from "./helpers/MockContracts.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Execute — simulates one agent execution cycle
//
// This is what the real agent backend will do automatically on a schedule.
// Run it manually to prove the DCA loop works end-to-end.
//
// What it does:
//   1. Reads the subscription state from chain
//   2. Computes outputAmount using a mock ETH price (3000 USDC/ETH)
//   3. Encodes swapData for TestAggregator
//   4. Calls Subscriptions.execute(subId, params) signed as the executor
//   5. Prints before/after mWETH balance of the subscriber
//
// Run:
//   forge script script/Execute.s.sol \
//     --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
//     --broadcast -vvv
//
// SUBSCRIPTION_ID must be set in .env (printed by Subscribe.s.sol).
// ─────────────────────────────────────────────────────────────────────────────

contract Execute is Script {
    // Simulated market price used to compute how many output tokens to mint.
    // A real agent fetches this via a price feed API (paid via x402).
    uint256 constant MOCK_ETH_PRICE_USDC = 3_000; // 1 ETH = 3000 USDC

    function run() external {
        // ── load deployed addresses ───────────────────────────────────────────
        string memory json = vm.readFile("./deployments/arbitrum-sepolia.json");
        address mockUsdc      = vm.parseJsonAddress(json, ".mockUSDC");
        address mockWeth      = vm.parseJsonAddress(json, ".mockWETH");
        address subscriptions = vm.parseJsonAddress(json, ".subscriptions");

        bytes32 subId       = vm.envBytes32("SUBSCRIPTION_ID");
        uint256 executorKey = vm.envUint("PRIVATE_KEY");
        address executor    = vm.addr(executorKey);

        // ── read current subscription state ───────────────────────────────────
        Subscription memory sub = Subscriptions(subscriptions).getSubscription(subId);

        require(sub.subscriber != address(0), "Subscription not found");
        require(sub.permitExpiry > block.timestamp, "Subscription expired");
        require(
            block.timestamp >= sub.lastExecutionTime + sub.interval,
            "Too early: wait for next interval"
        );

        console.log("Executor:              ", executor);
        console.log("Subscriber:            ", sub.subscriber);
        console.log("Spend per cycle (USDC):", sub.amountPerCycle);
        console.log("Last executed at:      ", sub.lastExecutionTime);
        console.log("Next valid at:         ", sub.lastExecutionTime + sub.interval);

        // ── compute swap amounts ──────────────────────────────────────────────
        // spendAmount: what Subscriptions will pull from subscriber via Permit2
        uint256 spendAmount = sub.amountPerCycle;

        // outputAmount: how many mWETH (18 decimals) to mint for the spent USDC
        // Formula: (spendAmount_in_USDC / price_in_USDC) converted to 18 decimals
        // e.g. 10 USDC / 3000 USDC-per-ETH = 0.00333... ETH
        uint256 outputAmount = spendAmount * 1e18 / (MOCK_ETH_PRICE_USDC * 1e6);

        // Apply 0.5% slippage: minOutputAmount = outputAmount * 99.5%
        uint256 minOutput = outputAmount * 995 / 1000;

        console.log("Output amount (mWETH):", outputAmount);
        console.log("Min output (slippage): ", minOutput);

        // ── encode swapData for TestAggregator ────────────────────────────────
        // TestAggregator.swap(spendToken, spendAmount, outputToken, outputAmount)
        // It will: pull spendAmount from SIPService, mint outputAmount to SIPService
        bytes memory swapData = abi.encodeWithSelector(
            TestAggregator.swap.selector,
            mockUsdc,
            spendAmount,
            mockWeth,
            outputAmount
        );

        bytes memory params = abi.encode(SwapParams({
            outputToken:     mockWeth,
            minOutputAmount: minOutput,
            swapData:        swapData
        }));

        // ── snapshot balance before ───────────────────────────────────────────
        uint256 wethBefore = TestERC20(mockWeth).balanceOf(sub.subscriber);
        uint256 usdcBefore = TestERC20(mockUsdc).balanceOf(sub.subscriber);

        // ── execute ───────────────────────────────────────────────────────────
        vm.startBroadcast(executorKey);
        Subscriptions(subscriptions).execute(subId, params);
        vm.stopBroadcast();

        // ── print results ─────────────────────────────────────────────────────
        uint256 wethAfter = TestERC20(mockWeth).balanceOf(sub.subscriber);
        uint256 usdcAfter = TestERC20(mockUsdc).balanceOf(sub.subscriber);

        console.log("\n=== Execution complete ===");
        console.log("USDC spent:        ", usdcBefore - usdcAfter);
        console.log("mWETH received:    ", wethAfter - wethBefore);
        console.log("Subscriber mWETH:  ", wethAfter);
        console.log("Subscriber mUSDC:  ", usdcAfter);

        // Read updated lastExecutionTime
        Subscription memory updated = Subscriptions(subscriptions).getSubscription(subId);
        console.log("Next execution at: ", updated.lastExecutionTime + updated.interval);
    }
}
