# Acquisition batch dashboard and Trash

The batch dashboard is available from **Imports → Batches**. Pending batches are
shown first. Search by batch number, storage, section or owner; use All batches,
Closed, Cancelled and Trash to find older work. Lists contain 25 batches per page.
Counts refresh every 20 seconds while the page is visible. Automatic updates
wait while search is being edited or a cancellation/Trash confirmation is open;
they can be switched off. Refresh batches also updates counts on demand.
Camera, uploaded-photo and scanner batches share this overview. CSV history stays
in its existing History view.

Each physical candidate is counted once. Evaluated means a current completed
printing check or a complete saved match review. Assigned to storage means the
batch has an available storage destination; this is separate from a completed
Inventory addition. Confirmed means printing, finish, condition and language
have been saved. Inventory totals come from immutable addition receipts. Retry
jobs and superseded images do not create more cards. Trash is excluded from the
summary. Destination assignments do not imply a confirmed card match.

**Cancel batch** stops worker processing and keeps saved cards/reviews available.
An already accepted scanner load may continue feeding and saving until it drains;
cancellation does not forcibly interrupt the hardware. Queued, unaccepted Starts
are retired, and the current section series is stopped. Resume processing restarts
image evaluation only, after the scanner has drained. It never refills the hopper
or restarts a stopped series. Manual recovery and reviewed Inventory additions
remain available for retained cancelled batches.

**Move to Trash** immediately hides a batch and stops its worker processing. It can
be restored for seven days, measured from the first Trash action; repeated clicks
do not extend expiry. Restoration preserves saved reviews and returns the batch
for processing without reopening physical capture. A batch already cancelled
before entering Trash remains cancelled after restoration until Resume processing
is explicitly selected. Expired batches cannot be restored even if maintenance
has not run yet.

The acquisition photo worker checks expiry every minute while running. Cleanup
is bounded to five eligible batches and 25 photos per batch per tick. It waits for
accepted scanner runs to drain and removes original/preview scan files using the
existing private-file path guards. Failed unlink/mark attempts retry safely.
An error run with a saved finish outcome has completed its durable transfers and
can expire. An error without that outcome remains uncertain and waits for recovery;
it cannot release the helper for another scan. Discarding a finished error never
invents a physical count or treats its images as automatically confirmed.
Inventory, addition receipts and minimal acquisition provenance are retained;
expiry does not delete collected cards. Previously expired committed scan files
cannot be recovered by moving their batch to Trash.
The existing helper retention check also removes matching laptop recovery
originals after the server confirms their expired Trash files were purged. It
verifies run, epoch, original receipt and digest before unlinking; an offline
helper retains its copy until the next verified online check. No helper binary
update or scanner operation is required for this server-side attestation.

Processing claims, heartbeats, publication and automatic-match confirmation are
fenced by cancellation/Trash state and existing owner/lease/generation checks.
Cancellation clears pending/running/failed jobs' leases. A late worker result
cannot publish or retry into a restored batch using its retired lease. Accepted
scanner transfers are retained as stopped jobs until explicit restoration.
Session locks serialize restoration against unlink and committed-photo retention.
Trash releases unused admission space immediately; accepted loads retain their
reserved space until drained. Retained cancelled cards continue occupying space.

Authorization follows the existing owner and Admin Mode rules. The dashboard
uses bounded SQL aggregates and pagination rather than loading every card into
the browser. No worker may add cards to Inventory through these operations.

Implementation and local acceptance tracked in
[issue626](https://github.com/sefaction/MTG-Archives/issues/626). Scanner hardware
acceptance is separate; software fixtures do not prove physical card counts.
