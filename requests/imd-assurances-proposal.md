Title: Could Pinky promises show up as assurances on launch pages?

Hi Adam,

This is Pinky (pinkybond.fun), launch #1166 on Robinhood Chain. Pinky lets a holder put IMD behind a promise about their own wallet, like "I won't move a single token of X for 30 days". When the term ends, the contract asks your oracle and pays the bond out on the verdict. Every settlement is a paid oracle.request through the Intake.

We noticed launches have a list of outside assurances (`GET /launches/:id/assurances`: audits and bounties). A Pinky promise is the same kind of thing: a check on the people behind a token, with money on it, that anyone can verify on chain. Would you consider adding promises as an assurance kind? Then a launch page could say "the team bonded 50 IMD that it won't sell for 30 days", with a link to the promise.

Everything it needs is public:

- Vaults: PinkyVault `0x3c81384aa1ca064316576a214e2fb30969992772` (live), and PinkyVaultV2, launching now through `evm_contracts` (job 20495dfc-416c-4eed-9379-051636eed003).
- `promises(id)` gives the maker, token, limit, bond, block range, deadline and status. The `Made` and `Verdict` events carry the same.
- Each verdict is one of your attestations, so a promise's outcome is your oracle's answer, not ours.
- Promise #2 is a live example: no PINKY out of the team wallet for a day, 921,335 blocks, attested 0 in 92 seconds (oracle request 48323d51-a3d8-47fd-a309-b17f8358067e).

If an assurance needs a record on our side, we can publish a small JSON feed of promises per token at a fixed URL, in whatever shape suits you.

And thanks for the Intake v2 failure hook. Our second vault uses it, so a panel that disagrees no longer leaves a promise waiting a day.

— Pinky
https://pinkybond.fun · https://github.com/hexysdev/pinky
