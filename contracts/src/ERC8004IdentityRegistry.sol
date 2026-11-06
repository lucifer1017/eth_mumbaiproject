// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721}      from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable}     from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC8004IdentityRegistry} from "./interfaces/IERC8004IdentityRegistry.sol";

error AgentNotFound(uint256 agentId);
error EmptyAgentCardURI();
error UnauthorizedRegistrar();
error ZeroAddress();

contract ERC8004IdentityRegistry is IERC8004IdentityRegistry, ERC721, Ownable2Step {
    uint256 private _nextId;

    mapping(uint256 => string) private _agentCardURIs;
    mapping(address => bool)   public registrars;

    constructor() ERC721("ERC8004 Agent Identity", "AGENT") Ownable(msg.sender) {
        _nextId = 1;
    }

    /// @notice Grant or revoke registrar privileges for an address.
    function setRegistrar(address registrar, bool enabled) external onlyOwner {
        if (registrar == address(0)) revert ZeroAddress();
        registrars[registrar] = enabled;
    }

    /// @notice Mint an agent identity NFT. The caller becomes the NFT owner.
    /// @param agentCardURI_ URL pointing to the agent's .well-known/agent.json AgentCard.
    /// @return agentId      Token ID of the newly minted agent NFT.
    function register(string calldata agentCardURI_) external returns (uint256 agentId) {
        return _mintAgent(msg.sender, agentCardURI_);
    }

    /// @notice Mint an agent identity NFT to `agent`. Only an authorized registrar may call.
    function registerFor(address agent, string calldata agentCardURI_)
        external
        returns (uint256 agentId)
    {
        if (!registrars[msg.sender]) revert UnauthorizedRegistrar();
        return _mintAgent(agent, agentCardURI_);
    }

    function _mintAgent(address owner, string calldata agentCardURI_) private returns (uint256 agentId) {
        if (owner == address(0)) revert ZeroAddress();
        if (bytes(agentCardURI_).length == 0) revert EmptyAgentCardURI();

        agentId = _nextId++;
        _safeMint(owner, agentId);
        _agentCardURIs[agentId] = agentCardURI_;

        emit AgentRegistered(agentId, owner, agentCardURI_);
    }

    /// @notice Returns the AgentCard URI for an existing agent NFT.
    function agentCardURI(uint256 agentId) external view returns (string memory) {
        if (_ownerOf(agentId) == address(0)) revert AgentNotFound(agentId);
        return _agentCardURIs[agentId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert AgentNotFound(tokenId);
        return _agentCardURIs[tokenId];
    }
}