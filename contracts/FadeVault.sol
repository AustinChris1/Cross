// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "./interfaces/IDreamDex.sol";

interface ICross {
    struct Match {
        bytes32 marketId;
        address maker;
        address taker;
        address pool;
        address market;
        uint128 contracts;
        uint128 makerStake;
        uint256 yesId;
        uint256 noId;
        uint64 poolNonce;
        uint64 expiry;
        uint64 joinDeadline;
        uint32 price;
        uint8 makerSide;
        uint8 state;
        address designated;
    }

    function getMatch(uint256 matchId) external view returns (Match memory);

    function acceptChallenge(uint256 matchId) external;

    function collateral() external view returns (address);

    function PRICE_SCALE() external view returns (uint256);
}

/// @title FadeVault - depositors are the other side of the book
/// @notice Anyone deposits collateral; a quoter fills the unmatched side of Cross challenges
///         within on-chain risk caps. Depositors own the resulting profit and loss pro rata.
contract FadeVault {
    uint256 public constant PRICE_SCALE = 1e6;

    ICross public immutable cross;
    IERC20 public immutable collateral;

    address public owner;
    // Off-chain pricer allowed to trigger fills. It cannot move funds anywhere else.
    mapping(address => bool) public quoter;

    // Total shares outstanding and the vault's accounting of deposits.
    uint256 public totalShares;
    mapping(address => uint256) public sharesOf;

    // Collateral committed to matches that have not settled yet.
    uint256 public committed;

    // Risk caps, all in collateral units except the bps one.
    uint128 public maxStakePerMatch;
    uint128 public maxExposurePerMarket;
    uint16 public maxUtilizationBps;
    // The worst probability the vault will ever pay for a side.
    uint32 public maxPriceAccepted;

    mapping(bytes32 => uint256) public exposureByMarket;
    mapping(uint256 => bool) public filled;

    uint256 private lock = 1;

    event Deposited(address indexed who, uint256 amount, uint256 shares);
    event Withdrawn(address indexed who, uint256 amount, uint256 shares);
    event Faded(uint256 indexed matchId, bytes32 indexed marketId, uint256 stake, uint32 pricePaid);
    event CapsUpdated(uint128 maxStakePerMatch, uint128 maxExposurePerMarket, uint16 maxUtilizationBps, uint32 maxPriceAccepted);
    event QuoterSet(address indexed who, bool allowed);

    error NotOwner();
    error NotQuoter();
    error Reentrancy();
    error BadAmount();
    error AlreadyFilled();
    error MatchNotOpen();
    error PriceTooRich();
    error StakeCap();
    error MarketCap();
    error UtilizationCap();
    error TransferFailed();
    error NothingToWithdraw();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyQuoter() {
        if (!quoter[msg.sender]) revert NotQuoter();
        _;
    }

    modifier nonReentrant() {
        if (lock != 1) revert Reentrancy();
        lock = 2;
        _;
        lock = 1;
    }

    constructor(address cross_) {
        cross = ICross(cross_);
        collateral = IERC20(ICross(cross_).collateral());
        owner = msg.sender;
        quoter[msg.sender] = true;
        maxStakePerMatch = type(uint128).max;
        maxExposurePerMarket = type(uint128).max;
        maxUtilizationBps = 5_000;
        maxPriceAccepted = 950_000;
    }

    // --------------------------------------------------------------- deposits

    /// @notice Total collateral the vault controls: idle balance plus what is live in matches.
    function totalAssets() public view returns (uint256) {
        return collateral.balanceOf(address(this)) + committed;
    }

    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert BadAmount();
        uint256 assetsBefore = totalAssets();
        _pull(msg.sender, amount);
        shares = totalShares == 0 ? amount : (amount * totalShares) / assetsBefore;
        if (shares == 0) revert BadAmount();
        totalShares += shares;
        sharesOf[msg.sender] += shares;
        emit Deposited(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0 || shares > sharesOf[msg.sender]) revert BadAmount();
        amount = (shares * totalAssets()) / totalShares;
        // Only idle collateral is withdrawable; committed stakes are live in matches.
        if (amount > collateral.balanceOf(address(this))) revert NothingToWithdraw();
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        _push(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    function previewWithdraw(uint256 shares) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares * totalAssets()) / totalShares;
    }

    // ------------------------------------------------------------------ fills

    /// @notice Take the unfilled side of a Cross challenge, inside every configured cap.
    function fade(uint256 matchId) external onlyQuoter nonReentrant {
        if (filled[matchId]) revert AlreadyFilled();
        ICross.Match memory m = cross.getMatch(matchId);
        if (m.state != 1) revert MatchNotOpen();

        uint128 stake = m.contracts - m.makerStake;
        // The vault's own price is the complement of the maker's.
        uint32 pricePaid = uint32((uint256(stake) * PRICE_SCALE) / uint256(m.contracts));
        if (pricePaid > maxPriceAccepted) revert PriceTooRich();
        if (stake > maxStakePerMatch) revert StakeCap();

        uint256 nextMarket = exposureByMarket[m.marketId] + stake;
        if (nextMarket > maxExposurePerMarket) revert MarketCap();

        uint256 assets = totalAssets();
        if (assets == 0) revert UtilizationCap();
        if (((committed + stake) * 10_000) / assets > maxUtilizationBps) revert UtilizationCap();

        filled[matchId] = true;
        exposureByMarket[m.marketId] = nextMarket;
        committed += stake;

        collateral.approve(address(cross), stake);
        cross.acceptChallenge(matchId);

        emit Faded(matchId, m.marketId, stake, pricePaid);
    }

    /// @notice Release a settled match from the exposure counters. Permissionless and idempotent.
    function release(uint256 matchId) public {
        if (!filled[matchId]) return;
        ICross.Match memory m = cross.getMatch(matchId);
        // 3 = Settled, 4 = Cancelled.
        if (m.state != 3 && m.state != 4) return;
        uint128 stake = m.contracts - m.makerStake;
        filled[matchId] = false;
        committed = committed > stake ? committed - stake : 0;
        uint256 e = exposureByMarket[m.marketId];
        exposureByMarket[m.marketId] = e > stake ? e - stake : 0;
    }

    function releaseMany(uint256[] calldata matchIds) external {
        for (uint256 i = 0; i < matchIds.length; i++) release(matchIds[i]);
    }

    // ----------------------------------------------------------------- admin

    function setCaps(
        uint128 maxStakePerMatch_,
        uint128 maxExposurePerMarket_,
        uint16 maxUtilizationBps_,
        uint32 maxPriceAccepted_
    ) external onlyOwner {
        if (maxUtilizationBps_ > 10_000 || maxPriceAccepted_ >= PRICE_SCALE) revert BadAmount();
        maxStakePerMatch = maxStakePerMatch_;
        maxExposurePerMarket = maxExposurePerMarket_;
        maxUtilizationBps = maxUtilizationBps_;
        maxPriceAccepted = maxPriceAccepted_;
        emit CapsUpdated(maxStakePerMatch_, maxExposurePerMarket_, maxUtilizationBps_, maxPriceAccepted_);
    }

    function setQuoter(address who, bool allowed) external onlyOwner {
        quoter[who] = allowed;
        emit QuoterSet(who, allowed);
    }

    function transferOwnership(address next) external onlyOwner {
        owner = next;
    }

    // --------------------------------------------------------------- internal

    function _pull(address from, uint256 amount) private {
        (bool ok, bytes memory ret) = address(collateral).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) private {
        (bool ok, bytes memory ret) = address(collateral).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
