// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20}     from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC8004ValidationRegistry} from "../../src/interfaces/IERC8004ValidationRegistry.sol";
import {IService} from "../../src/interfaces/IService.sol";

// ─── MockERC20 ────────────────────────────────────────────────────────────────
// Plain ERC20 with a permissionless mint so tests can fund any address freely.

contract MockERC20 is ERC20 {
    uint8 private _dec;

    constructor(string memory name, string memory symbol, uint8 dec) ERC20(name, symbol) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) { return _dec; }

    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ─── MockValidationRegistry ───────────────────────────────────────────────────
// Writable trust score store – no access control needed for tests.

contract MockValidationRegistry is IERC8004ValidationRegistry {
    mapping(uint256 => uint256) private _scores;

    function setScore(uint256 agentId, uint256 score) external {
        _scores[agentId] = score;
        emit ScoreUpdated(agentId, msg.sender, score);
    }

    function getScore(uint256 agentId) external view returns (uint256) {
        return _scores[agentId];
    }
}

// ─── MockService ──────────────────────────────────────────────────────────────
// Records every execute() call; optionally configured to revert.

contract MockService is IService {
    struct Call {
        address subscriber;
        address spendToken;
        uint256 amount;
        bytes   params;
    }

    Call[] public calls;
    bool   public shouldRevert;
    string public revertMsg;

    function setShouldRevert(bool _revert, string calldata _msg) external {
        shouldRevert = _revert;
        revertMsg    = _msg;
    }

    function userRegistered(
        address /* subscriber */,
        address /* spendToken */,
        uint256 /* amount */,
        uint256 /* interval */,
        bytes calldata /* params */
    ) external view returns (bool) {
        if (shouldRevert) revert(revertMsg);
        return true;
    }

    Call[] public registrations;

    function registrationCount() external view returns (uint256) { return registrations.length; }

    function execute(
        address subscriber,
        address spendToken,
        uint256 amount,
        bytes calldata params
    ) external returns (bool) {
        if (shouldRevert) revert(revertMsg);
        calls.push(Call({
            subscriber: subscriber,
            spendToken:   spendToken,
            amount:       amount,
            params:       params
        }));
        return true;
    }

    function callCount() external view returns (uint256) { return calls.length; }
}

// ─── MockAggregator ───────────────────────────────────────────────────────────
// Simulates a DEX aggregator:
//   1. Pulls spend tokens from caller (using the approval SIPService set).
//   2. Mints output tokens to caller (SIPService), simulating the swap output.
// Configured before each test with the relevant addresses and amounts.

contract MockAggregator {
    using SafeERC20 for IERC20;

    address public spendToken;
    address public outputToken;
    uint256 public outputAmount;
    bool    public shouldFail;

    function configure(address _spend, address _output, uint256 _outAmt) external {
        spendToken   = _spend;
        outputToken  = _output;
        outputAmount = _outAmt;
    }

    function setShouldFail(bool _fail) external { shouldFail = _fail; }

    // fallback handles ALL low-level calls including empty calldata.
    // No receive() is defined so that aggregator.call(bytes("")) lands here.
    fallback() external {
        require(!shouldFail, "MockAgg: forced fail");
        uint256 approved = IERC20(spendToken).allowance(msg.sender, address(this));
        if (approved > 0) {
            IERC20(spendToken).safeTransferFrom(msg.sender, address(this), approved);
        }
        MockERC20(outputToken).mint(msg.sender, outputAmount);
    }
}