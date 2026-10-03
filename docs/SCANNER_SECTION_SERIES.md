# Operator-directed section series

The section workflow is software-only qualified. Actual fi-7160 feeding remains
suspended after the ten-card trial partly fed an eleventh card into the transport
([602](https://github.com/sefaction/MTG-Archives/issues/602)). Helper 0.4.1 refuses
counted production preparation before opening TWAIN. No simulated result proves
a physical count or permits unattended feeding.

With a qualified counted source, enable **Fill sections one at a time until I
stop**. Select the first section and explicitly Start. The server selects its
fresh remaining capacity, including committed copies, scanned but uncommitted
cards, unfinished reservations and the parent location limit. Manual count
limits and generic draining sources remain separate workflows.

After the target is reached, inspect the physical result and confirm its count.
Choose next section opens a fresh destination form with the section blank.
Scanner settings and review defaults carry forward. Only explicit selection
and Start create the next bounded batch. Polling, navigation, refresh and
reconnect never select a section or authorize a feed.

Early hopper exhaustion keeps the same logical batch and its remaining target.
After physical reconciliation and refill readiness, explicit Resume creates
a new physical segment in that batch. Earlier images, positions and reviews
remain intact. Saved-transfer recovery never refeeds cards.

**Stop section series** persists on the series root. It prevents further next
section and refill admission, cancels an unclaimed current segment using the
existing START-evidence guards, or requests the current active segment to finish.
Already authorized motion is not forcibly interrupted. A reconciled paused batch
ends with its saved cards; uncertain transport still requires reconciliation.
Saved cards continue reserving space and require explicit Inventory preview and
final addition. Stop never commits or discards them.

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
