// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC8004IdentityRegistry} from "../src/ERC8004IdentityRegistry.sol";
import {AgentNotFound, EmptyAgentCardURI} from "../src/ERC8004IdentityRegistry.sol";
import {IERC8004IdentityRegistry} from "../src/interfaces/IERC8004IdentityRegistry.sol";

contract ERC8004IdentityRegistryTest is Test {
    ERC8004IdentityRegistry registry;

    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");

    string constant URI_1 = "https://agent.sip.xyz/.well-known/agent.json";
    string constant URI_2 = "ipfs://Qm000AgentCard";

    function setUp() public {
        registry = new ERC8004IdentityRegistry();
    }

    // ── register ──────────────────────────────────────────────────────────────

    function test_register_firstIdIsOne() public {
        vm.prank(alice);
        uint256 id = registry.register(URI_1);
        assertEq(id, 1);
    }

    function test_register_secondIdIsTwo() public {
        vm.prank(alice);
        registry.register(URI_1);
        vm.prank(bob);
        uint256 id = registry.register(URI_2);
        assertEq(id, 2);
    }

    function test_register_sameCallerGetsDistinctIds() public {
        vm.startPrank(alice);
        uint256 id1 = registry.register(URI_1);
        uint256 id2 = registry.register(URI_2);
        vm.stopPrank();
        assertNotEq(id1, id2);
    }

    function test_register_mintsNFTToCaller() public {
        vm.prank(alice);
        uint256 id = registry.register(URI_1);
        assertEq(registry.ownerOf(id), alice);
    }

    function test_register_storesAgentCardURI() public {
        vm.prank(alice);
        uint256 id = registry.register(URI_1);
        assertEq(registry.agentCardURI(id), URI_1);
    }

    function test_register_emitsAgentRegisteredEvent() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit IERC8004IdentityRegistry.AgentRegistered(1, alice, URI_1);

        vm.prank(alice);
        registry.register(URI_1);
    }

    function test_register_revertOnEmptyURI() public {
        vm.expectRevert(EmptyAgentCardURI.selector);
        vm.prank(alice);
        registry.register("");
    }

    // ── agentCardURI ──────────────────────────────────────────────────────────

    function test_agentCardURI_returnsCorrectURI() public {
        vm.prank(alice);
        uint256 id = registry.register(URI_1);
        assertEq(registry.agentCardURI(id), URI_1);
    }

    function test_agentCardURI_revertForNonExistentAgent() public {
        vm.expectRevert(abi.encodeWithSelector(AgentNotFound.selector, 999));
        registry.agentCardURI(999);
    }

    // ── tokenURI ──────────────────────────────────────────────────────────────

    function test_tokenURI_matchesAgentCardURI() public {
        vm.prank(alice);
        uint256 id = registry.register(URI_1);
        assertEq(registry.tokenURI(id), registry.agentCardURI(id));
    }

    function test_tokenURI_revertForNonExistentToken() public {
        vm.expectRevert(abi.encodeWithSelector(AgentNotFound.selector, 42));
        registry.tokenURI(42);
    }

    // ── ERC-721 transfer mechanics ────────────────────────────────────────────

    function test_transfer_newOwnerIsCorrect() public {
        vm.prank(alice);
        uint256 id = registry.register(URI_1);

        vm.prank(alice);
        registry.transferFrom(alice, bob, id);

        assertEq(registry.ownerOf(id), bob);
    }

    function test_transfer_uriUnchangedAfterTransfer() public {
        vm.prank(alice);
        uint256 id = registry.register(URI_1);

        vm.prank(alice);
        registry.transferFrom(alice, bob, id);

        assertEq(registry.agentCardURI(id), URI_1);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_register_idsAreStrictlyIncreasing(uint8 n) public {
        vm.assume(n > 0 && n < 20);
        uint256 prevId;
        for (uint256 i = 0; i < n; i++) {
            address agent = makeAddr(string(abi.encodePacked("agent", i)));
            vm.prank(agent);
            uint256 id = registry.register(URI_1);
            assertGt(id, prevId);
            prevId = id;
        }
    }
}
