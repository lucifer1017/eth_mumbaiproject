// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable}         from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}          from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}       from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IService}        from "./interfaces/IService.sol";

/// @title Service
/// @notice Per-agent service contract deployed by ServiceFactory. The agent
///         (owner) configures the subscription terms (spend token, amount per
///         cycle, interval). Funds received from Subscriptions.execute() are
///         held here until the agent withdraws them to the fee receiver.
contract Service is IService, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable subscriptions;
    uint256 public immutable agentId;

    address public feeReceiver;
    address public spendToken;
    uint256 public amount;
    uint32  public interval;

    uint256 public totalEarned;

    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event TermsUpdated(address indexed spendToken, uint256 amount, uint32 interval);
    event ServiceExecuted(address indexed subscriber, uint256 amount, bytes params);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroInterval();
    error NotSubscriptions();
    error TokenMismatch(address expected, address given);
    error AmountMismatch(uint256 expected, uint256 given);
    error IntervalMismatch(uint32 expected, uint256 given);

    modifier onlySubscriptions() {
        _onlySubscriptions();
        _;
    }

    function _onlySubscriptions() internal view {
        if (msg.sender != subscriptions) revert NotSubscriptions();
    }

    constructor(
        address agent,
        address _subscriptions,
        address _feeReceiver,
        address _spendToken,
        uint256 _amount,
        uint32  _interval,
        uint256 _agentId
    ) Ownable(agent) {
        if (_subscriptions == address(0)) revert ZeroAddress();
        if (_feeReceiver   == address(0)) revert ZeroAddress();
        if (_spendToken    == address(0)) revert ZeroAddress();
        if (_amount        == 0)          revert ZeroAmount();
        if (_interval      == 0)          revert ZeroInterval();

        subscriptions = _subscriptions;
        feeReceiver   = _feeReceiver;
        spendToken    = _spendToken;
        amount        = _amount;
        interval      = _interval;
        agentId       = _agentId;
    }

    /// @notice Update where withdrawn funds are sent.
    function setFeeReceiver(address _newReceiver) external onlyOwner {
        if (_newReceiver == address(0)) revert ZeroAddress();
        emit FeeReceiverUpdated(feeReceiver, _newReceiver);
        feeReceiver = _newReceiver;
    }

    /// @notice Update the subscription terms enforced at subscribe time.
    ///         Existing subscriptions are unaffected; only new userRegistered()
    ///         calls validate against the updated terms.
    function setTerms(address _spendToken, uint256 _amount, uint32 _interval) external onlyOwner {
        if (_spendToken == address(0)) revert ZeroAddress();
        if (_amount     == 0)          revert ZeroAmount();
        if (_interval   == 0)          revert ZeroInterval();
        spendToken = _spendToken;
        amount     = _amount;
        interval   = _interval;
        emit TermsUpdated(_spendToken, _amount, _interval);
    }

    /// @notice Called by Subscriptions.subscribe() to validate a new
    ///         subscription against the configured terms.
    function userRegistered(
        address        /*subscriber*/,
        address        _spendToken,
        uint256        _amount,
        uint256        _interval,
        bytes calldata /*params*/
    ) external virtual onlySubscriptions returns (bool) {
        if (_spendToken != spendToken) revert TokenMismatch(spendToken, _spendToken);
        if (_amount     != amount)     revert AmountMismatch(amount, _amount);
        if (_interval   != interval)   revert IntervalMismatch(interval, _interval);
        return true;
    }

    /// @notice Called by Subscriptions.execute() after funds for one cycle
    ///         have been transferred to this contract via Permit2.
    function execute(
        address        subscriber,
        address        /* _spendToken */,
        uint256        _amount,
        bytes calldata params
    ) external virtual onlySubscriptions nonReentrant returns (bool) {
        totalEarned += _amount;
        emit ServiceExecuted(subscriber, _amount, params);
        return true;
    }

    /// @notice Withdraw the full balance of a token to the fee receiver.
    function withdraw(address token) external onlyOwner nonReentrant {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(feeReceiver, balance);
        emit Withdrawn(token, feeReceiver, balance);
    }
}