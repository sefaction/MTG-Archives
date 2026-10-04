# Operator-directed section series

For everyday fixed-count, refill and dashboard steps, start with the
[scanner batch quick start](SCANNER_BATCH_QUICK_START.md).

Guarded helper0.4.2 passed repaired one/two/five/ten supervised diagnostic boundaries
and the small website sequence: A2, B early-empty1, same-B refill2 and persistent
Stop before C. Operator physical observations and reconciliation are recorded.
Installed helper0.4.3 passed empty preparation, chosen startup, idle Close and
reopening. The larger 83-card logical batch subsequently passed with two 25-card
refills, a final three-of-four boundary and explicit next-section B handoff.
A separate fixed 25-of-26 stopping test passed; New scanner batch retained its
25-card limit and destination with fresh held-space capacity and no automatic feed.
Connection switching, active-run Close and wider hardware acceptance remain
unfinished.
See [current programmatic qualification](FI7160_PROGRAMMATIC_COUNT_CONTROL.md).
The original failed boundary in [602](https://github.com/sefaction/MTG-Archives/issues/602)
is retained. No simulated result proves a physical count or permits unattended feeding.

## Scanning and moving to the next batch

1. Open the updated helper and choose the saved website/account connection you
   intend to use. Use one connection on this computer.
2. On **Imports → Scan cards**, select the counted **fi-7160 (Cards, Pre-Pick Off)**
   source. Select the destination and its first section. The standard PaperStream
   source runs until the hopper is empty and does not provide this counted workflow.
3. Leave the optional manual limit off and enable **Fill sections one at a time
   until I stop**. The displayed target is the section's remaining capacity after
   stored cards, pending cards and unfinished reservations.
4. Load a comfortable small stack and explicitly Start while beside the scanner.
   Clean runs count saved card fronts automatically. If it empties before the target, refill and use
   **Resume**. This continues the same batch; its earlier cards remain saved.
5. When the target is reached, use **Choose next section**, select the next section and explicitly
   Start its new batch. The next section starts with a fresh capacity check.
6. Use **Stop section series** when finished. Saved cards remain available for
   review and explicit addition to Inventory; stopping does not add them.

For a smaller fixed count, enable **Set a batch limit** and enter the requested
count. This is a separate bounded batch rather than a section-filling series.
After it finishes, **New scanner batch** keeps the chosen limit and destination
as preferences. It shows freshly available space and waits for your Start. If
the same section has fewer spaces than the preferred count, choose a smaller
limit or another section; the count is never silently reduced. An unfinished
batch still uses Resume, retaining its earlier cards and remaining target.
Review the saved cards before adding them to Inventory. Image totals from a
standard or duplex source do not establish the number of physical cards.

With a qualified counted source, enable **Fill sections one at a time until I
stop**. Select the first section and explicitly Start. The server selects its
fresh remaining capacity, including committed copies, scanned but uncommitted
cards, unfinished reservations and the parent location limit. Manual count
limits and generic draining sources remain separate workflows.

The counted-source picker refreshes a locked destination snapshot, showing
committed Inventory quantities and held batch space separately. Section labels,
occupancy bars and **Only sections with room** include saved uncommitted cards
and unfinished targets, with the tighter parent limit applied. Custom sections
with only pending cards remain visible. Refresh capacity updates this snapshot;
Start still rechecks capacity transactionally. Ordinary storage move displays
retain their existing Inventory semantics. This addresses [622](https://github.com/sefaction/MTG-Archives/issues/622).

After a clean qualified counted run reaches its target, saved front images
provide the assumed card count; routine exact exit-count entry is unnecessary.
Failed or uncertain runs retain manual recovery. Confirm refill readiness before
starting new motion and inspect a jam or partly fed card when one is suspected.
Choose next section opens a fresh destination form with the section blank.
Scanner settings and review defaults carry forward. Only explicit selection
and Start create the next bounded batch. Polling, navigation, refresh and
reconnect never select a section or authorize a feed.

Early hopper exhaustion keeps the same logical batch and its remaining target.
After automatic image counting (or manual recovery) and refill readiness, explicit Resume creates
a new physical segment in that batch. Earlier images, positions and reviews
remain intact. Saved-transfer recovery never refeeds cards.

**Stop section series** persists on the series root. It prevents further next
section and refill admission, cancels an unclaimed current segment using the
existing START-evidence guards, or requests the current active segment to finish.
Already authorized motion is not forcibly interrupted. A reconciled paused batch
ends with its saved cards; uncertain transport still requires reconciliation.
Saved cards continue reserving space and require explicit Inventory preview and
final addition. Stop never commits or discards them.

Use **Imports → Batches** to find saved batches, unfinished match confirmation
and cards still awaiting Inventory addition. **Cancel batch** also stops image
processing while keeping saved work available. **Move to Trash** hides it and
keeps it recoverable for seven days before scan deletion. Inventory additions
stay intact. Restore and Resume processing never start the scanner or restart
a stopped section series. See [batch dashboard and Trash](ACQUISITION_BATCH_DASHBOARD.md).

Series membership and ordering are persisted in ScannerRun. Refill segments
retain their batch ordinal. One series lock serializes successors and Stop;
stale pages cannot create a second successor, and repeated request identities
recover the original batch. Stop from an older batch acts on the latest segment.
An explicitly started new series has a new identity; stopped series do not resume.

Software acceptance includes synthetic 83-image capacity, multiple sections,
concurrent distinct next clicks, stale page rejection, early-empty/refill,
queued and paused Stop, request replay, uncommitted conservation and explicit
Inventory commits. Tests use simulated events and disposable PostgreSQL. Physical
qualification must first establish effective Pre-Pick Off and then repeat small
counts with an extra loaded card before increasing counts within the documented
hopper thickness limit. No physical trial is planned while the operator is away.

## Initial software verification evidence — historical baseline

The figures and helper0.4.1 package below describe the initial PR603 validation.
They are preserved as historical evidence; current hardware qualification and
installed-helper status are in the linked programmatic report above.

- 801 unit tests, type checking, affected lint, production build and ten client
  manifests passed. Disposable PostgreSQL acquisition integrity passed in
  92327 ms, shared import integrity in 47504 ms, and full core verification in
  104461 ms; the owned database container and anonymous volume were removed.
- Real database simulation covers synthetic 83-image capacity, pending/committed
  conservation, parent limits, competing next-section requests, stale pages,
  refill positions and reviews, repeated/queued/paused/active Stop and recovery.
  No native helper or physical scanner is used by these checks.
- Six unique browser cases passed across the initial/repeat runs: section series,
  counted manual/refill, refused Start/retirement, accepted Start after lost ACK,
  and missing/lost Start recovery. Series screenshots at 1366 and 320 pixels
  show paused refill and persisted Stop with no horizontal overflow.
- The initial browser run retained two failures: one test reached the local
  server before startup finished; the series test exposed retained form state
  after Stop navigation. The page now remounts the form for the changed batch
  identity. Both affected cases passed on the healthy updated Docker build.
- Local Docker bundles helper 0.4.1, source 170caac, with complete distribution
  materials and SHA256 ca2c13399b1816d26e2e1d6dd1166246255cf8435e261151e9241a7ae4d21431.
  Authenticated installer metadata and binary/source checksum checks passed.
  Only the web service was reloaded; existing workers and models were preserved.
- Original Inventory remains 10280 rows/12482 copies, saved reviews 81 and
  original photos 907, with unchanged baseline hashes. The retained physical
  fixture has 24 photos and zero Inventory/audit writes. All eight physical runs
  remain DRAINED, with no queued/active command; the failed ten-card run remains
  physically unreconciled. The scanner helper remains stopped.

Draft PR603 is stacked on draft PR601. Both need individual merge approval;
no production deployment occurred. Exact build manifests and private test logs
remain in the active worktree's .local-data and resumable checkpoint.
