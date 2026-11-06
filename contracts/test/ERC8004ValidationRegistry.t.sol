// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC8004ValidationRegistry} from "../src/ERC8004ValidationRegistry.sol";
import {NotValidator, ScoreOutOfRange} from "../src/ERC8004ValidationRegistry.sol";
import {IERC8004ValidationRegistry} from "../src/interfaces/IERC8004ValidationRegistry.sol";

contract ERC8004ValidationRegistryTest is Test {
    ERC8004ValidationRegistry registry;

    address owner     = makeAddr("owner");
    address validator = makeAddr("validator");
    address stranger  = makeAddr("stranger");

    function setUp() public {
        vm.prank(owner);
        registry = new ERC8004ValidationRegistry(validator);
    }

    // ── constructor ───────────────────────────────────────────────────────────

    function test_constructor_setsInitialValidator() public view {
        assertTrue(registry.validators(validator));
    }

    function test_constructor_ownerIsDeployer() public view {
        assertEq(registry.owner(), owner);
    }

    function test_constructor_agentScoreDefaultsToZero() public view {
        assertEq(registry.getScore(1), 0);
    }

    // ── setScore ──────────────────────────────────────────────────────────────

    function test_setScore_storesScore() public {
        vm.prank(validator);
        registry.setScore(1, 80);
        assertEq(registry.getScore(1), 80);
    }

    function test_setScore_allowsBoundaryValues() public {
        vm.startPrank(validator);
        registry.setScore(1, 0);
        assertEq(registry.getScore(1), 0);
        registry.setScore(1, 100);
        assertEq(registry.getScore(1), 100);
        vm.stopPrank();
    }

    function test_setScore_canOverwriteExistingScore() public {
        vm.startPrank(validator);
        registry.setScore(1, 80);
        registry.setScore(1, 30);
        vm.stopPrank();
        assertEq(registry.getScore(1), 30);
    }

    function test_setScore_emitsScoreUpdatedEvent() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit IERC8004ValidationRegistry.ScoreUpdated(1, validator, 75);

        vm.prank(validator);
        registry.setScore(1, 75);
    }

    function test_setScore_revertIfCallerNotValidator() public {
        vm.expectRevert(NotValidator.selector);
        vm.prank(stranger);
        registry.setScore(1, 80);
    }

    function test_setScore_revertIfScoreExceeds100() public {
        vm.expectRevert(abi.encodeWithSelector(ScoreOutOfRange.selector, 101));
        vm.prank(validator);
        registry.setScore(1, 101);
    }

    function test_setScore_differentAgentsHaveIndependentScores() public {
        vm.startPrank(validator);
        registry.setScore(1, 90);
        registry.setScore(2, 45);
        vm.stopPrank();
        assertEq(registry.getScore(1), 90);
        assertEq(registry.getScore(2), 45);
    }

    // ── setValidator ──────────────────────────────────────────────────────────

    function test_setValidator_authorizesNewValidator() public {
        vm.prank(owner);
        registry.setValidator(stranger, true);
        assertTrue(registry.validators(stranger));
    }

    function test_setValidator_revokesExistingValidator() public {
        vm.prank(owner);
        registry.setValidator(validator, false);
        assertFalse(registry.validators(validator));
    }

    function test_setValidator_emitsValidatorAuthorizedEvent() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit IERC8004ValidationRegistry.ValidatorAuthorized(stranger, true);

        vm.prank(owner);
        registry.setValidator(stranger, true);
    }

    function test_setValidator_revertIfCallerNotOwner() public {
        vm.expectRevert();
        vm.prank(stranger);
        registry.setValidator(stranger, true);
    }

    function test_setScore_revokedValidatorCannotSet() public {
        vm.prank(owner);
        registry.setValidator(validator, false);

        vm.expectRevert(NotValidator.selector);
        vm.prank(validator);
        registry.setScore(1, 80);
    }

    function test_setScore_newValidatorCanSet() public {
        vm.prank(owner);
        registry.setValidator(stranger, true);

        vm.prank(stranger);
        registry.setScore(1, 55);
        assertEq(registry.getScore(1), 55);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_setScore_validRange(uint256 agentId, uint256 score) public {
        score = bound(score, 0, 100);
        vm.prank(validator);
        registry.setScore(agentId, score);
        assertEq(registry.getScore(agentId), score);
    }

    function testFuzz_setScore_revertAbove100(uint256 agentId, uint256 score) public {
        score = bound(score, 101, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(ScoreOutOfRange.selector, score));
        vm.prank(validator);
        registry.setScore(agentId, score);
    }
}
