// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable}  from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Service}   from "./Service.sol";

struct SwapParams {
    address outputToken;
    uint256 minOutputAmount;
    bytes   swapData;
}

/// @title SIPService
/// @notice DCA swap service built on the Service base. Each cycle it receives
///         spendToken from Subscriptions, keeps a protocol fee (held in the
///         contract until withdraw() sweeps it to feeReceiver), swaps the rest
///         via the aggregator and forwards the output token to the subscriber.
///         Unlike the base Service, the configured `amount` is a minimum
///         per-cycle spend — DCA subscribers choose their own amount.
contract SIPService is Service, Pausable {
    using SafeERC20 for IERC20;

    uint256 public immutable MAX_FEE;
    address public aggregator;
    uint256 public fee;
    uint256 public maxFeeAmount;
    mapping(address => bool) public outputTokens;

    event FeeUpdated(uint256 indexed old, uint256 indexed newFee);
    event MaxFeeAmountUpdated(uint256 indexed old, uint256 indexed newMax);
    event AggregatorUpdated(address indexed oldAggregator, address indexed newAggregator);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);
    event SwapExecuted(address indexed subscriber, address indexed spendToken, address indexed outputToken, uint256 amountSpent, uint256 amountReceived, uint256 fee);

    error SlippageExceeded(uint256 received, uint256 minimum);
    error TokenNotWhitelisted(address token);
    error TokenAlreadyWhitelisted(address token);
    error SwapFailed();
    error FeeTooHigh(uint256 given, uint256 max);

    constructor(
        address _agent,
        address _subscriptions,
        address _feeReceiver,
        address _spendToken,
        uint256 _minAmountPerCycle,
        uint32  _interval,
        uint256 _agentId,
        uint256 _maxFee,
        address _aggregator,
        address[] memory _outputTokens,
        uint256 _fee
    ) Service(_agent, _subscriptions, _feeReceiver, _spendToken, _minAmountPerCycle, _interval, _agentId) {
        if (_aggregator == address(0)) revert ZeroAddress();
        if (_fee > _maxFee) revert FeeTooHigh(_fee, _maxFee);
        MAX_FEE    = _maxFee;
        aggregator = _aggregator;
        fee        = _fee;

        for (uint256 i = 0; i < _outputTokens.length; i++) {
            if (_outputTokens[i] == address(0)) revert ZeroAddress();
            outputTokens[_outputTokens[i]] = true;
            emit TokenAdded(_outputTokens[i]);
        }
    }

    function setFee(uint256 _newFee) external onlyOwner {
        if (_newFee > MAX_FEE) revert FeeTooHigh(_newFee, MAX_FEE);
        emit FeeUpdated(fee, _newFee);
        fee = _newFee;
    }

    function setMaxFeeAmount(uint256 _maxFeeAmount) external onlyOwner {
        emit MaxFeeAmountUpdated(maxFeeAmount, _maxFeeAmount);
        maxFeeAmount = _maxFeeAmount;
    }

    function setAggregator(address _newAggregator) external onlyOwner {
        if (_newAggregator == address(0)) revert ZeroAddress();
        emit AggregatorUpdated(aggregator, _newAggregator);
        aggregator = _newAggregator;
    }

    function addToken(address _token) external onlyOwner {
        if (_token == address(0)) revert ZeroAddress();
        if (outputTokens[_token]) revert TokenAlreadyWhitelisted(_token);
        outputTokens[_token] = true;
        emit TokenAdded(_token);
    }

    function removeToken(address _token) external onlyOwner {
        if (!outputTokens[_token]) revert TokenNotWhitelisted(_token);
        outputTokens[_token] = false;
        emit TokenRemoved(_token);
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Subscribe-time validation. Token must match the configured
    ///         spendToken; interval must match; the per-cycle amount only has
    ///         to meet the configured minimum, since DCA subscribers pick their own size.
    function userRegistered(
        address        /* subscriber */,
        address        _spendToken,
        uint256        _amount,
        uint256        _interval,
        bytes calldata /* params */
    ) external view override onlySubscriptions returns (bool) {
        if (_spendToken != spendToken) revert TokenMismatch(spendToken, _spendToken);
        if (_amount < amount)          revert AmountMismatch(amount, _amount);
        if (_interval != interval)     revert IntervalMismatch(interval, _interval);
        return true;
    }

    function execute(
        address        subscriber,
        address        _spendToken,
        uint256        _amount,
        bytes calldata params
    ) external override onlySubscriptions nonReentrant whenNotPaused returns (bool) {
        if (_amount == 0) revert ZeroAmount();

        SwapParams memory p = abi.decode(params, (SwapParams));
        if (!outputTokens[p.outputToken]) revert TokenNotWhitelisted(p.outputToken);
        if (p.minOutputAmount == 0) revert ZeroAmount();

        // Protocol fee stays in the contract; withdraw() sweeps it to feeReceiver.
        uint256 feeAmount = _amount * fee / 10_000;
        if (maxFeeAmount > 0 && feeAmount > maxFeeAmount) {
            feeAmount = maxFeeAmount;
        }
        uint256 swapAmount = _amount - feeAmount;
        totalEarned += feeAmount;

        uint256 balanceBefore = IERC20(p.outputToken).balanceOf(address(this));

        IERC20(_spendToken).forceApprove(aggregator, swapAmount);
        (bool success, ) = aggregator.call(p.swapData);
        if (!success) revert SwapFailed();
        IERC20(_spendToken).forceApprove(aggregator, 0);

        uint256 received = IERC20(p.outputToken).balanceOf(address(this)) - balanceBefore;
        if (received < p.minOutputAmount) revert SlippageExceeded(received, p.minOutputAmount);

        emit SwapExecuted(subscriber, _spendToken, p.outputToken, _amount, received, feeAmount);

        IERC20(p.outputToken).safeTransfer(subscriber, received);

        return true;
    }
}