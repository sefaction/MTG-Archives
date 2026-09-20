# Commander League lifecycle acceptance

Issue #239 adds local browser acceptance across the League's separate domain and shared Archive deck workspace. It preserves deliberate boundaries: the League dashboard/statistics are member-only, League administration is membership-based, decks are public, and deck lists never commit physical inventory.

## Scenario

The opt-in browser fixture creates three isolated users, private/public/unlinked locations and 202 physical copies using existing cached Forest, Esika, Sol Ring and Arcane Signet printings. It does not change existing cards or real users. Through actual UI forms it:

1. Creates a yearly season with twelve rounds, adds a member and links their public location.
2. Checks private and unlinked printings are excluded from League search, member-only access and administrator-only controls.
3. Creates and imports two 100-card January decks with commanders through the complete shared deck importer; public readers cannot import and one player cannot remove another player's deck rows.
4. Rejects malformed/fractional participant counts and duplicate participants without recording a game.
5. Records a completed win/loss match and an all-player draw; checks 4/1 points, four 100-card snapshots, commander flags and unchanged physical inventory with no commitments.
6. Checks permanent deck-lock messaging, denied import/removal after first submission and unchanged snapshots after rejected mutations; loads member statistics.

Cleanup targets only the fixture's UUID-scoped users and dependent league/deck/inventory data. Separate browser contexts are closed tolerantly before transactional fixture deletion. Authentication traces/video/screenshots are disabled. Run with the capture-only Compose overlay and serial browser execution:

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
npm.cmd run ui:test -- tests/ui/league-lifecycle.spec.ts
```

## Findings

- #257: a nonnumeric participant count became NaN, bypassed range checks and created an empty game. The local regression observed one persisted game instead of zero. Explicit integer guards now reject invalid counts before constructing entries; adjacent year and finish-position guards are also explicit. No historical real games are removed or rewritten.
- #258: after rejecting duplicate participants, a corrected successful submission left the old error banner visible. Successful game entry now redirects to the clean League URL after revalidation.

Before adding those edge cases, the complete normal lifecycle passed against the existing app. Separate local baselines then reproduced both defects, and synthetic records were cleaned. An initial test-only exact-label locator was corrected before those findings. Consult the PR/checkpoint for corrected-build results; adding a test is not proof it passes.

This is not an exhaustive concurrency or malicious-server-action audit, nor a claim of full Commander rules legality enforcement. Larger seasons, eight-player games, tournament rule variants and exhaustive mobile layout coverage remain separate tests.

Final acceptance at `76f0d8b` PASSED: 563 units, generation/typecheck, Windows/Linux production builds and six manifest guards, the corrected League browser case (19.8s), and all 40 serial browser cases with zero skips (4.3m). Local image `sha256:14cd31c69a66501c5a5378257047c29e297cb606c82a7572e8375f79ce4f34de` is healthy/host HTTP 200. Fixture users/leagues returned to zero and original inventory remains 12,477 copies. PR #259 awaits individual merge approval; no production change.
