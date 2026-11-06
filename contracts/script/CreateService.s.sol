// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {Subscriptions}            from "../src/Subscriptions.sol";
import {ServiceFactory}           from "../src/ServiceFactory.sol";
import {SIPService}               from "../src/SIPService.sol";
import {IERC8004IdentityRegistry} from "../src/interfaces/IERC8004IdentityRegistry.sol";
import {TestAggregator}           from "./helpers/MockContracts.sol";

// ─────────────────────────────────────────────────────────────────────────────
// CreateService — register a new agent + Service on Arbitrum Sepolia
//
// Service types:
//   "fixed" — generic fixed-amount Service, deployed via ServiceFactory.
//             Subscribers pay a fixed `amount` every `interval`.
//   "dca"   — SIPService (DCA swap service), deployed directly and registered
//             with Subscriptions. Subscribers pick their own per-cycle amount
//             (>= minAmountPerCycle).
//   "both"  — create one of each.
//
// Env vars:
//   SERVICE_TYPE          "fixed" | "dca" | "both"            (required)
//   PRIVATE_KEY           deployer/agent key                   (required)
//   FEE_RECEIVER          fee receiver address    (default: deployer)
//   SPEND_TOKEN           token subscribers pay in (default: mockUSDC)
//   INTERVAL              seconds between cycles   (default: 7 days)
//   AGENT_CARD_URI        agent card URL           (default: placeholder)
//
//   FIXED_AMOUNT          fixed per-cycle amount   (default: 10e6, "fixed"/"both" only)
//
//   MIN_AMOUNT_PER_CYCLE  min per-cycle DCA spend  (default: 1e6, "dca"/"both" only)
//   MAX_FEE_BPS           max protocol fee (bps)   (default: 100, "dca"/"both" only)
//   AGGREGATOR            swap aggregator address  (default: deploys a TestAggregator)
//   OUTPUT_TOKENS         comma-separated list of tokens the DCA service can swap into
//                         (default: mockWETH,mockWBTC)
//
// Run:
//   SERVICE_TYPE=fixed forge script script/CreateService.s.sol \
//     --rpc-url arbitrum_sepolia --broadcast -vvv
// ─────────────────────────────────────────────────────────────────────────────

contract CreateService is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        string memory serviceType = vm.envString("SERVICE_TYPE");
        bool createFixed = _eq(serviceType, "fixed") || _eq(serviceType, "both");
        bool createDca   = _eq(serviceType, "dca")   || _eq(serviceType, "both");
        require(createFixed || createDca, "SERVICE_TYPE must be 'fixed', 'dca' or 'both'");

        // ── load deployed addresses ────────────────────────────────────────────
        string memory json = vm.readFile("./deployments/arbitrum-sepolia.json");
        address identityRegistry = vm.parseJsonAddress(json, ".identityRegistry");
        address subscriptions    = vm.parseJsonAddress(json, ".subscriptions");
        address serviceFactory   = vm.parseJsonAddress(json, ".serviceFactory");
        address mockUsdc         = vm.parseJsonAddress(json, ".mockUSDC");
        address mockWeth         = vm.parseJsonAddress(json, ".mockWETH");
        address mockWbtc         = vm.parseJsonAddress(json, ".mockWBTC");

        // ── shared params ─────────────────────────────────────────────────────
        address feeReceiver  = vm.envOr("FEE_RECEIVER", deployer);
        address spendToken   = vm.envOr("SPEND_TOKEN", mockUsdc);
        uint32  interval     = uint32(vm.envOr("INTERVAL", uint256(7 days)));
        string memory agentCardURI = vm.envOr("AGENT_CARD_URI", string("https://example.com/.well-known/agent.json"));

        console.log("=== CreateService: Arbitrum Sepolia ===");
        console.log("Type:       ", serviceType);
        console.log("Agent:      ", deployer);
        console.log("FeeReceiver:", feeReceiver);
        console.log("SpendToken: ", spendToken);

        vm.startBroadcast(deployerKey);

        if (createFixed) {
            uint256 fixedAmount = vm.envOr("FIXED_AMOUNT", uint256(10e6));

            (address service, uint256 agentId) = ServiceFactory(serviceFactory).createService(
                feeReceiver,
                spendToken,
                fixedAmount,
                interval,
                agentCardURI
            );

            console.log("\n[fixed] Service created:", service);
            console.log("[fixed] Agent ID:        ", agentId);
            console.log("[fixed] Amount/cycle:    ", fixedAmount);

            vm.writeJson(vm.toString(service), "./deployments/arbitrum-sepolia.json", ".fixedService");
            vm.writeJson(vm.toString(agentId), "./deployments/arbitrum-sepolia.json", ".fixedServiceAgentId");
        }

        if (createDca) {
            uint256 minAmountPerCycle = vm.envOr("MIN_AMOUNT_PER_CYCLE", uint256(1e6));
            uint256 maxFeeBps         = vm.envOr("MAX_FEE_BPS", uint256(100));
            address aggregator        = vm.envOr("AGGREGATOR", address(0));
            address[] memory outputTokens = vm.envOr("OUTPUT_TOKENS", ",", _defaultOutputTokens(mockWeth, mockWbtc));

            if (aggregator == address(0)) {
                aggregator = address(new TestAggregator());
                console.log("\n[dca] Deployed TestAggregator:", aggregator);
            }

            uint256 agentId = IERC8004IdentityRegistry(identityRegistry).register(agentCardURI);

            SIPService sipService = new SIPService(
                deployer,
                subscriptions,
                feeReceiver,
                spendToken,
                minAmountPerCycle,
                interval,
                agentId,
                maxFeeBps,
                aggregator,
                outputTokens,
                0
            );

            Subscriptions(subscriptions).registerService(address(sipService));

            for (uint256 i = 0; i < outputTokens.length; i++) {
                console.log("[dca] Added output token:", outputTokens[i]);
            }

            console.log("\n[dca] SIPService created:", address(sipService));
            console.log("[dca] Agent ID:          ", agentId);
            console.log("[dca] Aggregator:        ", aggregator);
            console.log("[dca] Min amount/cycle:  ", minAmountPerCycle);

            vm.writeJson(vm.toString(address(sipService)), "./deployments/arbitrum-sepolia.json", ".sipService");
            vm.writeJson(vm.toString(agentId), "./deployments/arbitrum-sepolia.json", ".sipServiceAgentId");
            vm.writeJson(vm.toString(aggregator), "./deployments/arbitrum-sepolia.json", ".aggregator");
        }

        vm.stopBroadcast();
    }

    function _defaultOutputTokens(address mockWeth, address mockWbtc) private pure returns (address[] memory) {
        address[] memory tokens = new address[](2);
        tokens[0] = mockWeth;
        tokens[1] = mockWbtc;
        return tokens;
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
