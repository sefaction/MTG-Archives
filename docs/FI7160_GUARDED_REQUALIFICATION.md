# Guarded fi-7160 requalification

Counted production feeding remains suspended after the ten-image trial partly
pulled an eleventh card into the transport ([602](https://github.com/sefaction/MTG-Archives/issues/602)).
This change prepares a separate supervised small diagnostic. It does not remove
the helper 0.4.1 block, qualify a physical count, or authorize unattended feeding.

## Effective worker inspection

On October 3 the operator confirmed that `004: Cards` still showed Pre-Pick Off
after reopening. After explicit approval, the five idle laptop helpers and exact
discovery children were stopped without deleting connections or journals. This
included the production-connected laptop helper; the production site was unchanged.

The settings-only inspector used the known `Mtg.CountedTwain` assembly identity,
configured/read back the worker's simplex native RGB24/600 DPI capture settings,
target-one count and 2.7-by-3.6-inch frame, then opened ShowUIOnly once with the
hopper empty. Windows Computer Use observed initial `004: Cards` and Advanced >
Paper Feeding > Pre-Pick **Off**, without changing profiles or settings. Cancel
returned to state 4, all eleven temporary standard settings restored successfully,
and source/DSM closed successfully. Acquisition Enable and vendor SET counts were
zero. No scanner owner remained.

Private before/configured/after/restored snapshots keep the observed `0x80FD`
UInt16 value at 0. The only difference from configured to after-UI, and from
opened to restored, was `0x80F7` UInt16 0 to 4. Its meaning is not established;
the inspection does not claim every driver capability remained unchanged.
The correlated `0x80FD` value is **not an official Pre-Pick capability mapping**.
No official mapping was obtained from installed help or the archived official SDK.
The SDK was downloaded for document research, never installed or executed.

## Revised diagnostic

The rebuilt x86 `CountFeed.exe` refuses the legacy `feed-one-of-three` and
`feed-two-of-three` commands. Its only qualification targets are one and two
images with exactly three expendable cards loaded after fresh readiness.

```text
CountFeed.exe qualify-one-of-three <NEW absolute private evidence directory> <absolute known Mtg.CountedTwain.exe>
CountFeed.exe qualify-two-of-three <NEW absolute private evidence directory> <absolute known Mtg.CountedTwain.exe>
```

Each invocation first requires sole ownership, an empty hopper, exact observed
PaperStream source/driver/protocol and the worker assembly's TWAIN identity. It
records executable hashes, configures/readbacks capture settings, and opens
ShowUIOnly once. Keep the hopper empty while reading the initially selected
profile and visible Pre-Pick Off. Cancel unchanged. Unexpected transfers,
changed capture settings/frame, or a missing/mistyped/changed observed driver
invariant refuse feeding. No vendor capability is SET.

After successful empty settings closure and readback, the process stays in
state 4 and writes a fresh session/target-bound `readiness-challenge.txt`. It
waits indefinitely for **separate fresh operator confirmation** of visible Off,
exactly three loaded expendable cards, clear transport and readiness for that
one count. Only then may the coordinator create `authorize-once.txt` with the
exact challenge text. Merely opening the diagnostic, closing settings, elapsed
time, stale readiness or an old journal cannot authorize acquisition. Never
copy the challenge to authorization without that explicit operator response.

Authorization is consumed once, all capture settings/frame and the observed
driver invariant are read again, loaded status and sole ownership are checked,
and the source is enabled for acquisition once. No count-by-cancellation,
automatic retry, replay or forced shutdown exists. All returned images,
including excess transfers, are retained. Image counts remain distinct from
physical transport acceptance. Driver errors, restore/closure failures and
excess transfers remain failures.

Before acquisition, `cancel-before-feed.txt` ends the diagnostic with restoration
and normal source/DSM closure. It does not interrupt active feeding. A held
scanner source is intentional while awaiting specific readiness; do not launch
another owner or kill an uncertain transport. The readiness file is a local
diagnostic coordinator signal, not a website/helper production authorization.

## Acceptance

Compilation and motor-free policy tests cover revised small targets, legacy
command refusal, mismatched session/target/incomplete readiness, unavailable or
mistyped driver invariants and existing-journal refusal. CI runs those tests and
the settings-only inspector selftest without hardware. A prepared/cancelled
actual-source session must complete with zero acquisition calls before feeding.

After that, each fresh supervised small test needs operator observations of
undamaged exits, clear transport and every remaining card wholly in the hopper.
Any extra movement, damage or uncertainty stops progression. Only successful
new small gates permit planning larger tests within thickness-dependent hopper
limits. Actual 83-card/logical refill and integrated website section-series
acceptance remain open under [597](https://github.com/sefaction/MTG-Archives/issues/597).
Explicit Inventory preview/final addition and retained originals remain intact.

This diagnostic-only batch changes no Docker web or worker runtime; cumulative
local web review remains the section-series source from PR603. Every PR still
requires its own merge approval. No production deployment occurred.
