// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable}      from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC8004ValidationRegistry} from "./interfaces/IERC8004ValidationRegistry.sol";

error NotValidator();
error ScoreOutOfRange(uint256 given);
error ZeroAddress();

contract ERC8004ValidationRegistry is IERC8004ValidationRegistry, Ownable2Step {
    uint256 public constant MAX_SCORE = 100;

    mapping(address => bool)    public validators;
    mapping(uint256 => uint256) private _scores;

    modifier onlyValidator() {
        _onlyValidator();
        _;
    }

    function _onlyValidator() internal view {
        if (!validators[msg.sender]) revert NotValidator();
    }

    constructor(address initialValidator) Ownable(msg.sender) {
        if (initialValidator == address(0)) revert ZeroAddress();
        _setValidator(initialValidator, true);
    }

    /// @notice Grant or revoke validator privileges for an address.
    function setValidator(address validator, bool enabled) external onlyOwner {
        if (validator == address(0)) revert ZeroAddress();
        _setValidator(validator, enabled);
    }

    /// @notice Post or update the trust score (0–100) for an agent. Only callable by validators.
    /// @param agentId ERC-8004 identity token ID of the agent.
    /// @param score   Trust score in [0, MAX_SCORE].
    function setScore(uint256 agentId, uint256 score) external onlyValidator {
        if (score > MAX_SCORE) revert ScoreOutOfRange(score);
        _scores[agentId] = score;
        emit ScoreUpdated(agentId, msg.sender, score);
    }

    /// @notice Returns the current trust score for an agent (0 if not yet scored).
    function getScore(uint256 agentId) external view returns (uint256) {
        return _scores[agentId];
    }

    function _setValidator(address validator, bool enabled) internal {
        validators[validator] = enabled;
        emit ValidatorAuthorized(validator, enabled);
    }
}
