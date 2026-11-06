// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {Subscriptions}             from "../src/Subscriptions.sol";
import {SIPService}                from "../src/SIPService.sol";
import {ServiceFactory}            from "../src/ServiceFactory.sol";
import {ServiceDeployer}           from "../src/ServiceDeployer.sol";
import {ERC8004IdentityRegistry}   from "../src/ERC8004IdentityRegistry.sol";
import {ERC8004ValidationRegistry} from "../src/ERC8004ValidationRegistry.sol";

// ─────────────────────────────────────────────────────────────────────────────
// DeployMainnet — Arbitrum One
//
// Required env vars (set in .env):
//   PRIVATE_KEY                  deployer EOA private key
//   ARBITRUM_RPC_URL             mainnet RPC
//   ARBISCAN_API_KEY             for verification
//   EXECUTOR_ADDRESS             hot wallet that the agent backend uses to sign txs
//   TREASURY_ADDRESS             multisig or EOA that receives protocol fees
//   AGGREGATOR_ADDRESS           DEX router (e.g. Uniswap V3 SwapRouter02 on Arbitrum)
//   AGENT_CARD_URI               AgentCard JSON URL for the SIPService identity
//   SIP_INTERVAL_SECS            optional; default 604800 (7 days)
//
// Token addresses (Arbitrum One — set in .env or override below):
//   USDC_ADDRESS                 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
//   WETH_ADDRESS                 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
//   WBTC_ADDRESS                 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f
//   ARB_ADDRESS                  0x912CE59144191C1204E64559FE8253a0e49E6548
//
// Run:
//   forge script script/DeployMainnet.s.sol \
//     --rpc-url arbitrum_one \
//     --broadcast \
//     --verify \
//     -vvv
// ─────────────────────────────────────────────────────────────────────────────

contract DeployMainnet is Script {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    uint256 constant MAX_FEE_BPS          = 100; // 1% hard cap
    uint256 constant MIN_AMOUNT_PER_CYCLE = 1e6; // 1 USDC minimum per cycle

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        address executor   = vm.envAddress("EXECUTOR_ADDRESS");
        address treasury   = vm.envAddress("TREASURY_ADDRESS");
        address aggregator = vm.envAddress("AGGREGATOR_ADDRESS");

        address usdc = vm.envAddress("USDC_ADDRESS");
        address weth = vm.envAddress("WETH_ADDRESS");
        address wbtc = vm.envAddress("WBTC_ADDRESS");
        address arb  = vm.envAddress("ARB_ADDRESS");

        string memory agentCardURI = vm.envString("AGENT_CARD_URI");
        uint32 sipInterval = uint32(vm.envOr("SIP_INTERVAL_SECS", uint256(7 days)));

        console.log("=== DeployMainnet: Arbitrum One ===");
        console.log("Deployer:   ", deployer);
        console.log("Executor:   ", executor);
        console.log("Treasury:   ", treasury);
        console.log("Aggregator: ", aggregator);

        vm.startBroadcast(deployerKey);

        // ── 1. Subscriptions ──────────────────────────────────────────────────
        Subscriptions subs = new Subscriptions(
            PERMIT2,
            executor
        );
        console.log("Subscriptions:", address(subs));

        // ── 2. ERC-8004 registries ──────────────────────────────────────────
        ERC8004IdentityRegistry identityRegistry = new ERC8004IdentityRegistry();
        ERC8004ValidationRegistry validationRegistry = new ERC8004ValidationRegistry(deployer);
        console.log("IdentityRegistry:",   address(identityRegistry));
        console.log("ValidationRegistry:", address(validationRegistry));

        // ── 3. ServiceFactory ─────────────────────────────────────────────────
        ServiceDeployer serviceDeployer = new ServiceDeployer();
        console.log("ServiceDeployer:", address(serviceDeployer));

        ServiceFactory serviceFactory = new ServiceFactory(
            address(subs),
            address(identityRegistry),
            address(serviceDeployer)
        );
        console.log("ServiceFactory:", address(serviceFactory));

        identityRegistry.setRegistrar(address(serviceFactory), true);
        subs.setFactory(address(serviceFactory));

        // ── 4. SIPService (example DCA agent, direct deploy) ────────────────
        uint256 sipAgentId = identityRegistry.register(agentCardURI);

        address[] memory dcaOutputTokens = new address[](3);
        dcaOutputTokens[0] = weth;
        dcaOutputTokens[1] = wbtc;
        dcaOutputTokens[2] = arb;

        SIPService sipService = new SIPService(
            deployer,
            address(subs),
            treasury,
            usdc,
            MIN_AMOUNT_PER_CYCLE,
            sipInterval,
            sipAgentId,
            MAX_FEE_BPS,
            aggregator,
            dcaOutputTokens,
            0
        );
        console.log("SIPService:", address(sipService));
        console.log("SIP agentId:", sipAgentId);

        // ── 5. Wire up ────────────────────────────────────────────────────────
        subs.registerService(address(sipService));

        console.log("Service registered. Output tokens whitelisted:");
        console.log("  WETH:", weth);
        console.log("  WBTC:", wbtc);
        console.log("  ARB: ", arb);

        vm.stopBroadcast();

        // ── 6. Save addresses ─────────────────────────────────────────────────
        string memory json = "mainnet";
        vm.serializeAddress(json, "permit2",              PERMIT2);
        vm.serializeAddress(json, "usdc",                 usdc);
        vm.serializeAddress(json, "weth",                 weth);
        vm.serializeAddress(json, "wbtc",                 wbtc);
        vm.serializeAddress(json, "arb",                  arb);
        vm.serializeAddress(json, "aggregator",           aggregator);
        vm.serializeAddress(json, "executor",             executor);
        vm.serializeAddress(json, "treasury",             treasury);
        vm.serializeAddress(json, "identityRegistry",     address(identityRegistry));
        vm.serializeAddress(json, "validationRegistry",     address(validationRegistry));
        vm.serializeAddress(json, "subscriptions",        address(subs));
        vm.serializeAddress(json, "sipService",           address(sipService));
        string memory out =
        vm.serializeAddress(json, "serviceFactory",       address(serviceFactory));

        vm.writeJson(out, "./deployments/arbitrum-mainnet.json");
        console.log("Addresses saved to ./deployments/arbitrum-mainnet.json");
    }
}