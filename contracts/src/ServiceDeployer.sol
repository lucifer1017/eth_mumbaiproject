// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Service}    from "./Service.sol";
import {SIPService} from "./SIPService.sol";

/// @title ServiceDeployer
/// @notice Deploys Service and SIPService instances on behalf of
///         ServiceFactory. Kept as a separate contract so the deployed
///         contracts' creation bytecode isn't embedded in ServiceFactory,
///         which would exceed the 24KB EIP-170 contract size limit.
contract ServiceDeployer {
    function deployService(
        address agent,
        address subscriptions,
        address feeReceiver,
        address spendToken,
        uint256 amount,
        uint32  interval,
        uint256 agentId
    ) external returns (address) {
        return address(new Service(
            agent,
            subscriptions,
            feeReceiver,
            spendToken,
            amount,
            interval,
            agentId
        ));
    }

    function deploySIPService(
        address agent,
        address subscriptions,
        address feeReceiver,
        address spendToken,
        uint256 minAmountPerCycle,
        uint32  interval,
        uint256 agentId,
        uint256 maxFee,
        address aggregator,
        address[] calldata outputTokens,
        uint256 fee
    ) external returns (address) {
        return address(new SIPService(
            agent,
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
        ));
    }
}
