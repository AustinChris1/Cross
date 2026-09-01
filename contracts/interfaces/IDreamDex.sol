// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Signatures mirror @somnia-chain/markets-sdk 0.29.0 exactly: moduleAbi.ts, readsAbi.ts, tradeAbi.ts.

interface IBinaryMarketsModule {
    function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount) external;

    function mintCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount) external;

    function finalizeMarket(bytes32 marketId) external;

    function markets(bytes32 marketId)
        external
        view
        returns (
            uint256 oracleQuestionId,
            uint8 outcomeSlotCount,
            uint8 voidPolicy,
            address collateral,
            uint32 originOperatorId,
            bytes32 originVenueId,
            address oracleAdapter,
            address creator,
            address market,
            address pool,
            uint256 yesId,
            uint256 noId,
            uint64 tradingStart,
            uint64 expiry
        );

    function marketNonce(bytes32 marketId) external view returns (uint64);

    function settlement() external view returns (address);
}

interface IBinaryPool {
    // Mints one YES + one NO per unit of collateral, delivering each leg to a different address.
    function mintSet(address yesTo, address noTo, uint256 amount) external;

    function marketNonce() external view returns (uint64);

    function outcomeToken() external view returns (address);

    function collateralToken() external view returns (address);
}

interface IBinaryMarket {
    function status() external view returns (uint8);

    function isResolved() external view returns (bool);

    function isVoided() external view returns (bool);

    function payoutNumerators() external view returns (uint256[] memory);

    function expiry() external view returns (uint64);

    function outcomeToken() external view returns (address);
}

interface IBinarySettlement {
    // One struct, not nine returns: the tuple is dynamic, so a flat decode shifts by a word.
    struct Record {
        address collateralToken;
        uint128 backing;
        bool finalized;
        bool voided;
        uint256 settlementFeeBpsTimes1k;
        address feeRecipient;
        address pool;
        uint64 nonce;
        uint256[] payoutNumerators;
    }

    function getSettlement(uint256 marketKey) external view returns (Record memory);
}

interface IERC6909 {
    function balanceOf(address owner, uint256 id) external view returns (uint256);

    function setOperator(address spender, bool approved) external returns (bool);

    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
}

interface IERC20 {
    function decimals() external view returns (uint8);

    function balanceOf(address account) external view returns (uint256);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
