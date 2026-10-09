# Pinky

A promise with money behind it.

Every deployer says they won't dump. Pinky lets them prove it. A deployer locks IMD behind a
promise: *"my wallet will not move more than `maxOut` of this token before the deadline."* When
time is up, the contract buys one answer from the IdentityMD oracle out of the bond — the sum of
the wallet's outgoing `Transfer` values over the exact block range — and that answer decides
where the bond goes. Keep your word and the IMD comes home. Break it and it doesn't.

Runs on Robinhood Chain. Status: contracts compile and 26 Foundry tests pass (unit, fuzz, invariant and
the protocol's oracle conformance vector). Not deployed, not audited.

## How it works

1. **make** — the deployer calls `PinkyVault.make(token, maxOut, duration, bond)`. The vault
   pulls `bond` IMD and records the current block.
2. **close** — once the deadline has passed, anyone calls `close(id)`, which fixes the closing
   block. Until then the promise keeps running.
3. **ask** — 32 blocks later anyone calls `ask(id)`. The vault pays the Intake 0.5 IMD from the
   bond and sends an `oracle.request` with `evidence: "chain"` and a pinned `log-sum` recipe:
   `Transfer` events of `token`, filtered to `from = maker`, summed over `[startBlock, endBlock]`.
4. **verdict** — the Intake calls `onOracleResult` with the signed attestation. The vault checks
   the signature in its own EIP-712 domain, the chain id and both block numbers, and records
   `Kept` (sum ≤ `maxOut`) or `Broken`. No funds move in the callback.
5. **payout** — anyone calls `payout(id)`.
   - Kept: the rest of the bond returns to the maker.
   - Broken: 10% to whoever called `ask`, half of the remainder to PINKY stakers, the rest to
     `0x…dEaD`.

If the oracle gives no answer, `ask` can be repeated after 24 hours, three times in all. After
three failed attempts, or seven days after closing, `refund(id)` returns what is left to the maker.

## Where IMD is used

| | |
|---|---|
| Bond | Held in IMD; the minimum is 5 IMD and never less than three oracle fees |
| Oracle | Every settlement is an on-chain `oracle.request` paid in IMD through the Intake |
| Broken promises | IMD is burned and streamed to PINKY stakers |
| Token | PINKY launches through the IMD ProjectFactory, paired with IMD |

## Contracts

| File | What it is |
|---|---|
| `src/PinkyVault.sol` | Bonds, the oracle request, the verdict and the payout |
| `src/PinkyStaking.sol` | Stake PINKY, earn forfeited IMD over a seven-day stream. No owner |
| `src/OracleAttestation.sol` | The IdentityMD consumer library, unchanged from launch 976 |
| `src/LaunchToken.sol` | The fixed launch token |

## Build

```
forge build
forge test
```

Foundry 1.8.3, solc 0.8.26. Dependencies are vendored under `lib/` (OpenZeppelin Contracts
v5.5.0, forge-std v1.9.7); nothing is downloaded at build time.

## Trust and known limits

- **Owner.** The vault owner can change the Intake, the action id, the oracle signer and the
  panel settings. A malicious owner could point the signer at a key of their own and forge
  verdicts. IMD, the staking contract and the minimum bond cannot be changed.
- **One wallet.** A promise covers one wallet and one token. Tokens the deployer holds elsewhere
  are not covered.
- **No answer favours the maker.** If the oracle cannot answer, the bond is refunded. A maker who
  could make the question unanswerable would get their bond back.
- **Window length.** The oracle has attested log sums on Robinhood Chain over ranges of about
  18,000 blocks (roughly half an hour). Longer terms are untested.
- **Standard tokens only.** Rebasing or fee-on-transfer tokens are out of scope.
- **Gas-limited payout.** The staker share is sent in a `try`; if it fails, that share is burned.

## Checked against the live oracle

On 2026-10-09 the exact question the vault builds was paid for on Robinhood Chain
(`0x1e725da5203496444ba7a33cb4a66bb71e82e990c9a9bf823160edc83b0e2b96`, oracle request
`c5e21f11-5172-4f9b-a506-9babcdfa47c2`). The window held four IMD transfers worth 18.6457 IMD; one,
6.2152 IMD, came from the address in the filter. The oracle attested 6215220149346698936 wei in
2 minutes 15 seconds, with the `filter.from` recipe as asked. Four of five panel members agreed at
a quorum of four, so the launch asks for a panel of seven with a quorum of five.

That request had no callback. Delivery into the vault is covered by tests against a mock Intake
and has not run on chain yet.

## Open items

- Launch through `launch.open` (`requests/launch.input.json`).
- A site that lists promises and their verdicts.
