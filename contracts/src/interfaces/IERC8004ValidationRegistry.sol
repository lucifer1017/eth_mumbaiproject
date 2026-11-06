// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC8004ValidationRegistry {
    /// @notice Emitted when a validator posts a new score for an agent.
    event ScoreUpdated(uint256 indexed agentId, address indexed validator, uint256 score);

    /// @notice Emitted when a validator is granted or revoked.
    event ValidatorAuthorized(address indexed validator, bool enabled);

    /// @notice Post or update the trust score for an agent. Only callable by authorised validators.
    /// @param agentId ERC-8004 identity token ID.
    /// @param score   Trust score in [0, 100].
    function setScore(uint256 agentId, uint256 score) external;

    /// @notice Returns the current trust score for an agent (0 if not yet scored).
    function getScore(uint256 agentId) external view returns (uint256);
}
