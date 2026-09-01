// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IBinaryMarketsModule, IBinaryPool, IBinaryMarket, IBinarySettlement, IERC6909, IERC20} from "./interfaces/IDreamDex.sol";

interface ICrossSettleHook {
    function onMatchSettled(uint256 matchId) external;
}

/// @title Cross - head-to-head matches on dreamDEX Event Contracts
/// @notice Two opposite-side buyers cross with no seller: the pool mints a fresh Up/Down pair
///         from their combined collateral and Cross holds both legs until the window resolves.
contract Cross {
    // Probability scale, independent of collateral decimals.
    uint256 public constant PRICE_SCALE = 1e6;
    // Markets this close to expiry can lock mid-flight, so they are refused.
    uint64 public constant MIN_HEADROOM = 300;
    // How long after expiry a participant may pull their own leg out instead of waiting on settle.
    uint64 public constant CLAIM_GRACE = 2 hours;
    // Outcome index convention on dreamDEX binaries.
    uint8 public constant UP = 0;
    uint8 public constant DOWN = 1;

    enum State {
        None,
        Open,
        Filled,
        Settled,
        Cancelled
    }

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
        State state;
        address designated;
    }

    IBinaryMarketsModule public immutable module;
    IBinarySettlement public immutable settlement;
    IERC20 public immutable collateral;
    bytes32 public immutable venueId;
    uint32 public immutable operatorId;

    address public owner;
    // Winner-side fee in basis points, charged on the payout. Zero at launch.
    uint16 public feeBps;
    address public feeRecipient;

    uint256 public matchCount;
    mapping(uint256 => Match) public matches;
    // Settlement market key to the matches opened on it, for the reactivity sweep.
    mapping(uint256 => uint256[]) public matchesByMarketKey;
    mapping(uint256 => uint256) public sweepCursor;
    mapping(address => bool) public operatorGranted;

    uint256 private lock = 1;

    event ChallengePosted(
        uint256 indexed matchId,
        bytes32 indexed marketId,
        address indexed maker,
        uint8 makerSide,
        uint128 contracts,
        uint32 price,
        address designated,
        uint64 joinDeadline
    );
    event ChallengeFilled(uint256 indexed matchId, address indexed taker, uint128 takerStake, uint64 poolNonce);
    event ChallengeCancelled(uint256 indexed matchId);
    event MatchSettled(uint256 indexed matchId, address indexed winner, uint256 payout, uint256 fee, bool voided);
    event FeeUpdated(uint16 feeBps, address feeRecipient);
    event LegsClaimed(uint256 indexed matchId, address indexed maker, address indexed taker);

    error NotOwner();
    error Reentrancy();
    error BadState();
    error BadPrice();
    error BadAmount();
    error WrongCollateral();
    error MarketNotTrading();
    error NoHeadroom();
    error PoolRecycled();
    error NotInvited();
    error SelfCross();
    error JoinClosed();
    error NotResolved();
    error TransferFailed();
    error TooEarly();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (lock != 1) revert Reentrancy();
        lock = 2;
        _;
        lock = 1;
    }

    constructor(address module_, address collateral_, bytes32 venueId_, uint32 operatorId_) {
        module = IBinaryMarketsModule(module_);
        settlement = IBinarySettlement(IBinaryMarketsModule(module_).settlement());
        collateral = IERC20(collateral_);
        venueId = venueId_;
        operatorId = operatorId_;
        owner = msg.sender;
        feeRecipient = msg.sender;
    }

    // ---------------------------------------------------------------- posting

    /// @notice Escrow the maker's side of a match. `contracts` is the payout to the winner.
    function postChallenge(
        bytes32 marketId,
        uint8 makerSide,
        uint128 contracts,
        uint32 price,
        address designated,
        uint64 joinDeadline
    ) external nonReentrant returns (uint256 matchId) {
        if (contracts == 0) revert BadAmount();
        if (price == 0 || price >= PRICE_SCALE) revert BadPrice();
        if (makerSide > DOWN) revert BadState();

        (address market, address pool, uint256 yesId, uint256 noId, address coll, uint64 expiry) = _market(marketId);
        if (coll != address(collateral)) revert WrongCollateral();
        _requireTradable(market, expiry);
        if (joinDeadline == 0 || joinDeadline > expiry - MIN_HEADROOM) joinDeadline = expiry - MIN_HEADROOM;

        uint128 makerStake = uint128((uint256(contracts) * price) / PRICE_SCALE);
        if (makerStake == 0 || makerStake >= contracts) revert BadPrice();
        _pull(msg.sender, makerStake);

        matchId = ++matchCount;
        matches[matchId] = Match({
            marketId: marketId,
            maker: msg.sender,
            taker: address(0),
            pool: pool,
            market: market,
            contracts: contracts,
            makerStake: makerStake,
            yesId: yesId,
            noId: noId,
            poolNonce: module.marketNonce(marketId),
            expiry: expiry,
            joinDeadline: joinDeadline,
            price: price,
            makerSide: makerSide,
            state: State.Open,
            designated: designated
        });

        emit ChallengePosted(matchId, marketId, msg.sender, makerSide, contracts, price, designated, joinDeadline);
    }

    /// @notice Take the other side. Mints the Up/Down pair from both stakes in one call.
    function acceptChallenge(uint256 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.state != State.Open) revert BadState();
        if (block.timestamp >= m.joinDeadline) revert JoinClosed();
        if (m.designated != address(0) && msg.sender != m.designated) revert NotInvited();
        if (msg.sender == m.maker) revert SelfCross();

        _requireTradable(m.market, m.expiry);
        // A recycled pool is a different market instance, so the escrow is stale.
        uint64 nonceNow = module.marketNonce(m.marketId);
        if (nonceNow != m.poolNonce) revert PoolRecycled();

        uint128 takerStake = m.contracts - m.makerStake;
        _pull(msg.sender, takerStake);

        // Both legs stay in escrow; side ownership is tracked by the match record.
        collateral.approve(m.pool, uint256(m.contracts));
        IBinaryPool(m.pool).mintSet(address(this), address(this), uint256(m.contracts));

        m.taker = msg.sender;
        m.state = State.Filled;
        matchesByMarketKey[_marketKey(m.yesId)].push(matchId);

        emit ChallengeFilled(matchId, msg.sender, takerStake, nonceNow);
    }

    /// @notice Maker reclaims an unfilled stake once the join window has closed.
    function cancelChallenge(uint256 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.state != State.Open) revert BadState();
        if (msg.sender != m.maker && block.timestamp < m.joinDeadline) revert NotOwner();
        m.state = State.Cancelled;
        _push(m.maker, m.makerStake);
        emit ChallengeCancelled(matchId);
    }

    // -------------------------------------------------------------- settlement

    /// @notice Pay out a resolved match. Permissionless: anyone may settle any match.
    function settle(uint256 matchId) public nonReentrant {
        _settle(matchId);
    }

    function settleMany(uint256[] calldata matchIds) external nonReentrant {
        for (uint256 i = 0; i < matchIds.length; i++) {
            if (matches[matchIds[i]].state == State.Filled) _settle(matchIds[i]);
        }
    }

    /// @notice Settle up to `max` open matches on one market key, resuming from a stored cursor.
    function sweepMarketKey(uint256 marketKey, uint256 max) public nonReentrant {
        uint256[] storage ids = matchesByMarketKey[marketKey];
        uint256 i = sweepCursor[marketKey];
        uint256 end = i + max > ids.length ? ids.length : i + max;
        for (; i < end; i++) {
            if (matches[ids[i]].state == State.Filled) _settle(ids[i]);
        }
        sweepCursor[marketKey] = i;
    }

    function _settle(uint256 matchId) private {
        Match storage m = matches[matchId];
        if (m.state != State.Filled) revert BadState();

        IBinaryMarket mk = IBinaryMarket(m.market);
        bool voided = mk.isVoided();
        if (!voided && !mk.isResolved()) revert NotResolved();

        uint256 key = _marketKey(m.yesId);
        if (!settlement.getSettlement(key).finalized) module.finalizeMarket(m.marketId);

        _grantOperator(mk.outcomeToken());
        m.state = State.Settled;

        if (voided) {
            // Both legs pay 0.5, which returns exactly what each side put in.
            module.redeem(operatorId, venueId, m.marketId, UP, uint256(m.contracts));
            module.redeem(operatorId, venueId, m.marketId, DOWN, uint256(m.contracts));
            _push(m.maker, m.makerStake);
            _push(m.taker, m.contracts - m.makerStake);
            _notify(m.maker, matchId);
            _notify(m.taker, matchId);
            emit MatchSettled(matchId, address(0), 0, 0, true);
            return;
        }

        uint8 winningIdx = _winningOutcome(mk);
        module.redeem(operatorId, venueId, m.marketId, winningIdx, uint256(m.contracts));

        address winner = (winningIdx == m.makerSide) ? m.maker : m.taker;
        uint256 fee = (uint256(m.contracts) * feeBps) / 10_000;
        uint256 payout = uint256(m.contracts) - fee;
        if (fee > 0) _push(feeRecipient, fee);
        _push(winner, payout);
        _notify(m.maker, matchId);
        _notify(m.taker, matchId);

        emit MatchSettled(matchId, winner, payout, fee, false);
    }

    function _winningOutcome(IBinaryMarket mk) private view returns (uint8) {
        uint256[] memory v = mk.payoutNumerators();
        uint8 best = 0;
        for (uint8 i = 1; i < v.length; i++) {
            if (v[i] > v[best]) best = i;
        }
        return best;
    }

    /// @notice Escape hatch. Long after expiry a participant can take their own outcome token and
    ///         redeem it directly on dreamDEX, so a failure inside settle can never strand a match.
    function claimLegs(uint256 matchId) external nonReentrant {
        Match storage m = matches[matchId];
        if (m.state != State.Filled) revert BadState();
        if (msg.sender != m.maker && msg.sender != m.taker) revert NotOwner();
        if (block.timestamp < uint256(m.expiry) + CLAIM_GRACE) revert TooEarly();

        m.state = State.Settled;
        address outcomeToken = IBinaryMarket(m.market).outcomeToken();
        uint256 makerId = m.makerSide == UP ? m.yesId : m.noId;
        uint256 takerId = m.makerSide == UP ? m.noId : m.yesId;
        IERC6909(outcomeToken).transfer(m.maker, makerId, uint256(m.contracts));
        IERC6909(outcomeToken).transfer(m.taker, takerId, uint256(m.contracts));
        emit LegsClaimed(matchId, m.maker, m.taker);
    }

    // ------------------------------------------------------------------ views

    function getMatch(uint256 matchId) external view returns (Match memory) {
        return matches[matchId];
    }

    function marketKeyOf(uint256 matchId) external view returns (uint256) {
        return _marketKey(matches[matchId].yesId);
    }

    function pendingOn(uint256 marketKey) external view returns (uint256) {
        uint256[] storage ids = matchesByMarketKey[marketKey];
        uint256 n;
        for (uint256 i = sweepCursor[marketKey]; i < ids.length; i++) {
            if (matches[ids[i]].state == State.Filled) n++;
        }
        return n;
    }

    function stakes(uint128 contracts, uint32 price) external pure returns (uint128 makerStake, uint128 takerStake) {
        makerStake = uint128((uint256(contracts) * price) / PRICE_SCALE);
        takerStake = contracts - makerStake;
    }

    // ----------------------------------------------------------------- admin

    function setFee(uint16 feeBps_, address feeRecipient_) external onlyOwner {
        // Capped in code so the fee can never be raised into a rug.
        if (feeBps_ > 200) revert BadAmount();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit FeeUpdated(feeBps_, feeRecipient_);
    }

    function transferOwnership(address next) external onlyOwner {
        owner = next;
    }

    // --------------------------------------------------------------- internal

    function _market(bytes32 marketId)
        private
        view
        returns (address market, address pool, uint256 yesId, uint256 noId, address coll, uint64 expiry)
    {
        (, , , address c, , , , , address mk, address p, uint256 y, uint256 n, , uint64 e) = module.markets(marketId);
        if (mk == address(0)) revert BadState();
        return (mk, p, y, n, c, e);
    }

    function _requireTradable(address market, uint64 expiry) private view {
        if (IBinaryMarket(market).status() != 1) revert MarketNotTrading();
        if (expiry <= block.timestamp + MIN_HEADROOM) revert NoHeadroom();
    }

    function _marketKey(uint256 yesId) private pure returns (uint256) {
        return yesId >> 8;
    }

    function _grantOperator(address outcomeToken) private {
        if (operatorGranted[outcomeToken]) return;
        IERC6909(outcomeToken).setOperator(address(module), true);
        operatorGranted[outcomeToken] = true;
    }

    /// A pooled participant needs to know its stake came back; a failure here must not block payout.
    function _notify(address who, uint256 matchId) private {
        if (who.code.length == 0) return;
        try ICrossSettleHook(who).onMatchSettled{gas: 120_000}(matchId) {} catch {}
    }

    function _pull(address from, uint256 amount) private {
        (bool ok, bytes memory ret) = address(collateral).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = address(collateral).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
    }
}
