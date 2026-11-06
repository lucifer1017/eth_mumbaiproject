// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Subscriptions, Subscription} from "../src/Subscriptions.sol";
import {
    NotExecutor,
    AgentTrustTooLow,
    AgentNotMapped,
    ServiceNotRegistered,
    ServiceAlreadyRegistered,
    PermitAmountTooLow,
    PermitExpired,
    PermitSpenderMismatch,
    PermitTokenMismatch,
    SubscriptionNotActive,
    NotSubscriber,
    TooEarly,
    InsufficientSubscriptionAmount,
    ZeroAmount,
    ZeroInterval,
    ZeroAddress,
    AmountOverflow,
    IntervalOverflow,
    SubscriptionCreated,
    SubscriptionCancelled,
    Executed,
    ExecutorSet,
    MinTrustScoreUpdated
} from "../src/Subscriptions.sol";
import {IPermit2}   from "../src/interfaces/IPermit2.sol";
import {MockValidationRegistry, MockERC20, MockService} from "./mocks/Mocks.sol";

contract SubscriptionsTest is Test {
    // ── constants ─────────────────────────────────────────────────────────────
    // permit2 is injected at deploy — use a dedicated mock address in tests so
    // we are not locked to the canonical mainnet/testnet address.
    address permit2Addr = makeAddr("permit2");

    uint256 constant AGENT_ID  = 1;
    uint256 constant MIN_SCORE = 50;
    uint256 constant AMOUNT    = 100e6;   // 100 USDC
    uint256 constant INTERVAL  = 7 days;

    // ── actors ────────────────────────────────────────────────────────────────
    address owner   = makeAddr("owner");
    address agent   = makeAddr("agent");
    address user    = makeAddr("user");
    address attacker = makeAddr("attacker");

    // ── contracts ─────────────────────────────────────────────────────────────
    MockValidationRegistry validationRegistry;
    Subscriptions          subs;
    MockERC20              usdc;
    MockService            service;

    // ── helpers ───────────────────────────────────────────────────────────────

    function _makePermit(
        address token,
        uint160 amount,
        uint48  expiration,
        address spender
    ) internal view returns (IPermit2.PermitSingle memory) {
        return IPermit2.PermitSingle({
            details: IPermit2.PermitDetails({
                token:      token,
                amount:     amount,
                expiration: expiration,
                nonce:      0
            }),
            spender:     spender,
            sigDeadline: block.timestamp + 1 days
        });
    }

    function _defaultPermit() internal view returns (IPermit2.PermitSingle memory) {
        return _makePermit(
            address(usdc),
            type(uint160).max,
            uint48(block.timestamp + 365 days),
            address(subs)
        );
    }

    function _subId(address subscriber, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encode(subscriber, address(service), address(usdc), nonce));
    }

    function _mockPermit2() internal {
        vm.mockCall(permit2Addr, abi.encodeWithSelector(IPermit2.permit.selector),       abi.encode());
        vm.mockCall(permit2Addr, abi.encodeWithSelector(IPermit2.transferFrom.selector), abi.encode());
    }

    function _createSubscription() internal returns (bytes32 id) {
        _mockPermit2();
        IPermit2.PermitSingle memory p = _defaultPermit();
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, p, bytes("sig"));
        id = _subId(user, 0);
    }

    // ── setUp ─────────────────────────────────────────────────────────────────

    function setUp() public {
        vm.startPrank(owner);

        validationRegistry = new MockValidationRegistry();
        validationRegistry.setScore(AGENT_ID, 80);

        subs = new Subscriptions(
            permit2Addr,
            address(validationRegistry),
            agent,
            AGENT_ID,
            MIN_SCORE
        );

        usdc    = new MockERC20("USD Coin", "USDC", 6);
        service = new MockService();
        subs.registerService(address(service));

        vm.stopPrank();

        usdc.mint(user, 1_000e6);
    }

    // ── constructor ───────────────────────────────────────────────────────────

    function test_constructor_setsValidationRegistry() public view {
        assertEq(address(subs.validationRegistry()), address(validationRegistry));
    }

    function test_constructor_setsExecutorWithAgentId() public view {
        assertTrue(subs.executors(agent));
        assertEq(subs.agentIds(agent), AGENT_ID);
    }

    function test_constructor_setsMinTrustScore() public view {
        assertEq(subs.minAgentTrustScore(), MIN_SCORE);
    }

    function test_constructor_setsPermit2() public view {
        assertEq(address(subs.permit2()), permit2Addr);
    }

    function test_constructor_revertOnZeroPermit2() public {
        vm.expectRevert(ZeroAddress.selector);
        new Subscriptions(address(0), address(validationRegistry), agent, AGENT_ID, MIN_SCORE);
    }

    function test_constructor_revertOnZeroRegistry() public {
        vm.expectRevert(ZeroAddress.selector);
        new Subscriptions(permit2Addr, address(0), agent, AGENT_ID, MIN_SCORE);
    }

    function test_constructor_revertOnZeroExecutor() public {
        vm.expectRevert(ZeroAddress.selector);
        new Subscriptions(permit2Addr, address(validationRegistry), address(0), AGENT_ID, MIN_SCORE);
    }

    function test_constructor_revertOnZeroAgentId() public {
        vm.expectRevert(ZeroAmount.selector);
        new Subscriptions(permit2Addr, address(validationRegistry), agent, 0, MIN_SCORE);
    }

    // ── subscribe ─────────────────────────────────────────────────────────────

    function test_subscribe_storesSubscriptionState() public {
        bytes32 id = _createSubscription();
        Subscription memory sub = subs.getSubscription(id);

        assertEq(sub.subscriber,     user);
        assertEq(sub.service,        address(service));
        assertEq(sub.spendToken,     address(usdc));
        assertEq(sub.amountPerCycle, AMOUNT);
        assertEq(sub.interval,       INTERVAL);
    }

    function test_subscribe_setsPermitExpiry() public {
        uint48 expiry = uint48(block.timestamp + 365 days);
        _mockPermit2();
        IPermit2.PermitSingle memory p = _makePermit(address(usdc), type(uint160).max, expiry, address(subs));

        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, p, bytes("sig"));

        bytes32 id  = _subId(user, 0);
        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.permitExpiry, uint256(expiry));
    }

    function test_subscribe_setsLastExecutionToNow() public {
        bytes32 id = _createSubscription();
        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.lastExecutionTime, block.timestamp);
    }

    function test_subscribe_incrementsNonce() public {
        assertEq(subs.nonces(user), 0);
        _createSubscription();
        assertEq(subs.nonces(user), 1);
    }

    function test_subscribe_emitsSubscriptionCreatedEvent() public {
        _mockPermit2();
        IPermit2.PermitSingle memory p = _defaultPermit();

        bytes32 expectedId = _subId(user, 0);

        vm.expectEmit(true, true, true, false, address(subs));
        emit SubscriptionCreated(
            expectedId,
            user,
            address(service),
            address(usdc),
            uint96(AMOUNT),
            uint32(INTERVAL),
            p.details.expiration
        );

        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, p, bytes("sig"));
    }

    function test_subscribe_revertIfServiceNotRegistered() public {
        _mockPermit2();
        address unknown = makeAddr("unknown");
        vm.expectRevert(abi.encodeWithSelector(ServiceNotRegistered.selector, unknown));
        vm.prank(user);
        subs.subscribe(unknown, address(usdc), AMOUNT, INTERVAL, _defaultPermit(), bytes("sig"));
    }

    function test_subscribe_revertIfAmountZero() public {
        _mockPermit2();
        vm.expectRevert(ZeroAmount.selector);
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), 0, INTERVAL, _defaultPermit(), bytes("sig"));
    }

    function test_subscribe_revertIfIntervalZero() public {
        _mockPermit2();
        vm.expectRevert(ZeroInterval.selector);
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, 0, _defaultPermit(), bytes("sig"));
    }

    function test_subscribe_revertIfPermitTokenMismatch() public {
        _mockPermit2();
        address wrongToken = makeAddr("wrongToken");
        IPermit2.PermitSingle memory p = _makePermit(wrongToken, type(uint160).max, uint48(block.timestamp + 365 days), address(subs));

        vm.expectRevert(abi.encodeWithSelector(PermitTokenMismatch.selector, address(usdc), wrongToken));
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, p, bytes("sig"));
    }

    function test_subscribe_revertIfPermitSpenderMismatch() public {
        _mockPermit2();
        IPermit2.PermitSingle memory p = _makePermit(address(usdc), type(uint160).max, uint48(block.timestamp + 365 days), attacker);

        vm.expectRevert(abi.encodeWithSelector(PermitSpenderMismatch.selector, address(subs), attacker));
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, p, bytes("sig"));
    }

    function test_subscribe_revertIfPermitExpired() public {
        _mockPermit2();
        uint48 past = uint48(block.timestamp - 1);
        IPermit2.PermitSingle memory p = _makePermit(address(usdc), type(uint160).max, past, address(subs));

        vm.expectRevert(abi.encodeWithSelector(PermitExpired.selector, past));
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, p, bytes("sig"));
    }

    function test_subscribe_revertIfPermitAmountTooLow() public {
        _mockPermit2();
        // 30-day expiry / 7-day interval = 4 executions; need 400 USDC but only approving 300
        uint48 expiry = uint48(block.timestamp + 30 days);
        IPermit2.PermitSingle memory p = _makePermit(address(usdc), 300e6, expiry, address(subs));

        vm.expectRevert();
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, p, bytes("sig"));
    }

    function test_subscribe_revertWhenPaused() public {
        vm.prank(owner);
        subs.pause();

        _mockPermit2();
        vm.expectRevert();
        vm.prank(user);
        subs.subscribe(address(service), address(usdc), AMOUNT, INTERVAL, _defaultPermit(), bytes("sig"));
    }

    // ── cancel ────────────────────────────────────────────────────────────────

    function test_cancel_setsPermitExpiryToNow() public {
        bytes32 id = _createSubscription();

        vm.prank(user);
        subs.cancel(id);

        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.permitExpiry, block.timestamp);
    }

    function test_cancel_emitsSubscriptionCancelledEvent() public {
        bytes32 id = _createSubscription();

        vm.expectEmit(true, true, false, false, address(subs));
        emit SubscriptionCancelled(id, user);

        vm.prank(user);
        subs.cancel(id);
    }

    function test_cancel_revertIfCallerNotSubscriber() public {
        bytes32 id = _createSubscription();

        vm.expectRevert(abi.encodeWithSelector(NotSubscriber.selector, id));
        vm.prank(attacker);
        subs.cancel(id);
    }

    function test_cancel_revertIfAlreadyCancelled() public {
        bytes32 id = _createSubscription();

        vm.prank(user);
        subs.cancel(id);

        // cancel sets permitExpiry = block.timestamp; the guard uses strict `<`
        // so we must advance time by at least 1 second for the check to trigger
        vm.warp(block.timestamp + 1);

        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        vm.prank(user);
        subs.cancel(id);
    }

    // ── execute ───────────────────────────────────────────────────────────────

    function test_execute_callsServiceExecute() public {
        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL + 1);

        vm.prank(agent);
        subs.execute(id, bytes("params"));

        assertEq(service.callCount(), 1);
    }

    function test_execute_updatesLastExecutionTime() public {
        bytes32 id  = _createSubscription();
        uint256 t1  = block.timestamp + INTERVAL + 1;
        vm.warp(t1);

        vm.prank(agent);
        subs.execute(id, bytes("params"));

        Subscription memory sub = subs.getSubscription(id);
        assertEq(sub.lastExecutionTime, t1);
    }

    function test_execute_emitsExecutedEvent() public {
        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL + 1);

        vm.expectEmit(true, true, true, false, address(subs));
        emit Executed(id, user, address(service), uint96(AMOUNT), uint48(block.timestamp));

        vm.prank(agent);
        subs.execute(id, bytes("params"));
    }

    function test_execute_revertIfCallerNotExecutor() public {
        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL + 1);

        vm.expectRevert(NotExecutor.selector);
        vm.prank(attacker);
        subs.execute(id, bytes("params"));
    }

    function test_execute_revertIfAgentTrustTooLow() public {
        validationRegistry.setScore(AGENT_ID, MIN_SCORE - 1);

        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL + 1);

        vm.expectRevert(
            abi.encodeWithSelector(AgentTrustTooLow.selector, AGENT_ID, MIN_SCORE - 1, MIN_SCORE)
        );
        vm.prank(agent);
        subs.execute(id, bytes("params"));
    }

    function test_execute_revertIfAgentNotMapped() public {
        address rogueExecutor = makeAddr("rogueExecutor");
        vm.prank(owner);
        // setExecutor with agentId=0 then try to execute
        subs.setExecutor(rogueExecutor, 0, true);

        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL + 1);

        vm.expectRevert(abi.encodeWithSelector(AgentNotMapped.selector, rogueExecutor));
        vm.prank(rogueExecutor);
        subs.execute(id, bytes("params"));
    }

    function test_execute_revertIfSubscriptionExpired() public {
        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + 366 days); // past the 365-day permit expiry

        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        vm.prank(agent);
        subs.execute(id, bytes("params"));
    }

    function test_execute_revertIfTooEarly() public {
        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL - 1); // one second short

        vm.expectRevert(abi.encodeWithSelector(TooEarly.selector, id, block.timestamp));
        vm.prank(agent);
        subs.execute(id, bytes("params"));
    }

    function test_execute_revertIfInsufficientBalance() public {
        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL + 1);

        // drain user's balance — pre-compute amount so vm.prank isn't consumed by balanceOf
        uint256 bal = usdc.balanceOf(user);
        vm.prank(user);
        usdc.transfer(attacker, bal);

        vm.expectRevert(
            abi.encodeWithSelector(InsufficientSubscriptionAmount.selector, id, 0, AMOUNT)
        );
        vm.prank(agent);
        subs.execute(id, bytes("params"));
    }

    function test_execute_revertWhenPaused() public {
        bytes32 id = _createSubscription();
        vm.warp(block.timestamp + INTERVAL + 1);

        vm.prank(owner);
        subs.pause();

        vm.expectRevert();
        vm.prank(agent);
        subs.execute(id, bytes("params"));
    }

    function test_execute_allowsSecondExecutionAfterNextInterval() public {
        bytes32 id = _createSubscription();

        vm.warp(block.timestamp + INTERVAL + 1);
        vm.prank(agent);
        subs.execute(id, bytes("params"));

        vm.warp(block.timestamp + INTERVAL + 1);
        vm.prank(agent);
        subs.execute(id, bytes("params"));

        assertEq(service.callCount(), 2);
    }

    function test_execute_cancelledSubscriptionCannotBeExecuted() public {
        bytes32 id = _createSubscription();

        vm.prank(user);
        subs.cancel(id);

        vm.warp(block.timestamp + INTERVAL + 1);

        vm.expectRevert(abi.encodeWithSelector(SubscriptionNotActive.selector, id));
        vm.prank(agent);
        subs.execute(id, bytes("params"));
    }

    // ── setExecutor ───────────────────────────────────────────────────────────

    function test_setExecutor_enablesNewExecutor() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        subs.setExecutor(newAgent, 2, true);

        assertTrue(subs.executors(newAgent));
        assertEq(subs.agentIds(newAgent), 2);
    }

    function test_setExecutor_disablesExistingExecutor() public {
        vm.prank(owner);
        subs.setExecutor(agent, AGENT_ID, false);
        assertFalse(subs.executors(agent));
    }

    function test_setExecutor_revertIfNotOwner() public {
        vm.expectRevert();
        vm.prank(attacker);
        subs.setExecutor(attacker, 99, true);
    }

    function test_setExecutor_revertOnZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        vm.prank(owner);
        subs.setExecutor(address(0), 1, true);
    }

    // ── setMinTrustScore ──────────────────────────────────────────────────────

    function test_setMinTrustScore_updatesValue() public {
        vm.prank(owner);
        subs.setMinTrustScore(75);
        assertEq(subs.minAgentTrustScore(), 75);
    }

    function test_setMinTrustScore_emitsEvent() public {
        vm.expectEmit(false, false, false, true, address(subs));
        emit MinTrustScoreUpdated(MIN_SCORE, 75);

        vm.prank(owner);
        subs.setMinTrustScore(75);
    }

    function test_setMinTrustScore_revertIfNotOwner() public {
        vm.expectRevert();
        vm.prank(attacker);
        subs.setMinTrustScore(0);
    }

    // ── registerService / removeService ──────────────────────────────────────

    function test_registerService_addsToMapping() public {
        address newSvc = makeAddr("newSvc");
        vm.prank(owner);
        subs.registerService(newSvc);
        assertTrue(subs.services(newSvc));
    }

    function test_registerService_revertIfAlreadyRegistered() public {
        vm.expectRevert(abi.encodeWithSelector(ServiceAlreadyRegistered.selector, address(service)));
        vm.prank(owner);
        subs.registerService(address(service));
    }

    function test_removeService_removesFromMapping() public {
        vm.prank(owner);
        subs.removeService(address(service));
        assertFalse(subs.services(address(service)));
    }

    function test_removeService_revertIfNotRegistered() public {
        address unknown = makeAddr("unknown");
        vm.expectRevert(abi.encodeWithSelector(ServiceNotRegistered.selector, unknown));
        vm.prank(owner);
        subs.removeService(unknown);
    }
}
