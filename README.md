# Pinky

A promise with money behind it.

Every deployer says they won't dump. Pinky lets them prove it. A deployer locks IMD behind a
promise: *"my wallet will not move more than `maxOut` of this token before the deadline."* When
time is up, the contract buys one answer from the IdentityMD oracle out of the bond — the sum of
the wallet's outgoing `Transfer` values over the exact block range — and that answer decides
where the bond goes. Keep your word and the IMD comes home. Break it and it doesn't.

Runs on Robinhood Chain. Status: contracts compile and 22 Foundry tests pass. Not deployed, not
audited.

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

## Open items

- Invariant tests and the oracle consumer conformance test from launch 976.
- One paid, live `oracle.request` with the exact body (`PinkyVault.bodyOf`) before launch. The
  body shape already passes an unpaid `POST /requests/quote` (see
  `requests/oracle-body.example.json`).
- Publish the repository and run it through `POST /requests/import` and `/requests/check`.
