// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Subscriptions}   from "../src/Subscriptions.sol";
import {IPermit2}        from "../src/interfaces/IPermit2.sol";
import {TestERC20}       from "./helpers/MockContracts.sol";

// Permit2 exposes DOMAIN_SEPARATOR and allowance beyond our minimal IPermit2 interface.
interface IPermit2Full is IPermit2 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function allowance(address owner, address token, address spender)
        external view returns (uint160 amount, uint48 expiration, uint48 nonce);
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscribe — creates one testnet DCA subscription
//
// What it does:
//   1. Mints enough mockUSDC to cover the full subscription window
//   2. Approves Permit2 to spend mockUSDC (one-time, max amount)
//   3. Builds and signs a Permit2 PermitSingle off-chain (EIP-712)
//   4. Calls Subscriptions.subscribe()
//   5. Prints the subscription ID — copy it into .env as SUBSCRIPTION_ID
//
// Run:
//   forge script script/Subscribe.s.sol \
//     --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
//     --broadcast -vvv
// ─────────────────────────────────────────────────────────────────────────────

contract Subscribe is Script {
    // EIP-712 type hashes — must match Permit2's exact strings
    bytes32 constant PERMIT_DETAILS_TYPEHASH = keccak256(
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );
    bytes32 constant PERMIT_SINGLE_TYPEHASH = keccak256(
        "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)"
        "PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
    );

    function run() external {
        // DCA parameters — read from env, fall back to defaults.
        // INTERVAL_SECS must match the service's configured interval exactly.
        uint256 spendPerCycle = vm.envOr("SPEND_PER_CYCLE", uint256(10e6));
        uint256 intervalSecs  = vm.envOr("INTERVAL_SECS",   uint256(5 minutes));
        uint48  windowSecs    = uint48(vm.envOr("WINDOW_SECS", uint256(2 hours)));
        // ── load deployed addresses ───────────────────────────────────────────
        string memory json = vm.readFile("./deployments/arbitrum-sepolia.json");
        address mockUsdc      = vm.parseJsonAddress(json, ".mockUSDC");
        address mockWeth      = vm.parseJsonAddress(json, ".mockWETH");
        address subscriptions = vm.parseJsonAddress(json, ".subscriptions");
        address sipService    = vm.parseJsonAddress(json, ".sipService");
        address permit2Addr   = vm.parseJsonAddress(json, ".permit2");

        uint256 subscriberKey = vm.envUint("PRIVATE_KEY");
        address subscriber    = vm.addr(subscriberKey);

        console.log("Subscriber:    ", subscriber);
        console.log("Subscriptions: ", subscriptions);
        console.log("SIPService:    ", sipService);
        console.log("Output token:  ", mockWeth);

        // ── compute how much permit allowance is needed ───────────────────────
        // Permit2 has ONE allowance slot per (owner, token, spender).
        // Each subscribe() call's permit() OVERWRITES the previous slot.
        // Fix: use type(uint160).max as the permit amount so the slot is never
        // depleted by concurrent subscriptions.
        // Expiry: add 5-min buffer so a later sub's permit() doesn't cut short
        // an earlier sub's Permit2 window (Permit2 expiry and sub expiry are the same field).
        uint48  expiry         = uint48(block.timestamp + windowSecs + 300);
        uint256 executionCount = (uint256(block.timestamp + windowSecs) - block.timestamp) / intervalSecs;
        uint256 mintAmount     = spendPerCycle * executionCount; // mint only what's actually needed
        uint160 permitAmount   = type(uint160).max;              // Permit2 slot never exhausted

        console.log("Execution count in window:", executionCount);
        console.log("Total USDC needed:        ", mintAmount);

        // ── broadcast ─────────────────────────────────────────────────────────
        vm.startBroadcast(subscriberKey);

        // Mint exactly enough mockUSDC for this subscription's window
        TestERC20(mockUsdc).mint(subscriber, mintAmount);

        // One-time max approval to Permit2 (covers all future subscriptions)
        TestERC20(mockUsdc).approve(permit2Addr, type(uint256).max);

        vm.stopBroadcast();

        // ── build and sign the Permit2 PermitSingle (off-chain, no broadcast) ─
        IPermit2Full p2 = IPermit2Full(permit2Addr);

        // Read current nonce from Permit2 (increments after each permit call)
        (, , uint48 p2Nonce) = p2.allowance(subscriber, mockUsdc, subscriptions);

        IPermit2.PermitSingle memory permit = IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token:      mockUsdc,
                amount:     permitAmount,
                expiration: expiry,
                nonce:      p2Nonce
            }),
            spender:     subscriptions,
            sigDeadline: block.timestamp + 30 minutes
        });

        // EIP-712 digest
        bytes32 detailsHash = keccak256(abi.encode(
            PERMIT_DETAILS_TYPEHASH,
            permit.details.token,
            permit.details.amount,
            permit.details.expiration,
            permit.details.nonce
        ));
        bytes32 structHash = keccak256(abi.encode(
            PERMIT_SINGLE_TYPEHASH,
            detailsHash,
            permit.spender,
            permit.sigDeadline
        ));
        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            p2.DOMAIN_SEPARATOR(),
            structHash
        ));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(subscriberKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // ── subscribe ─────────────────────────────────────────────────────────
        vm.startBroadcast(subscriberKey);
        Subscriptions(subscriptions).subscribe(
            sipService,
            mockUsdc,
            spendPerCycle,
            intervalSecs,
            permit,
            sig,
            bytes("") // extra service params — SIPService accepts any
        );
        vm.stopBroadcast();

        // ── print subscription ID ─────────────────────────────────────────────
        uint256 nonce = Subscriptions(subscriptions).nonces(subscriber) - 1;
        bytes32 subId = keccak256(abi.encode(subscriber, sipService, mockUsdc, nonce));

        console.log("\nSubscription created!");
        console.log("Per cycle (USDC):", spendPerCycle);
        console.log("Interval (secs): ", intervalSecs);
        console.log("Window (secs):   ", uint256(windowSecs));
        console.log("Executions:      ", executionCount);
        console.log("USDC minted:     ", mintAmount);
        console.log("\nSet this in .env as SUBSCRIPTION_ID:");
        console.logBytes32(subId);
    }
}
