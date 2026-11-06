// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SIPService, SwapParams} from "../src/SIPService.sol";
import {
    ZeroAddress,
    ZeroAmount,
    NotSubscriptions,
    TokenNotWhitelisted,
    TokenAlreadyWhitelisted,
    SlippageExceeded,
    SwapFailed,
    FeeTooHigh
} from "../src/SIPService.sol";
import {MockERC20, MockAggregator} from "./mocks/Mocks.sol";

contract SIPServiceTest is Test {
    uint256 constant MAX_FEE_BPS = 1_000; // 10%

    // ── actors ────────────────────────────────────────────────────────────────
    address owner        = makeAddr("owner");
    address subscriptions = makeAddr("subscriptions");
    address treasury     = makeAddr("treasury");
    address subscriber   = makeAddr("subscriber");
    address attacker     = makeAddr("attacker");

    // ── contracts ─────────────────────────────────────────────────────────────
    SIPService     sipService;
    MockERC20      spendToken;
    MockERC20      outputToken;
    MockAggregator aggregator;

    // ── setUp ─────────────────────────────────────────────────────────────────

    function setUp() public {
        spendToken  = new MockERC20("USD Coin", "USDC", 6);
        outputToken = new MockERC20("Wrapped Ether", "WETH", 18);
        aggregator  = new MockAggregator();

        vm.prank(owner);
        sipService = new SIPService(subscriptions, treasury, address(aggregator), MAX_FEE_BPS);

        // Whitelist our test output token
        vm.prank(owner);
        sipService.addToken(address(outputToken));

        // Configure the aggregator for a 1:1 swap by default
        aggregator.configure(address(spendToken), address(outputToken), 100e18);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _buildParams(address out, uint256 minOut) internal pure returns (bytes memory) {
        return abi.encode(SwapParams({
            outputToken:     out,
            minOutputAmount: minOut,
            swapData:        bytes("")
        }));
    }

    // Give SIPService some spend tokens and configure aggregator, then call execute
    function _execute(uint256 amount, uint256 minOut) internal returns (bool) {
        spendToken.mint(address(sipService), amount);
        vm.prank(subscriptions);
        return sipService.execute(subscriber, address(spendToken), amount, _buildParams(address(outputToken), minOut));
    }

    // ── constructor ───────────────────────────────────────────────────────────

    function test_constructor_setsSubscriptions() public view {
        assertEq(sipService.subscriptions(), subscriptions);
    }

    function test_constructor_setsTreasury() public view {
        assertEq(sipService.treasury(), treasury);
    }

    function test_constructor_setsAggregator() public view {
        assertEq(sipService.aggregator(), address(aggregator));
    }

    function test_constructor_setsMaxFeeBps() public view {
        assertEq(sipService.MAX_FEE_BPS(), MAX_FEE_BPS);
    }

    function test_constructor_startsWithEmptyWhitelist() public {
        // whitelist is empty at deploy — tokens are added explicitly via addToken()
        address randomToken = makeAddr("randomToken");
        assertFalse(sipService.outputTokens(randomToken));
    }

    function test_constructor_revertOnZeroSubscriptions() public {
        vm.expectRevert(ZeroAddress.selector);
        new SIPService(address(0), treasury, address(aggregator), MAX_FEE_BPS);
    }

    function test_constructor_revertOnZeroTreasury() public {
        vm.expectRevert(ZeroAddress.selector);
        new SIPService(subscriptions, address(0), address(aggregator), MAX_FEE_BPS);
    }

    function test_constructor_revertOnZeroAggregator() public {
        vm.expectRevert(ZeroAddress.selector);
        new SIPService(subscriptions, treasury, address(0), MAX_FEE_BPS);
    }

    // ── execute: happy path ───────────────────────────────────────────────────

    function test_execute_returnsTrue() public {
        bool ok = _execute(100e6, 1);
        assertTrue(ok);
    }

    function test_execute_sendsOutputToSubscriber() public {
        aggregator.configure(address(spendToken), address(outputToken), 95e18);
        _execute(100e6, 1);
        assertEq(outputToken.balanceOf(subscriber), 95e18);
    }

    function test_execute_drainsSipServiceSpendBalance() public {
        _execute(100e6, 1);
        assertEq(spendToken.balanceOf(address(sipService)), 0);
    }

    function test_execute_emitsSwapExecutedEvent() public {
        aggregator.configure(address(spendToken), address(outputToken), 98e18);
        spendToken.mint(address(sipService), 100e6);

        vm.expectEmit(true, true, false, false, address(sipService));
        emit SIPService.SwapExecuted(subscriber, address(outputToken), 100e6, 98e18, 0);

        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(address(outputToken), 1));
    }

    // ── execute: fee ──────────────────────────────────────────────────────────

    function test_execute_zeroFeeByDefault() public {
        _execute(100e6, 1);
        assertEq(spendToken.balanceOf(treasury), 0);
    }

    function test_execute_chargesFeeToTreasury() public {
        // 100 bps = 1% fee
        vm.prank(owner);
        sipService.setFee(100);

        // 100 USDC input → 1 USDC fee → 99 USDC to swap
        // configure aggregator to pull only 99e6
        aggregator.configure(address(spendToken), address(outputToken), 90e18);
        _execute(100e6, 1);

        assertEq(spendToken.balanceOf(treasury), 1e6);
    }

    function test_execute_swapsOnlyAmountMinusFee() public {
        vm.prank(owner);
        sipService.setFee(100); // 1%

        aggregator.configure(address(spendToken), address(outputToken), 90e18);
        spendToken.mint(address(sipService), 100e6);

        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(address(outputToken), 1));

        // Aggregator should have received exactly 99 USDC (100 - 1% fee)
        assertEq(spendToken.balanceOf(address(aggregator)), 99e6);
    }

    // ── execute: reverts ──────────────────────────────────────────────────────

    function test_execute_revertIfCallerNotSubscriptions() public {
        vm.expectRevert(NotSubscriptions.selector);
        vm.prank(attacker);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(address(outputToken), 1));
    }

    function test_execute_revertIfAmountZero() public {
        vm.expectRevert(ZeroAmount.selector);
        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 0, _buildParams(address(outputToken), 1));
    }

    function test_execute_revertIfOutputTokenNotWhitelisted() public {
        address rogue = makeAddr("rogueToken");
        vm.expectRevert(abi.encodeWithSelector(TokenNotWhitelisted.selector, rogue));
        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(rogue, 1));
    }

    function test_execute_revertIfMinOutputAmountZero() public {
        vm.expectRevert(ZeroAmount.selector);
        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(address(outputToken), 0));
    }

    function test_execute_revertIfAggregatorFails() public {
        aggregator.setShouldFail(true);
        spendToken.mint(address(sipService), 100e6);

        vm.expectRevert(SwapFailed.selector);
        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(address(outputToken), 1));
    }

    function test_execute_revertIfSlippageExceeded() public {
        aggregator.configure(address(spendToken), address(outputToken), 80e18); // gives 80 WETH
        spendToken.mint(address(sipService), 100e6);

        vm.expectRevert(abi.encodeWithSelector(SlippageExceeded.selector, 80e18, 95e18));
        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(address(outputToken), 95e18));
    }

    function test_execute_revertWhenPaused() public {
        vm.prank(owner);
        sipService.pause();

        vm.expectRevert();
        vm.prank(subscriptions);
        sipService.execute(subscriber, address(spendToken), 100e6, _buildParams(address(outputToken), 1));
    }

    // ── setFee ────────────────────────────────────────────────────────────────

    function test_setFee_updatesFee() public {
        vm.prank(owner);
        sipService.setFee(200);
        assertEq(sipService.feeBps(), 200);
    }

    function test_setFee_emitsEvent() public {
        vm.expectEmit(false, false, false, true, address(sipService));
        emit SIPService.FeeUpdated(0, 200);

        vm.prank(owner);
        sipService.setFee(200);
    }

    function test_setFee_revertIfExceedsMaxFeeBps() public {
        vm.expectRevert(abi.encodeWithSelector(FeeTooHigh.selector, MAX_FEE_BPS + 1, MAX_FEE_BPS));
        vm.prank(owner);
        sipService.setFee(MAX_FEE_BPS + 1);
    }

    function test_setFee_revertIfNotOwner() public {
        vm.expectRevert();
        vm.prank(attacker);
        sipService.setFee(100);
    }

    // ── addToken / removeToken ────────────────────────────────────────────────

    function test_addToken_whitelistsToken() public {
        address newTok = makeAddr("newToken");
        vm.prank(owner);
        sipService.addToken(newTok);
        assertTrue(sipService.outputTokens(newTok));
    }

    function test_addToken_emitsTokenAddedEvent() public {
        address newTok = makeAddr("newToken");
        vm.expectEmit(true, false, false, false, address(sipService));
        emit SIPService.TokenAdded(newTok);

        vm.prank(owner);
        sipService.addToken(newTok);
    }

    function test_addToken_revertIfAlreadyWhitelisted() public {
        vm.expectRevert(abi.encodeWithSelector(TokenAlreadyWhitelisted.selector, address(outputToken)));
        vm.prank(owner);
        sipService.addToken(address(outputToken));
    }

    function test_addToken_revertOnZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner);
        sipService.addToken(address(0));
    }

    function test_removeToken_removesFromWhitelist() public {
        vm.prank(owner);
        sipService.removeToken(address(outputToken));
        assertFalse(sipService.outputTokens(address(outputToken)));
    }

    function test_removeToken_revertIfNotWhitelisted() public {
        address unknown = makeAddr("unknown");
        vm.expectRevert(abi.encodeWithSelector(TokenNotWhitelisted.selector, unknown));
        vm.prank(owner);
        sipService.removeToken(unknown);
    }

    function test_removeToken_revertIfNotOwner() public {
        vm.expectRevert();
        vm.prank(attacker);
        sipService.removeToken(address(outputToken));
    }

    // ── setAggregator ─────────────────────────────────────────────────────────

    function test_setAggregator_updatesAddress() public {
        address newAgg = makeAddr("newAgg");
        vm.prank(owner);
        sipService.setAggregator(newAgg);
        assertEq(sipService.aggregator(), newAgg);
    }

    function test_setAggregator_revertOnZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner);
        sipService.setAggregator(address(0));
    }

    // ── setTreasury ───────────────────────────────────────────────────────────

    function test_setTreasury_updatesAddress() public {
        address newTreasury = makeAddr("newTreasury");
        vm.prank(owner);
        sipService.setTreasury(newTreasury);
        assertEq(sipService.treasury(), newTreasury);
    }

    function test_setTreasury_revertOnZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner);
        sipService.setTreasury(address(0));
    }

    // ── sweep ─────────────────────────────────────────────────────────────────

    function test_sweep_transfersEntireBalance() public {
        spendToken.mint(address(sipService), 50e6);

        vm.prank(owner);
        sipService.sweep(address(spendToken), treasury);

        assertEq(spendToken.balanceOf(treasury),          50e6);
        assertEq(spendToken.balanceOf(address(sipService)), 0);
    }

    function test_sweep_emitsSweptEvent() public {
        spendToken.mint(address(sipService), 50e6);

        vm.expectEmit(true, true, false, true, address(sipService));
        emit SIPService.Swept(address(spendToken), treasury, 50e6);

        vm.prank(owner);
        sipService.sweep(address(spendToken), treasury);
    }

    function test_sweep_revertIfNoBalance() public {
        vm.expectRevert(ZeroAmount.selector);
        vm.prank(owner);
        sipService.sweep(address(spendToken), treasury);
    }

    function test_sweep_revertOnZeroRecipient() public {
        spendToken.mint(address(sipService), 1e6);
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner);
        sipService.sweep(address(spendToken), address(0));
    }

    function test_sweep_revertIfNotOwner() public {
        spendToken.mint(address(sipService), 1e6);
        vm.expectRevert();
        vm.prank(attacker);
        sipService.sweep(address(spendToken), attacker);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_execute_subscriberReceivesFullOutput(uint256 amount, uint256 outAmt) public {
        amount = bound(amount, 1, 1_000_000e6);
        outAmt = bound(outAmt, 1, 1_000e18);

        aggregator.configure(address(spendToken), address(outputToken), outAmt);
        _execute(amount, 1);

        assertEq(outputToken.balanceOf(subscriber), outAmt);
    }

    function testFuzz_setFee_validRange(uint256 bps) public {
        bps = bound(bps, 0, MAX_FEE_BPS);
        vm.prank(owner);
        sipService.setFee(bps);
        assertEq(sipService.feeBps(), bps);
    }
}
