// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPermit2 {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48  expiration;
        uint48  nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address       spender;
        uint256       sigDeadline;
    }

    /// @notice Approve the spender to transfer up to amount of token until expiration,
    ///         verified against the EIP-712 signature.
    function permit(
        address               owner,
        PermitSingle calldata permitSingle,
        bytes        calldata signature
    ) external;

    /// @notice Transfer token from `from` to `to` up to the caller's Permit2 allowance.
    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external;
}
