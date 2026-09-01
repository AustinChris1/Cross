// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface ICrossSweep {
    function sweepMarketKey(uint256 marketKey, uint256 max) external;

    function pendingOn(uint256 marketKey) external view returns (uint256);
}

/// @title CrossReactor - settles matches in the block their market finalizes
/// @notice Subscribes to BinarySettlement.MarketFinalized through Somnia's reactivity
///         precompile, so payout needs no keeper, no cron, and no user click.
/// @dev Additive. Cross.settle stays permissionless, so a reactor that is unfunded,
///      unsubscribed, or out of gas costs correctness nothing.
contract CrossReactor {
    address public constant PRECOMPILE = address(0x0100);
    uint256 public constant OWNER_MIN_BALANCE = 32 ether;
    uint64 public constant DEFAULT_GAS_LIMIT = 10_000_000;
    // BinarySettlement.MarketFinalized(uint256,address,uint64,address,uint256,bool,uint8)
    bytes32 public constant MARKET_FINALIZED_TOPIC =
        0xaa0d535f55946d4080e0c3a62bb1c53e2596353e9ab633fca0ce625fa518edc1;

    struct SubscriptionData {
        bytes32[4] eventTopics;
        address origin;
        address caller;
        address emitter;
        address handlerContractAddress;
        bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas;
        uint64 maxFeePerGas;
        uint64 gasLimit;
        bool isGuaranteed;
        bool isCoalesced;
    }

    ICrossSweep public immutable cross;
    address public immutable settlementEmitter;
    address public owner;
    uint256 public subscriptionId;
    uint256 public maxPerSweep = 20;

    event Subscribed(uint256 subscriptionId);
    event Unsubscribed(uint256 subscriptionId);
    event Reacted(uint256 indexed marketKey, uint256 pending);
    event SweepFailed(uint256 indexed marketKey);

    error NotOwner();
    error OnlyPrecompile();
    error SubscribeFailed();
    error UnsubscribeFailed();
    error NeedsBalance(uint256 have, uint256 need);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address cross_, address settlementEmitter_) payable {
        cross = ICrossSweep(cross_);
        settlementEmitter = settlementEmitter_;
        owner = msg.sender;
    }

    receive() external payable {}

    /// @notice Open the live subscription. Needs 32 STT held by this contract at call time.
    function subscribe(uint64 gasLimit) external onlyOwner returns (uint256 id) {
        if (address(this).balance < OWNER_MIN_BALANCE) {
            revert NeedsBalance(address(this).balance, OWNER_MIN_BALANCE);
        }
        SubscriptionData memory d = SubscriptionData({
            eventTopics: [MARKET_FINALIZED_TOPIC, bytes32(0), bytes32(0), bytes32(0)],
            origin: address(0),
            caller: address(0),
            emitter: settlementEmitter,
            handlerContractAddress: address(this),
            handlerFunctionSelector: this.onEvent.selector,
            priorityFeePerGas: 0,
            maxFeePerGas: 0,
            gasLimit: gasLimit == 0 ? DEFAULT_GAS_LIMIT : gasLimit,
            isGuaranteed: false,
            isCoalesced: false
        });
        (bool ok, bytes memory ret) = PRECOMPILE.call(abi.encodeWithSignature(
            "subscribe((bytes32[4],address,address,address,address,bytes4,uint64,uint64,uint64,bool,bool))",
            d
        ));
        if (!ok || ret.length < 32) revert SubscribeFailed();
        id = abi.decode(ret, (uint256));
        subscriptionId = id;
        emit Subscribed(id);
    }

    function unsubscribe() external onlyOwner {
        (bool ok, ) = PRECOMPILE.call(abi.encodeWithSignature("unsubscribe(uint256)", subscriptionId));
        if (!ok) revert UnsubscribeFailed();
        emit Unsubscribed(subscriptionId);
        subscriptionId = 0;
    }

    /// @notice Reactivity entrypoint. topics[1] is the finalized market key.
    function onEvent(address, bytes32[] calldata eventTopics, bytes calldata) external {
        if (msg.sender != PRECOMPILE) revert OnlyPrecompile();
        if (eventTopics.length < 2) return;
        uint256 marketKey = uint256(eventTopics[1]);
        uint256 pending = cross.pendingOn(marketKey);
        if (pending == 0) return;
        // A revert here would burn the subscription's gas for nothing; Cross.settle remains open.
        try cross.sweepMarketKey(marketKey, maxPerSweep) {
            emit Reacted(marketKey, pending);
        } catch {
            emit SweepFailed(marketKey);
        }
    }

    function setMaxPerSweep(uint256 n) external onlyOwner {
        maxPerSweep = n;
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
    }
}
