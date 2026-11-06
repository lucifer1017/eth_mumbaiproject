// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {Subscriptions}             from "../src/Subscriptions.sol";
import {ServiceFactory}            from "../src/ServiceFactory.sol";
import {ServiceDeployer}           from "../src/ServiceDeployer.sol";
import {ERC8004IdentityRegistry}   from "../src/ERC8004IdentityRegistry.sol";
import {ERC8004ValidationRegistry} from "../src/ERC8004ValidationRegistry.sol";
import {TestERC20} from "./helpers/MockContracts.sol";

// ─────────────────────────────────────────────────────────────────────────────
// DeployTestnet — Arbitrum Sepolia
//
// Deployment order (each step depends on the one before):
//   1. Mock tokens (USDC, WETH, WBTC)
//   2. TestAggregator
//   3. Subscriptions              (permit2, executor EOA)
//   4. ERC-8004 IdentityRegistry + ValidationRegistry
//   5. ServiceFactory             (subscriptions, identityRegistry)
//   6. Wire: setRegistrar + setFactory
//   7. Optional SIPService        (direct deploy with registered identity)
//   8. Mint test USDC to deployer
//   9. Save addresses to deployments/arbitrum-sepolia.json
//
// Run:
//   forge script script/DeployTestnet.s.sol \
//     --rpc-url arbitrum_sepolia \
//     --broadcast \
//     --verify \
//     -vvv
// ─────────────────────────────────────────────────────────────────────────────

contract DeployTestnet is Script {
    // Permit2 canonical address — same on every EVM chain including Sepolia
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Maximum fee the SIPService owner can ever set (100 bps = 1%)
    uint256 constant MAX_FEE_BPS = 100;

    // Minimum per-cycle spend SIPService accepts at subscribe time (1 mUSDC)
    uint256 constant MIN_AMOUNT_PER_CYCLE = 1e6;

    // Default DCA interval enforced by SIPService at subscribe time
    uint32 constant DEFAULT_INTERVAL = 7 days;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("=== DeployTestnet: Arbitrum Sepolia ===");
        console.log("Deployer / Agent / Treasury:", deployer);

        vm.startBroadcast(deployerKey);

        // ── 1. Mock tokens ────────────────────────────────────────────────────
        TestERC20 mockUsdc = new TestERC20("Mock USDC",  "mUSDC", 6);
        TestERC20 mockWeth = new TestERC20("Mock WETH",  "mWETH", 18);
        TestERC20 mockWbtc = new TestERC20("Mock WBTC",  "mWBTC", 8);

        console.log("mockUSDC:", address(mockUsdc));
        console.log("mockWETH:", address(mockWeth));
        console.log("mockWBTC:", address(mockWbtc));

        // ── 2. TestAggregator ─────────────────────────────────────────────────
        // TestAggregator aggregator = new TestAggregator();
        // console.log("TestAggregator:", address(aggregator));

        // ── 3. Subscriptions ──────────────────────────────────────────────────
        Subscriptions subs = new Subscriptions(
            PERMIT2,
            deployer           // executor EOA (agent wallet)
        );
        console.log("Subscriptions:", address(subs));

        // ── 4. ERC-8004 registries ──────────────────────────────────────────────
        ERC8004IdentityRegistry identityRegistry = new ERC8004IdentityRegistry();
        ERC8004ValidationRegistry validationRegistry = new ERC8004ValidationRegistry(deployer);
        console.log("IdentityRegistry:",   address(identityRegistry));
        console.log("ValidationRegistry:", address(validationRegistry));

        // ── 5. ServiceFactory ─────────────────────────────────────────────────
        ServiceDeployer serviceDeployer = new ServiceDeployer();
        console.log("ServiceDeployer:", address(serviceDeployer));

        ServiceFactory serviceFactory = new ServiceFactory(
            address(subs),
            address(identityRegistry),
            address(serviceDeployer)
        );
        console.log("ServiceFactory:", address(serviceFactory));

        // ── 6. Wire up ────────────────────────────────────────────────────────
        identityRegistry.setRegistrar(address(serviceFactory), true);
        subs.setFactory(address(serviceFactory));
        console.log("Registrar + factory wired.");

        // ── 7. Optional SIPService (uncomment when aggregator is deployed) ────
        // uint256 sipAgentId = identityRegistry.register("https://example.com/.well-known/agent.json");
        // address[] memory dcaOutputTokens = new address[](2);
        // dcaOutputTokens[0] = address(mockWETH);
        // dcaOutputTokens[1] = address(mockWBTC);
        // SIPService sipService = new SIPService(
        //     deployer,
        //     address(subs),
        //     deployer,
        //     address(mockUSDC),
        //     MIN_AMOUNT_PER_CYCLE,
        //     DEFAULT_INTERVAL,
        //     sipAgentId,
        //     MAX_FEE_BPS,
        //     address(aggregator),
        //     dcaOutputTokens,
        //     0
        // );
        // subs.registerService(address(sipService));
        // console.log("SIPService:", address(sipService));

        // ── 8. Mint test USDC so the deployer can create a subscription ───────
        mockUsdc.mint(deployer, 10_000e6); // 10,000 test USDC
        console.log("Minted 10,000 mUSDC to deployer");

        vm.stopBroadcast();

        // ── 9. Save addresses ─────────────────────────────────────────────────
        string memory json = "testnet";
        vm.serializeAddress(json, "permit2",              PERMIT2);
        vm.serializeAddress(json, "mockUSDC",             address(mockUsdc));
        vm.serializeAddress(json, "mockWETH",             address(mockWeth));
        vm.serializeAddress(json, "mockWBTC",             address(mockWbtc));
        vm.serializeAddress(json, "identityRegistry",     address(identityRegistry));
        vm.serializeAddress(json, "validationRegistry",     address(validationRegistry));
        vm.serializeAddress(json, "subscriptions",        address(subs));
        string memory out =
        vm.serializeAddress(json, "serviceFactory",       address(serviceFactory));

        vm.writeJson(out, "./deployments/arbitrum-sepolia.json");
        console.log("Addresses saved to ./deployments/arbitrum-sepolia.json");
    }
}