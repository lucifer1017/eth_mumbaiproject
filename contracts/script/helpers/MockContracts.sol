// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20}     from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20}    from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ── TestERC20 ─────────────────────────────────────────────────────────────────
// Mintable ERC20 for testnet. Lets anyone mint so the deploy script and agent
// can fund wallets without a faucet.

contract TestERC20 is ERC20 {
    uint8 private _dec;

    constructor(string memory name_, string memory symbol_, uint8 dec_)
        ERC20(name_, symbol_)
    {
        _dec = dec_;
    }

    function decimals() public view override returns (uint8) { return _dec; }

    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ── TestAggregator ────────────────────────────────────────────────────────────
// Minimal swap simulator for testnet.
//
// SIPService calls it like:
//   IERC20(spendToken).forceApprove(aggregator, swapAmount);
//   aggregator.call(swapData);   // swapData = abi.encodeCall(TestAggregator.swap, ...)
//
// The agent backend encodes swapData as:
//   abi.encodeCall(TestAggregator.swap, (spendToken, swapAmount, outputToken, outputAmount))
//
// This contract pulls spend tokens (using the approval SIPService set) and
// mints output tokens back to SIPService, which then forwards them to the subscriber.

contract TestAggregator {
    using SafeERC20 for IERC20;

    function swap(
        address spendToken,
        uint256 spendAmount,
        address outputToken,
        uint256 outputAmount
    ) external {
        // Pull spend tokens from SIPService using the approval it set
        IERC20(spendToken).safeTransferFrom(msg.sender, address(this), spendAmount);
        // Mint output tokens directly to SIPService (TestERC20 has open mint)
        TestERC20(outputToken).mint(msg.sender, outputAmount);
    }
}
