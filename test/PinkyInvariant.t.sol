// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";
import {PinkyVault} from "../src/PinkyVault.sol";
import {PinkyStaking} from "../src/PinkyStaking.sol";
import {MockERC20, MockIntake} from "./mocks/Mocks.sol";

/// @dev Drives promises through every path in any order. A call whose precondition does not hold
/// returns early, so the fuzzer spends its depth on calls that move state.
contract PinkyHandler is Test {
    uint256 constant SIGNER_PK = 0xA11CE;
    uint256 constant PRICE = 0.5 ether;

    PinkyVault public vault;
    PinkyStaking public staking;
    MockERC20 public imd;
    MockERC20 public pinky;
    MockERC20 public token;
    MockIntake public intake;

    address[3] makers = [address(0xA1), address(0xA2), address(0xA3)];
    address staker = address(0x57A4E);
    uint256 nonce;

    uint256 public deposited;
    uint256 public toIntake;
    uint256 public toMakers;
    uint256 public toAskers;
    uint256 public toStakers;
    uint256 public burned;
    uint256 public verdicts;

    constructor(
        PinkyVault vault_,
        PinkyStaking staking_,
        MockERC20 imd_,
        MockERC20 pinky_,
        MockERC20 token_,
        MockIntake intake_
    ) {
        (vault, staking, imd, pinky, token, intake) = (vault_, staking_, imd_, pinky_, token_, intake_);
        pinky.mint(staker, 1_000 ether);
        vm.prank(staker);
        pinky.approve(address(staking), type(uint256).max);
    }

    function _pick(uint256 seed) internal view returns (uint256 id) {
        uint256 n = vault.count();
        return n == 0 ? 0 : bound(seed, 1, n);
    }

    function _status(uint256 id) internal view returns (PinkyVault.Status s) {
        (,,,,,,,,,, s,,,,,) = vault.promises(id);
    }

    function make(uint256 who, uint256 bond, uint256 maxOut, uint256 duration) external {
        address maker = makers[who % 3];
        bond = bound(bond, 5 ether, 50 ether);
        duration = bound(duration, 10 minutes, 30 days);
        imd.mint(maker, bond);
        vm.startPrank(maker);
        imd.approve(address(vault), bond);
        vault.make(address(token), maxOut, duration, bond);
        vm.stopPrank();
        deposited += bond;
    }

    function pass(uint256 secs, uint256 blocks) external {
        vm.warp(vm.getBlockTimestamp() + bound(secs, 1, 3 days));
        vm.roll(vm.getBlockNumber() + bound(blocks, 1, 100_000));
    }

    function toggleStake(uint256 amount) external {
        vm.startPrank(staker);
        if (staking.balanceOf(staker) == 0) staking.stake(bound(amount, 1, 1_000 ether));
        else staking.unstake(staking.balanceOf(staker));
        vm.stopPrank();
    }

    function close(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0 || _status(id) != PinkyVault.Status.Active) return;
        (,,,,,, uint64 endTime,,,,,,,,,) = vault.promises(id);
        if (vm.getBlockTimestamp() < endTime) vm.warp(endTime);
        vault.close(id);
    }

    function ask(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        PinkyVault.Status s = _status(id);
        (,,,,, uint64 endBlock,,, uint64 askedAt, uint8 attempts,,,,,,) = vault.promises(id);
        if (s != PinkyVault.Status.Closed && s != PinkyVault.Status.Asked) return;
        if (attempts >= vault.MAX_ATTEMPTS()) return;
        if (s == PinkyVault.Status.Asked && vm.getBlockTimestamp() < askedAt + vault.ANSWER_TIMEOUT()) return;
        if (vm.getBlockNumber() < endBlock + vault.SETTLE_DELAY_BLOCKS()) {
            vm.roll(endBlock + vault.SETTLE_DELAY_BLOCKS());
        }
        vm.prank(address(0xA5CE4));
        vault.ask(id);
        toIntake += PRICE;
    }

    function answer(uint256 seed, uint256 out) external {
        uint256 id = _pick(seed);
        if (id == 0 || _status(id) != PinkyVault.Status.Asked) return;
        (,,,, uint64 startBlock, uint64 endBlock,,,,,,,,, bytes32 requestId,) = vault.promises(id);
        OracleAttestation.Attestation memory a;
        a.requestId = bytes32(bytes16(keccak256(abi.encode(++nonce))));
        a.chainId = block.chainid;
        a.answerType = 3;
        a.answer = abi.encode(out);
        a.fromBlock = startBlock;
        a.toBlock = endBlock;
        a.panelSize = 7;
        a.quorum = 5;
        a.agreed = 6;
        a.issuedAt = uint64(vm.getBlockTimestamp());
        a.expiresAt = uint64(vm.getBlockTimestamp() + 86_400);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, vault.attestationDigest(a));
        intake.complete(requestId, a, abi.encodePacked(r, s, v));
        verdicts += 1;
    }

    function payout(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        PinkyVault.Status s = _status(id);
        (address maker,,, uint256 bond,,,,,,,, bool paid, address asker,,,) = vault.promises(id);
        if (paid || (s != PinkyVault.Status.Kept && s != PinkyVault.Status.Broken)) return;
        uint256 askerBefore = imd.balanceOf(asker);
        uint256 stakingBefore = imd.balanceOf(address(staking));
        uint256 burnBefore = imd.balanceOf(vault.BURN());
        uint256 makerBefore = imd.balanceOf(maker);
        vault.payout(id);
        if (s == PinkyVault.Status.Kept) {
            assertEq(imd.balanceOf(maker) - makerBefore, bond, "a kept promise returns the whole bond");
            toMakers += bond;
        } else {
            assertEq(imd.balanceOf(maker), makerBefore, "a broken promise returns nothing");
            toAskers += imd.balanceOf(asker) - askerBefore;
            toStakers += imd.balanceOf(address(staking)) - stakingBefore;
            burned += imd.balanceOf(vault.BURN()) - burnBefore;
        }
    }

    function refund(uint256 seed) external {
        uint256 id = _pick(seed);
        if (id == 0) return;
        PinkyVault.Status s = _status(id);
        (,,, uint256 bond,,,, uint64 closedAt, uint64 askedAt, uint8 attempts,,,,,,) = vault.promises(id);
        if (s != PinkyVault.Status.Closed && s != PinkyVault.Status.Asked) return;
        if (s == PinkyVault.Status.Asked && vm.getBlockTimestamp() < askedAt + vault.ANSWER_TIMEOUT()) return;
        if (attempts < vault.MAX_ATTEMPTS() && vm.getBlockTimestamp() < closedAt + vault.REFUND_GRACE()) return;
        vault.refund(id);
        toMakers += bond;
    }
}

contract PinkyInvariantTest is Test {
    PinkyVault vault;
    PinkyStaking staking;
    MockERC20 imd;
    PinkyHandler handler;

    function setUp() public {
        vm.warp(1_790_000_000);
        vm.roll(1_000);
        imd = new MockERC20("Identity.md", "IMD");
        MockERC20 pinky = new MockERC20("Pinky", "PINKY");
        MockERC20 token = new MockERC20("Meme", "MEME");
        MockIntake intake = new MockIntake(address(0xFEE), 0.5 ether);
        staking = new PinkyStaking(address(pinky), address(imd));
        vault = new PinkyVault(
            address(this),
            address(imd),
            address(staking),
            address(intake),
            bytes32("oracle.request@oracle-1"),
            vm.addr(0xA11CE),
            5 ether,
            7,
            5,
            86_400
        );
        handler = new PinkyHandler(vault, staking, imd, pinky, token, intake);
        targetContract(address(handler));
    }

    /// @notice The vault holds exactly the bonds it still owes, never more and never less.
    function invariant_VaultHoldsExactlyTheOpenBonds() public view {
        uint256 open;
        for (uint256 id = 1; id <= vault.count(); ++id) {
            (,,, uint256 bond,,,,,,,,,,,,) = vault.promises(id);
            open += bond;
        }
        assertEq(imd.balanceOf(address(vault)), open);
    }

    /// @notice Every IMD that entered went to the oracle, a maker, an asker, stakers or the burn.
    function invariant_EveryTokenIsAccountedFor() public view {
        assertEq(
            handler.deposited(),
            imd.balanceOf(address(vault)) + handler.toIntake() + handler.toMakers() + handler.toAskers()
                + handler.toStakers() + handler.burned()
        );
    }

    /// @notice A promise that was paid or refunded keeps no bond, and the vault keeps no allowance.
    function invariant_SettledPromisesAreEmpty() public view {
        for (uint256 id = 1; id <= vault.count(); ++id) {
            (,,, uint256 bond,,,,,,, PinkyVault.Status status, bool paid,,,,) = vault.promises(id);
            if (paid || status == PinkyVault.Status.Refunded) assertEq(bond, 0);
        }
        assertEq(imd.allowance(address(vault), address(staking)), 0);
    }
}
