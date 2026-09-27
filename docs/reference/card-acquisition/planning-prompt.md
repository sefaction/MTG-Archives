# MTG-Archive Card Acquisition Framework — Planning Task Only

I want to add a comprehensive future implementation plan for a **Card Acquisition Framework** to the MTG-Archive project.

**This task is PLANNING ONLY. Do not begin implementing this feature.**

There are currently bug fixes and other active work that take priority. The purpose of this task is to preserve the design work, identify the proper architecture for this repository, and add an implementation-ready project plan/backlog so that we can return to the feature later.

I am also providing a detailed research/design report. Treat that report as **design/reference material, not an immutable implementation specification**.

Do not blindly reproduce proposed filenames, class names, schemas, libraries, directory layouts, APIs, or technology choices from the report. First inspect the actual MTG-Archive repository and adapt the design to the architecture, conventions, and systems that already exist.

---

# 1. Inspect the repository before planning

Before modifying any planning artifact, inspect the repository thoroughly.

At minimum review:

- `AGENTS.md`
- `CODEX.md`
- README and architecture documentation
- roadmap/backlog/TODO/project-plan documents
- GitHub issue/milestone conventions if the repository uses them
- application/runtime architecture
- Docker/deployment configuration
- package/runtime choices
- Prisma/database schema
- migrations
- inventory models
- storage-location models
- storage layout/capacity logic
- card catalog/Scryfall integration
- imports and CSV-import workflows
- printing-resolution/review workflows
- inventory audit/history systems
- image/file upload infrastructure
- authentication/authorization patterns
- test architecture
- CI/verification commands
- Playwright/E2E conventions
- any existing worker/job/background-processing architecture

Identify functionality that can be reused.

Do not create parallel systems when MTG-Archive already has an appropriate abstraction.

Examples include:

- inventory mutation
- inventory quantity grouping
- audit history
- storage capacity
- printing resolution
- Scryfall caching/catalog data
- import review
- transactional commit
- user ownership
- storage-location selection

The resulting plan should be written for the **real MTG-Archive codebase**, not for a hypothetical application.

---

# 2. Core product concept

This should NOT be designed as a:

> Fujitsu scanner feature

or merely a:

> document scanner feature

It should be designed as a:

# Card Acquisition Framework

The framework should allow multiple acquisition methods to eventually feed the same downstream card-processing pipeline.

The first planned acquisition methods are:

1. **Fixture / Simulated Provider**
   - deterministic development/testing
   - does not require hardware

2. **Image Batch Provider**
   - manually selected images
   - drag/drop uploads
   - directories/watched-folder style workflows where appropriate
   - phone photos transferred to the desktop
   - images containing one or multiple cards

3. **TWAIN / Windows Scanner Provider**
   - initially targeting Fujitsu/Ricoh scanners
   - likely first hardware: fi-6130Z
   - potential later validation: fi-7160 / fi-8170
   - PaperStream IP / TWAIN

Possible FUTURE providers should be anticipated architecturally but should NOT be implemented as part of the initial project:

- webcam/camera scanning
- automated card-slinger
- motorized hopper
- dedicated scanning appliance
- mobile ManaBox-style live camera scanning
- mobile capture-session upload/synchronization
- other scanner APIs or devices

Do not overengineer those future providers.

The objective is simply to avoid foundational assumptions that would make them difficult later.

---

# 3. Major architectural principle: separate acquisition from recognition

The system should conceptually separate:

```text
Acquisition
    ↓
Raw Capture Artifacts
    ↓
Card Detection
    ↓
Card Observations / Physical Card Candidates
    ↓
Image Normalization
    ↓
Canonical Card Image
    ↓
OCR / Recognition Signals
    ↓
Exact Printing Resolution
    ↓
Confidence / Review
    ↓
Transactional Inventory Commit
```

Recognition should not know or care whether the card came from:

- an fi-6130Z
- an fi-7160
- a JPEG
- a phone photograph
- a webcam
- a card-slinger
- a mobile client

Likewise, scanner/provider code should not contain Magic-card recognition logic.

Keep provider-specific behavior behind clearly defined interfaces/adapters.

---

# 4. Critical modeling rule: an image is NOT a physical card

Do not architect the system around:

> 1 image = 1 card

That assumption is invalid for several expected acquisition methods.

Examples:

### Duplex scanner

One physical card may generate:

```text
front image
back image
```

Two image artifacts = one physical card.

### Phone photograph

One photograph may contain:

```text
card 1
card 2
card 3
card 4
card 5
card 6
```

One image artifact = six physical cards.

### Webcam

A single physical card may appear in:

```text
frame 100
frame 101
frame 102
frame 103
frame 104
```

Five artifacts/observations = one physical card.

Therefore, explicitly distinguish concepts equivalent to:

- Capture Session
- Capture Provider
- Provider Run
- Raw Capture Artifact
- Physical Card Candidate
- Observation
- Recognition Result
- Review State
- Commit Transaction

Use names that fit the repository's conventions.

Do not force these exact names if another naming pattern fits the codebase better.

---

# 5. CaptureSession should be the business-level abstraction

The session should represent an acquisition operation regardless of source.

Conceptually:

```text
CaptureSession

source/provider
destination
target physical-card count
capture configuration
acquisition status
processing status
review status
commit status
timestamps
counts
diagnostics/provenance
```

The session should survive page refreshes and ideally application/process restarts where practical.

Capture, processing, review, and inventory commit should be distinct phases.

A likely conceptual state flow is:

```text
DRAFT
  ↓
PREPARING
  ↓
CAPTURING
  ↓
PROCESSING
  ↓
REVIEW_REQUIRED / READY_TO_COMMIT
  ↓
COMMITTING
  ↓
COMMITTED
```

with appropriate:

```text
PAUSED
FAILED
CANCELLED
```

states if justified by the existing application architecture.

The precise state machine should be designed after repository inspection.

---

# 6. Provider abstraction

The framework should have a provider contract that describes **capabilities**, rather than assuming all sources behave like scanners.

Relevant capabilities may include:

```text
batch input
streaming input
duplex
physical-item boundaries
multi-card artifact support
device enumeration
device control
pause
resume
stop
cancel
target-count enforcement
resolution configuration
color configuration
vendor UI suppression
multifeed detection
device counters
```

Not every provider supports every capability.

For example:

| Source | Physical boundary | Duplex | Streaming | Device control | Target behavior |
|---|---|---|---|---|---|
| Fixture | native/scripted | configurable | yes | simulated | exact |
| Image batch | detection-derived | no | no | N/A | logical truncation |
| TWAIN ADF | scanner sheet | yes | yes | yes | stop/best effort |
| Webcam | detection-derived | no | yes | camera | software |
| Hopper | feeder-native | optional | yes | full | exact-before-next |
| Mobile | app-derived | no | live/batch | phone camera | logical |

This table is conceptual guidance only.

Codex should derive the actual interface from the project's architecture.

---

# 7. Scan/capture-to-capacity is a SESSION feature

A major requirement is the ability to target exactly the remaining physical capacity of a storage location or subsection.

Example:

```text
Box 4 / Row 2

Capacity: 800
Existing: 537
Remaining: 263
```

The session should be able to establish:

```text
targetPhysicalCount = 263
```

Do NOT put business logic into a provider such as:

```text
fi6130.scan(263)
```

The session/domain layer owns the target.

Providers determine how they can satisfy it.

Examples:

### Future controlled hopper

Can stop before feeding item 264.

Potentially exact physical enforcement.

### TWAIN ADF

Counts completed physical sheets/cards and requests a stop when the target is reached.

Actual physical behavior must later be validated on hardware.

### Image batch

Cannot undo photographs already taken.

If imported photos contain 300 cards and target is 263:

```text
1–263   → session target
264–300 → overflow / retained for later handling
```

Do not discard overflow.

---

# 8. Physical card count is independent of recognition success

This is a hard invariant.

If a session target is:

```text
263 cards
```

and card #147 cannot be recognized:

```text
Card #147
Physical card: YES
Printing identified: NO
Review required: YES
```

it still consumes one physical storage position.

Therefore:

```text
physicalCardCount
```

must not be calculated from:

```text
recognizedCardCount
```

Likewise, do not count image files as physical cards.

---

# 9. Canonical card-image pipeline

Downstream recognition should operate on a source-independent normalized representation.

Conceptually:

```text
Raw Capture
    ↓
decode/orientation correction
    ↓
card detection
    ↓
crop / perspective correction
    ↓
rotation/orientation normalization
    ↓
quality metrics
    ↓
Canonical Card Image
    ↓
Recognition
```

A clean ADF scanner image may require almost no geometric processing.

A phone image may require:

- card detection
- background separation
- rotation
- perspective correction
- glare/shadow handling
- multiple-card extraction

Both should ultimately produce the same canonical representation.

Do not tightly couple recognition to scanner output.

---

# 10. Recognition requirements

The recognition objective should be:

> identify the exact MTG printing whenever evidence supports doing so safely.

Strong recognition signals include:

- card name
- set code
- collector number
- language
- potentially artwork/image similarity later

A likely resolver hierarchy is something similar to:

```text
set + collector number + language
        ↓
set + collector number
        ↓
exact name + set
        ↓
exact name
        ↓
fuzzy name / candidate suggestions
```

However, inspect the repository's existing import/printing-resolution behavior and reuse its rules where appropriate.

Recognition should be **conservative**.

A wrong automatic printing selection is much worse than sending a card to review.

Contradictory signals should force review.

Examples:

```text
collector metadata strongly identifies Card A
but
name OCR clearly identifies Card B
```

→ review

Do not hide ambiguity behind a confidence percentage.

Persist enough recognition evidence to explain:

> Why did MTG-Archive think this was this printing?

---

# 11. Local Scryfall/catalog strategy

Investigate how the project currently stores and caches Scryfall cards.

The acquisition system should avoid making one live Scryfall request for every scanned card.

Evaluate whether this feature justifies implementing or expanding a local bulk-data catalog/index.

Prefer extending existing card/catalog infrastructure over creating a parallel recognition database.

Useful indexed fields may include:

```text
set
collector number
language
name
Scryfall ID
```

Do not implement this during the current planning task.

Document what would eventually be necessary.

---

# 12. Finish / foil handling

Finish recognition should NOT block the first implementation.

Support a concept equivalent to:

```text
NONFOIL
FOIL
ETCHED
UNKNOWN
```

or whatever maps cleanly onto the existing inventory model.

Important:

Do not allow an unknown scanned finish to silently become nonfoil merely because the current database defaults to nonfoil.

The eventual workflow should support options like:

```text
All cards in batch are nonfoil
All cards in batch are foil
Review finish individually
Unknown
```

Automatic visual foil classification can be a later project.

---

# 13. ImageBatchProvider is a first-class feature, not merely test scaffolding

The image provider should eventually support:

- single-card images
- multiple-card photos
- images copied from a phone
- user-selected files
- potentially watched folders

Example:

```text
IMG_1001.jpg

contains:
card 1
card 2
card 3
card 4
card 5
card 6
```

The image artifact should remain stored/provenance-linked while detection creates multiple card candidates/observations.

This provider will also be useful for testing much of the pipeline before scanner hardware exists.

---

# 14. FixtureProvider should be deterministic

The Fixture/Simulated provider should eventually serve as the reference implementation for capture behavior.

It should be capable of simulating:

- one-sided capture
- duplex capture
- 300 input cards
- target of 263
- source exhausted
- latency
- cancellation
- recoverable error
- duplicate/replayed events
- overflow
- unrecognized cards
- front/back ordering issues if useful

The fixture provider should make it possible to test capture-session rules without hardware.

---

# 15. TWAIN/document-scanner architecture

The probable first physical scanner is:

```text
Fujitsu fi-6130Z
```

Potential future validation devices include:

```text
fi-7160
fi-8170
```

The likely Windows driver stack is:

```text
MTG-Archive
    ↓
local scanner component/agent
    ↓
TWAIN
    ↓
PaperStream IP
    ↓
Fujitsu/Ricoh scanner
```

However, inspect the actual deployment architecture before deciding how this should work.

MTG-Archive may be hosted in Docker/on another machine while the USB scanner is attached to a Windows workstation.

If so, strongly evaluate a small **Windows Capture Agent** rather than attempting scanner control directly from the web/container process.

A possible architecture is:

```text
Windows PC                         MTG-Archive server

Capture Agent
    │
TWAIN
    │
PaperStream
    │
fi-6130Z
    │
    └──── authenticated connection ────→ CaptureSession
                                           │
                                           ↓
                                      processing
                                           ↓
                                         review
                                           ↓
                                         commit
```

The report proposes an outbound/agent-initiated connection.

Evaluate that against the real deployment/security model.

Do not assume browser → localhost scanner APIs unless there is a compelling reason.

---

# 16. TWAIN must be isolated behind an adapter

Do not allow TWAIN library-specific types to spread throughout the application.

There should be an abstraction equivalent to:

```text
TwainBackend
```

or another project-appropriate interface.

That boundary should isolate:

- source enumeration
- capability querying
- acquisition configuration
- acquisition events
- stop/cancel behavior
- scanner error/status translation

This allows the underlying TWAIN implementation/library to change without redesigning CaptureSession.

---

# 17. Pre-hardware proof of concept

A major project goal is to prove as much as possible before buying or receiving a scanner.

Plan explicitly for this.

Software-only development should be able to prove:

```text
CaptureSession lifecycle
provider abstraction
physical-card counting
target capacity
overflow handling
artifact storage
image batch acquisition
card detection
image normalization
OCR
exact-printing resolution
review workflow
transactional inventory commit
audit history
provider event idempotency
scanner-agent protocol
TWAIN interaction using a virtual source where practical
```

Physical hardware should only be required to validate:

```text
PaperStream-specific behavior
actual MTG card feeding
surface safety
multifeed behavior
scanner speed
front/back ordering
physical stopping behavior
whether card N+1 enters transport
best DPI/settings
roller/feed behavior
real scanner errors
```

---

# 18. Virtual TWAIN testing

Investigate using the TWAIN Working Group's sample/virtual source as part of the future proof-of-concept.

The eventual POC should demonstrate more than:

> scanner appears in device list

It should demonstrate something like:

```text
virtual TWAIN source
    ↓
capture agent discovers source
    ↓
MTG-Archive creates session
    ↓
capture begins
    ↓
images transfer
    ↓
physical items count
    ↓
target reached
    ↓
stop requested
    ↓
session proceeds to processing/review
    ↓
no inventory mutation yet
```

Do not install TWAIN dependencies during this planning task.

Document the future test instead.

---

# 19. Scanner diagnostics

Plan an acquisition/scanner diagnostics utility.

This will likely be extremely useful once real hardware is involved.

Potential diagnostics include:

```text
capture-agent version
OS version
process architecture
TWAIN DSM version
enumerated sources
selected source
driver information
capabilities
configured settings
actual negotiated settings
resolution
color mode
duplex
vendor UI state
physical item count
artifact count
source exhausted
last error
TWAIN return/status codes
multifeed events
stop request timing
session event log
```

Eventually allow exporting a diagnostic bundle.

Do not include secrets or raw images in diagnostic exports by default.

---

# 20. Persistent artifacts and image lifecycle

Plan how raw and processed capture data should be stored.

Do not store large images directly in PostgreSQL unless the existing project has a compelling established reason to do so.

Consider a session-oriented structure such as:

```text
capture-data/
    session-id/
        raw/
        canonical/
        thumbnails/
        diagnostics/
```

or the repository's equivalent storage abstraction.

The plan should address:

- file ownership
- hashes
- provenance
- deduplication semantics
- cleanup
- retention
- orphan cleanup
- failed-session handling
- committed-session retention
- privacy
- backup implications

Image hashes must NOT be used to deduplicate physical Magic cards automatically.

Two physical copies can legitimately produce identical-looking captures.

Event delivery may be deduplicated.

Physical cards must not be.

---

# 21. Ordering and idempotency

Acquisition systems will eventually involve retries and potentially unreliable network links.

Plan for:

```text
provider run ID
event sequence
artifact sequence
physical card sequence
idempotency
retry-safe uploads
```

A retried provider event must not create a second physical card.

Likewise, committing a session twice must not duplicate inventory.

---

# 22. Review workflow

The review workflow should ideally reuse the principles and components from MTG-Archive's existing import/review system.

Eventually a reviewer should be able to see something like:

```text
captured card image

Proposed:
Lightning Bolt
M11
#149
EN

Name signal: good
Set signal: good
Collector signal: good
Language: uncertain

Confidence: high

[Accept]
[Search another printing]
```

Review should expose **why** a result was chosen.

Useful filters may eventually include:

```text
Needs review
Conflicting signals
No match
Unknown finish
Capture quality warning
Overflow
All
```

Do not implement UI during this task.

Plan it.

---

# 23. Transactional inventory commit

Scanning/capturing a card must NOT immediately mutate inventory.

The desired flow is:

```text
Capture
    ↓
Process
    ↓
Recognize
    ↓
Review
    ↓
Explicit Commit
    ↓
Inventory mutation
```

The final commit should reuse the existing inventory/audit infrastructure.

It must be:

- transactional
- idempotent
- auditable

The system should preserve provenance such as:

```text
CaptureSession
PhysicalCardCandidate
RecognitionResult
Inventory mutation
Audit entry
```

Physical duplicates should behave according to MTG-Archive's existing inventory quantity semantics rather than creating arbitrary duplicate database models.

---

# 24. Capacity must be revalidated at commit

Example:

When capture begins:

```text
Row 2 remaining = 263
```

While scanning, someone manually adds five cards.

At commit:

```text
Row 2 remaining = 258
```

The system must not silently overfill the destination.

Plan how this race is handled.

Excess captured cards should remain available for reassignment/review rather than being discarded.

---

# 25. Future mobile architecture

A future ManaBox-style mobile scanner should fit this framework without directly mutating inventory.

Conceptually:

```text
Mobile app
    ↓
creates/joins CaptureSession
    ↓
camera captures card observations
    ↓
uploads observations/artifacts
    ↓
server recognition
    ↓
review
    ↓
normal commit
```

Whether recognition eventually runs partially on-device can be decided later.

The foundational design should simply avoid requiring inventory mutations directly from the mobile scanner.

Do NOT build mobile functionality now.

---

# 26. Future webcam / card-slinger / hopper support

Keep a clean path for something like:

```text
bulk hopper
    ↓
motorized feed
    ↓
camera stage
    ↓
card presence detection
    ↓
capture
    ↓
eject
```

This provider may eventually support stronger target enforcement than an ADF scanner because it can refuse to feed physical card N+1.

Do not build this functionality now.

Only ensure the provider/capability/session architecture does not make it impossible later.

---

# 27. Explicit non-goals for the initial implementation

Unless later requirements change, the first implementation should NOT include:

- mobile application
- live webcam scanner
- hopper motor control
- 3D-print hardware integration
- foil AI
- condition grading AI
- market pricing
- card-value calculations
- image embedding/art matching unless recognition proves it necessary
- family-photo archival features
- generalized document management
- cloud AI dependency
- direct inventory mutation during scanning

Avoid speculative implementation for future providers.

---

# 28. Hardware validation milestone

After the fi-6130Z is eventually obtained, the existing software should be used to characterize the hardware rather than redesign the system.

Plan a validation matrix covering at least:

```text
single-card scans
10-card batches
25-card batches
larger batches if stable
duplex front/back pairing
300 DPI
alternative DPI values where useful
auto-crop behavior
rotation behavior
blank-page removal behavior
multifeed detection
jam/error reporting
stop at 1
stop at 2
stop at 5
stop at arbitrary N
whether card N+1 enters the transport
card order
surface scratches/marks
feed reliability
roller behavior
consumable counters
```

Use low-value bulk cards for early physical testing.

The same validation corpus should later be reusable against an fi-7160 or fi-8170.

---

# 29. Plan the work in phases

The implementation roadmap should be broken into independently executable phases.

A likely ordering is:

## Phase 0 — Planning and architecture

Current task.

No production implementation.

---

## Phase 1 — Capture domain foundation

Examples:

- CaptureSession concept
- provider interface
- capabilities
- state machine
- target policies
- physical-card vs artifact distinction
- persistence design
- capacity integration
- audit/provenance strategy

---

## Phase 2 — Fixture/Simulated Provider

Goal:

Prove the orchestration model without hardware.

Example acceptance test:

```text
input physical cards = 300
target = 263

result:
263 session cards
37 untouched/overflow as designed
```

Recognition failures must not alter the count.

---

## Phase 3 — Image Batch Provider

Support real image inputs.

Examples:

```text
one image → one card
one image → multiple cards
phone image → normalized crops
```

---

## Phase 4 — Canonical image pipeline

Examples:

- card detection
- crop
- perspective correction
- orientation
- normalization
- quality metrics
- thumbnails

---

## Phase 5 — Local catalog / exact-print recognition

Examples:

- Scryfall bulk/catalog strategy
- OCR engine abstraction
- card-name region
- collector-information region
- set/collector/language normalization
- deterministic printing resolver
- confidence/review gates

---

## Phase 6 — Review workflow

Examples:

- proposed printing
- evidence display
- manual printing search
- unknown finish
- keyboard workflow
- overflow handling

---

## Phase 7 — Transactional inventory commit

Examples:

- capacity revalidation
- inventory quantity update
- audit records
- commit provenance
- idempotency
- rollback/error handling

---

## Phase 8 — Windows Capture Agent

Examples:

- pairing/authentication
- server communication
- local spool/retry
- scanner enumeration
- diagnostic output
- provider event transport

---

## Phase 9 — Virtual TWAIN Proof of Concept

Use a software TWAIN source where practical.

Goal:

prove real acquisition behavior before physical hardware.

---

## Phase 10 — fi-6130Z hardware validation

Install the actual driver stack.

Run the predefined validation matrix.

Determine:

```text
best image profile
card feed reliability
multifeed configuration
stop-at-N behavior
physical overscan behavior
```

---

## Phase 11 — Hardening

Examples:

- cleanup
- recovery
- diagnostics
- performance
- documentation
- deployment
- security
- artifact lifecycle

---

## Phase 12 — Optional scanner-family validation

Later test:

```text
fi-7160
fi-8170
```

using the same corpus and metrics.

---

# 30. Proof-of-concept gates

Create clear gates so future work does not proceed blindly.

Examples:

### Gate A — domain model proven

Fixture provider correctly models artifacts vs physical cards.

### Gate B — capacity logic proven

300 simulated cards with target 263 produces exactly 263 commit-eligible physical cards.

### Gate C — image pipeline proven

Representative phone images become correct canonical card images.

### Gate D — recognition proven

Exact printing resolution reaches agreed precision on a controlled corpus.

Prefer precision over automatic recognition rate.

### Gate E — transactional commit proven

Capture session can safely create/update inventory with complete audit provenance.

### Gate F — TWAIN software integration proven

Virtual TWAIN source works through the intended Windows acquisition component.

### Gate G — hardware proven

fi-6130Z successfully feeds real MTG cards and its physical stop behavior is characterized.

---

# 31. Testing strategy

The roadmap must include a thorough test strategy.

Plan for:

## Unit tests

Examples:

```text
CaptureSession state transitions
provider capability negotiation
target count calculation
remaining-capacity integration
recognition failure does not affect physical count
artifact vs physical-card counting
event idempotency
provider replay
overflow
cancellation
commit idempotency
capacity race
printing resolver
confidence rules
```

## Integration tests

Examples:

```text
FixtureProvider
→ CaptureSession
→ candidates
→ mocked recognition
→ review
→ commit
→ inventory
→ audit
```

and:

```text
ImageBatch
→ multi-card image
→ detection
→ canonical cards
→ recognition
```

and eventually:

```text
Capture Agent
→ actual TWAIN DSM
→ virtual source
→ transferred artifacts
→ CaptureSession
```

## E2E / Playwright

Eventually test:

```text
create session
select destination
calculate remaining capacity
upload image batch
process
review ambiguous card
commit
verify inventory
verify audit trail
```

Fit this into the repository's existing test/verification conventions.

---

# 32. Recognition fixture corpus

Plan a reusable fixture corpus containing representative MTG cards such as:

```text
modern card
old-frame card
borderless
showcase
extended art
basic land
token
double-faced card
non-English card
dark card
light card
rotated image
perspective image
blurred image
glare
partially cropped
unreadable
multiple-card phone photo
duplex front/back pair
```

Keep large/private image fixtures outside ordinary Git history if appropriate.

Commit manifests/expected outcomes so testing remains reproducible.

---

# 33. Security considerations

Plan security for any local capture agent and artifact-upload system.

Consider:

- authenticated agent pairing
- scoped credentials
- session ownership
- upload size limits
- MIME validation
- path traversal prevention
- retry/replay protection
- event idempotency
- credential expiration/revocation
- diagnostics redaction
- artifact authorization

Do not implement these during this planning task.

---

# 34. Observability

The plan should include structured diagnostics/logging from the beginning.

Useful fields may include:

```text
timestamp
session ID
provider run ID
event sequence
physical card sequence
artifact ID
provider
device
state transition
error/status
recognition result
stop reason
```

For TWAIN eventually record enough information to diagnose:

```text
DSM
source
capabilities
requested settings
actual settings
transfer begin/end
front/back pairing
pending transfers
stop timing
condition/status code
source exhaustion
```

---

# 35. Database migration strategy

Do NOT create the migrations now.

Instead, the plan should describe:

- likely new persistent concepts
- relationships
- indexes
- migration ordering
- backward compatibility
- artifact-storage linkage
- status/state representation
- cleanup behavior

Do not commit to the exact database schema from the attached report unless repository inspection confirms it is appropriate.

---

# 36. Dependency policy

This planning task must NOT install speculative dependencies.

Do not add:

- TWAIN packages
- OpenCV
- Tesseract
- OCR libraries
- scanner SDKs
- image-processing libraries

merely because the roadmap may use them later.

Document candidate technologies and evaluation criteria.

Actual dependency selection belongs to the relevant implementation milestone.

---

# 37. Treat the attached report correctly

The attached research/design report contains:

- architecture suggestions
- potential schemas
- proposed interfaces
- possible folder structures
- possible Windows-agent design
- TWAIN implementation suggestions
- recognition strategies
- testing ideas
- hardware-validation ideas
- source documentation

Use it to understand the feature deeply.

But:

### DO NOT

blindly create every proposed:

```text
file
directory
model
class
API
library
schema
service
```

### DO

compare each proposal against the actual repository and decide:

```text
reuse existing system
adapt proposal
replace proposal
defer proposal
reject proposal
```

Document important deviations and why.

---

# 38. Project-planning output

Use the repository's established project-management conventions.

Depending on what already exists, this may mean:

- roadmap document
- implementation-plan document
- backlog entries
- TODO sections
- GitHub issues
- milestones
- architecture document
- ADR
- some combination

Do not invent a second project-management system if one already exists.

If appropriate, preserve the full research/design report under a reference/documentation location, but only if doing so matches repository conventions.

The **roadmap itself should be shorter and actionable**.

The large design report should serve as reference material behind the roadmap.

---

# 39. Status of this initiative

Mark this feature clearly as something equivalent to:

```text
PLANNED
NOT STARTED
DEFERRED UNTIL CURRENT BUGFIX WORK IS COMPLETE
```

Do not make it the next active implementation task automatically.

---

# 40. No implementation during this task

This is critical.

Do NOT:

- add production feature code
- add Prisma models/migrations
- install dependencies
- add scanner packages
- implement OCR
- create CaptureSession APIs
- build UI
- create the Windows Capture Agent
- implement TWAIN
- add OpenCV
- alter production Docker configuration
- begin scanner integration

unless a tiny documentation-only change is required by the repository's normal planning workflow.

The deliverable is a **high-quality implementation plan**, not the feature.

---

# 41. Final deliverable

At the end of this task, report:

## A. Repository findings

Summarize the existing systems that are relevant to this project.

Especially identify reusable:

```text
inventory logic
storage capacity
audit systems
import/review architecture
Scryfall infrastructure
file storage
testing
deployment
authentication
```

---

## B. Planning artifacts changed

List exactly which:

```text
documents
roadmap entries
issues
milestones
architecture docs
```

were added or updated.

---

## C. Final milestone structure

Give me the planned phases and dependencies in implementation order.

Each milestone should include:

- purpose
- prerequisites
- implementation scope
- explicit non-goals
- acceptance criteria
- tests
- risks/unknowns
- hardware requirements
- proof-of-concept gate

The tasks should be small enough that later Codex sessions can execute individual milestones without rereading the entire research report.

---

## D. Architectural decisions

List the major architectural decisions captured in the plan.

Examples:

```text
provider-neutral acquisition
CaptureSession
artifact ≠ physical card
session-level capacity targeting
transactional commit
local scanner agent
canonical card image
local printing resolver
```

Use the actual decisions made after repository inspection.

---

## E. Deviations from the research report

Explicitly identify recommendations you changed because the real MTG-Archive architecture suggests a better solution.

For example:

```text
Report suggested X.
Repository already has Y.
Plan will therefore reuse Y and adapt X.
```

This is desirable.

Do not treat deviation from the report as a failure.

---

## F. Open architectural questions

Identify decisions that should be made immediately before implementation.

Separate:

### Must resolve before implementation

from:

### Can safely defer until later milestone

Do not manufacture decisions that are unnecessary now.

---

## G. Pre-hardware boundary

Clearly identify:

### Can be completed before owning the fi-6130Z

and:

### Requires physical scanner

The plan should maximize the former.

---

## H. Recommended eventual first implementation task

Tell me the smallest, safest first implementation task to begin **when I explicitly decide to start this feature later**.

It should probably involve the CaptureSession/domain/provider foundation or FixtureProvider rather than TWAIN hardware.

Do not begin that task now.

---

# 42. Primary design principles to preserve

Unless repository inspection reveals a compelling technical reason otherwise, preserve these principles:

1. **Build card acquisition, not scanner integration.**
2. **Providers acquire; downstream systems interpret.**
3. **Artifacts are not physical cards.**
4. **Physical-card count is independent of recognition success.**
5. **Capacity targeting belongs to CaptureSession.**
6. **Providers advertise capabilities instead of pretending to behave identically.**
7. **Canonical card images isolate recognition from acquisition source.**
8. **Recognition should favor correctness over aggressive auto-accept.**
9. **Review precedes inventory mutation.**
10. **Commit is transactional and idempotent.**
11. **Reuse existing MTG-Archive inventory, capacity, review, audit, and Scryfall infrastructure.**
12. **Scanner/TWAIN code stays isolated.**
13. **Most of the feature should be testable before hardware exists.**
14. **Future camera/mobile/hopper workflows should not require redesigning recognition and inventory systems.**
15. **Do not overengineer future providers now.**

---

# 43. Reference report

The detailed Card Acquisition Framework research/design report is provided with this task.

Use it as supporting design material.

Do not treat proposed implementation details inside it as mandatory unless they make sense after inspecting the actual repository.

Begin by inspecting the repository and determining how this project should fit into MTG-Archive's existing architecture and project pipeline.

Again:

# PLANNING ONLY. DO NOT IMPLEMENT THE FEATURE YET.