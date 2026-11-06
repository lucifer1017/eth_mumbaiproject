// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ServiceDeployer}            from "./ServiceDeployer.sol";
import {Subscriptions}              from "./Subscriptions.sol";
import {IERC8004IdentityRegistry}   from "./interfaces/IERC8004IdentityRegistry.sol";

/// @title ServiceFactory
/// @notice Platform entry point for agent registration. Deploys a dedicated
///         Service or SIPService per subscription agent (based on the
///         creator's choice), mints ERC-8004 identity, and registers the
///         service with Subscriptions.
contract ServiceFactory {
    address public immutable subscriptions;
    IERC8004IdentityRegistry public immutable identityRegistry;
    ServiceDeployer public immutable serviceDeployer;

    mapping(address => address[]) public servicesByAgent;
    mapping(address => bool)      public isFactoryService;
    mapping(uint256 => address)     public serviceByAgentId;
    mapping(address => uint256)     public agentIdByService;
    address[] public allServices;

    event ServiceCreated(
        address indexed agent,
        address indexed service,
        address indexed spendToken,
        uint256 amount,
        address feeReceiver,
        uint256 agentId
    );

    event AgentRegistered(address indexed agent, uint256 indexed agentId);

    error ZeroAddress();

    constructor(address _subscriptions, address _identityRegistry, address _serviceDeployer) {
        if (_subscriptions == address(0))    revert ZeroAddress();
        if (_identityRegistry == address(0)) revert ZeroAddress();
        if (_serviceDeployer == address(0))  revert ZeroAddress();
        subscriptions    = _subscriptions;
        identityRegistry = IERC8004IdentityRegistry(_identityRegistry);
        serviceDeployer  = ServiceDeployer(_serviceDeployer);
    }

    /// @notice Deploy a Service for the caller, mint identity, and register with Subscriptions.
    function createService(
        address feeReceiver,
        address spendToken,
        uint256 amount,
        uint32  interval,
        string calldata agentCardURI
    ) external returns (address service, uint256 agentId) {
        agentId = identityRegistry.registerFor(msg.sender, agentCardURI);

        service = serviceDeployer.deployService(
            msg.sender,
            subscriptions,
            feeReceiver,
            spendToken,
            amount,
            interval,
            agentId
        );

        Subscriptions(subscriptions).registerService(service);

        servicesByAgent[msg.sender].push(service);
        isFactoryService[service] = true;
        allServices.push(service);
        serviceByAgentId[agentId] = service;
        agentIdByService[service] = agentId;

        emit ServiceCreated(msg.sender, service, spendToken, amount, feeReceiver, agentId);
    }

    /// @notice Deploy a SIPService (DCA swap service) for the caller, mint
    ///         identity, and register with Subscriptions. `amount` is the
    ///         minimum per-cycle spend — subscribers pick their own size.
    function createSwapService(
        address feeReceiver,
        address spendToken,
        uint256 minAmountPerCycle,
        uint32  interval,
        string calldata agentCardURI,
        uint256 maxFee,
        address aggregator,
        address[] calldata outputTokens,
        uint256 fee
    ) external returns (address service, uint256 agentId) {
        agentId = identityRegistry.registerFor(msg.sender, agentCardURI);

        service = serviceDeployer.deploySIPService(
            msg.sender,
            subscriptions,
            feeReceiver,
            spendToken,
            minAmountPerCycle,
            interval,
            agentId,
            maxFee,
            aggregator,
            outputTokens,
            fee
        );

        Subscriptions(subscriptions).registerService(service);

        servicesByAgent[msg.sender].push(service);
        isFactoryService[service] = true;
        allServices.push(service);
        serviceByAgentId[agentId] = service;
        agentIdByService[service] = agentId;

        emit ServiceCreated(msg.sender, service, spendToken, minAmountPerCycle, feeReceiver, agentId);
    }

    /// @notice Register a one-time-only agent identity with no Service contract.
    function registerAgent(string calldata agentCardURI) external returns (uint256 agentId) {
        agentId = identityRegistry.registerFor(msg.sender, agentCardURI);
        emit AgentRegistered(msg.sender, agentId);
    }

    function getServicesByAgent(address agent) external view returns (address[] memory) {
        return servicesByAgent[agent];
    }

    function allServicesLength() external view returns (uint256) {
        return allServices.length;
    }
}