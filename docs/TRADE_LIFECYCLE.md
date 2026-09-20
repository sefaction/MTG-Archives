# Two-user trade acceptance (#238 / #249)

Run against the local snapshot only, after rebuilding the cumulative Docker image:

```powershell
$env:MTG_LOCAL_PILOT_TEST = '1'
npx.cmd playwright test tests/ui/trade-lifecycle.spec.ts
```

The test requires loopback port 13001 and refuses to run if any global trade-announcement webhook is enabled. On this laptop, the one enabled snapshot endpoint was disabled before testing; it remains disabled. No production endpoint was changed. Synthetic users have no email addresses or webhook destinations, so trade notifications stay in-app. Keep the SMTP capture overlay enabled for the broader suite.

Three UUID-scoped accounts (two participants and an observer), three synthetic printings and 16 copies are created transactionally. The browser performs actual form interactions for proposal, over-reservation rejection, cancellation, decline with a note, counterproposal with multiple lines, acceptance and two-party physical confirmation. Checks cover reservation release, nonparticipant/proposer control visibility, no transfer after only one confirmation, wishlist partial/full fulfillment, per-printing copy conservation and one completion event. Cleanup removes only exact fixture-owned data and tolerates already-closed browser contexts.

## Provenance defect and correction

Baseline local Docker reproduced #249: receiving two cards incorrectly merged them into seven existing copies, overwrote all nine copies' source with TRADE, and discarded the incoming lot's notes. New received stacks also incorrectly reset the original opener and discarded pull/round links.

Received trade lots now remain separate from existing inventory and retain original opener, pull, round, notes, exact printing, finish, language and condition. Their current owner/location change and acquisition source becomes TRADE; the recipient chooses a location, not a section. Existing lots and their source/history are untouched. The source and receipt audit records remain associated with the trade. This does not retroactively repair historical trades whose provenance was already collapsed.

The test is not an exhaustive concurrent-mutation or malicious-request audit. Existing policy tests cover actor/status denial; the browser scenario additionally checks visible owner/nonparticipant boundaries. Authentication session integrity is separately tracked as #251 and has priority over the remaining feature queue.

Exact corrected-image results and review build identity are recorded in the PR and work checkpoint. Private authenticated traces and fixture logs stay ignored under `test-results/`.

Final verification on 2026-09-20 passed at application `7233d7c`: 553 unit tests, typecheck, Linux CI/build guards and all three targeted browser cases (51.1s). The new full lifecycle passed in 32 seconds, and fixture account/card counts returned to zero. The final history assertion also found and fixed #252: completed trades now appear once, exclusively under Completed rather than also under Cancelled / Declined. PR #250 is ready for individual review, not merged.
