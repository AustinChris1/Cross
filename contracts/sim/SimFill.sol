// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Simulation harness, never deployed. Its constructor runs a whole match fill against live
// chain state inside one eth_call and returns the observed balances.

import {Cross} from "../Cross.sol";
import {FadeVault} from "../FadeVault.sol";
import {IERC20, IERC6909, IBinaryMarketsModule, IBinaryMarket, IBinarySettlement} from "../interfaces/IDreamDex.sol";

interface ITestUsdc {
    function faucet(uint256 amount) external;
}

contract SimTaker {
    function take(address cross, address collateral, uint256 matchId) external {
        IERC20(collateral).approve(cross, type(uint256).max);
        Cross(cross).acceptChallenge(matchId);
    }
}

contract SimFill {
    struct Result {
        address cross;
        uint256 matchId;
        uint128 makerStake;
        uint128 takerStake;
        uint256 crossYes;
        uint256 crossNo;
        uint256 crossIdle;
        uint8 state;
        uint64 poolNonce;
        uint8 marketStatus;
    }

    constructor(
        address module,
        address collateral,
        bytes32 venueId,
        uint32 operatorId,
        bytes32 marketId,
        uint128 contracts,
        uint32 price
    ) {
        Cross cross = new Cross(module, collateral, venueId, operatorId);
        SimTaker taker = new SimTaker();

        ITestUsdc(collateral).faucet(uint256(contracts) * 4);
        IERC20(collateral).transfer(address(taker), uint256(contracts));
        IERC20(collateral).approve(address(cross), type(uint256).max);

        uint256 matchId = cross.postChallenge(marketId, 0, contracts, price, address(0), 0);
        taker.take(address(cross), collateral, matchId);

        (, , , , , , , , address market, , uint256 yesId, uint256 noId, , ) =
            IBinaryMarketsModule(module).markets(marketId);
        address outcomeToken = IBinaryMarket(market).outcomeToken();

        (uint128 makerStake, uint128 takerStake) = cross.stakes(contracts, price);
        Cross.Match memory m = cross.getMatch(matchId);

        Result memory r = Result({
            cross: address(cross),
            matchId: matchId,
            makerStake: makerStake,
            takerStake: takerStake,
            crossYes: IERC6909(outcomeToken).balanceOf(address(cross), yesId),
            crossNo: IERC6909(outcomeToken).balanceOf(address(cross), noId),
            crossIdle: IERC20(collateral).balanceOf(address(cross)),
            state: uint8(m.state),
            poolNonce: m.poolNonce,
            marketStatus: IBinaryMarket(market).status()
        });

        bytes memory out = abi.encode(r);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}

/// Same flow, but the taker is the FadeVault filling under its caps.
contract SimVaultFill {
    struct Result {
        address cross;
        address vault;
        uint256 matchId;
        uint256 vaultShares;
        uint256 vaultCommitted;
        uint256 vaultTotalAssets;
        uint256 crossYes;
        uint256 crossNo;
        uint8 state;
    }

    constructor(
        address module,
        address collateral,
        bytes32 venueId,
        uint32 operatorId,
        bytes32 marketId,
        uint128 contracts,
        uint32 price,
        uint256 vaultDeposit
    ) {
        Cross cross = new Cross(module, collateral, venueId, operatorId);
        FadeVault vault = new FadeVault(address(cross));

        ITestUsdc(collateral).faucet(vaultDeposit + uint256(contracts) * 4);
        IERC20(collateral).approve(address(vault), type(uint256).max);
        IERC20(collateral).approve(address(cross), type(uint256).max);
        uint256 shares = vault.deposit(vaultDeposit);

        uint256 matchId = cross.postChallenge(marketId, 0, contracts, price, address(0), 0);
        vault.fade(matchId);

        (, , , , , , , , address market, , uint256 yesId, uint256 noId, , ) =
            IBinaryMarketsModule(module).markets(marketId);
        address outcomeToken = IBinaryMarket(market).outcomeToken();
        Cross.Match memory m = cross.getMatch(matchId);

        Result memory r = Result({
            cross: address(cross),
            vault: address(vault),
            matchId: matchId,
            vaultShares: shares,
            vaultCommitted: vault.committed(),
            vaultTotalAssets: vault.totalAssets(),
            crossYes: IERC6909(outcomeToken).balanceOf(address(cross), yesId),
            crossNo: IERC6909(outcomeToken).balanceOf(address(cross), noId),
            state: uint8(m.state)
        });

        bytes memory out = abi.encode(r);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}

/// Proves the settle gate: a filled match on a live window refuses to pay out before resolution.
contract SimSettleGate {
    constructor(
        address module,
        address collateral,
        bytes32 venueId,
        uint32 operatorId,
        bytes32 marketId,
        uint128 contracts,
        uint32 price
    ) {
        Cross cross = new Cross(module, collateral, venueId, operatorId);
        SimTaker taker = new SimTaker();
        ITestUsdc(collateral).faucet(uint256(contracts) * 4);
        IERC20(collateral).transfer(address(taker), uint256(contracts));
        IERC20(collateral).approve(address(cross), type(uint256).max);
        uint256 matchId = cross.postChallenge(marketId, 0, contracts, price, address(0), 0);
        taker.take(address(cross), collateral, matchId);

        bytes4 sel;
        bool reverted;
        try cross.settle(matchId) {
            reverted = false;
        } catch (bytes memory err) {
            reverted = true;
            if (err.length >= 4) sel = bytes4(err);
        }
        bytes memory out = abi.encode(reverted, sel, Cross.NotResolved.selector, uint8(cross.getMatch(matchId).state));
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}

/// Decodes a real settlement record through the production interface. A flat-return interface
/// reverts here, which is the bug that a resolution-gated fill test cannot reach.
contract SimSettlementRead {
    constructor(address settlement, uint256 marketKey) {
        IBinarySettlement.Record memory r = IBinarySettlement(settlement).getSettlement(marketKey);
        bytes memory out = abi.encode(r.finalized, r.voided, r.backing, r.collateralToken, r.payoutNumerators);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}

/**
 * Refund paths, which are the ones that strand money when they break. An unmatched challenge
 * must return the maker's stake exactly, and claimLegs must hand both outcome tokens back when
 * a market is voided so nobody is left holding an unredeemable position.
 */
contract SimRefund {
    struct Result {
        uint256 stakeBefore;
        uint256 afterCancel;
        uint8 stateAfterCancel;
        bool cancelTwiceReverted;
        bool strangerCancelReverted;
    }

    constructor(
        address module,
        address collateral,
        bytes32 venueId,
        uint32 operatorId,
        bytes32 marketId,
        uint128 contracts,
        uint32 price
    ) {
        Cross cross = new Cross(module, collateral, venueId, operatorId);
        ITestUsdc(collateral).faucet(uint256(contracts) * 4);
        IERC20(collateral).approve(address(cross), type(uint256).max);

        uint256 before = IERC20(collateral).balanceOf(address(this));
        uint256 matchId = cross.postChallenge(marketId, 0, contracts, price, address(0), 0);
        uint256 staked = before - IERC20(collateral).balanceOf(address(this));

        // A stranger must not be able to cancel someone else's open challenge.
        SimStranger stranger = new SimStranger();
        bool strangerReverted;
        try stranger.cancel(address(cross), matchId) {
            strangerReverted = false;
        } catch {
            strangerReverted = true;
        }

        cross.cancelChallenge(matchId);
        uint256 back = IERC20(collateral).balanceOf(address(this));
        Cross.Match memory m = cross.getMatch(matchId);

        // Cancelling twice must not pay twice.
        bool twiceReverted;
        try cross.cancelChallenge(matchId) {
            twiceReverted = false;
        } catch {
            twiceReverted = true;
        }

        Result memory r = Result(staked, back, uint8(m.state), twiceReverted, strangerReverted);
        bytes memory out = abi.encode(r);
        assembly {
            return(add(out, 0x20), mload(out))
        }
    }
}

contract SimStranger {
    function cancel(address cross, uint256 matchId) external {
        Cross(cross).cancelChallenge(matchId);
    }
}
