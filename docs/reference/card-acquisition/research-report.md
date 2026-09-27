# MTG-Archive CaptureSession and CaptureProvider Implementation Plan

MTG-Archive should implement this as a **provider-neutral card acquisition subsystem**, not as a Fujitsu-specific scanner feature: a physical document scanner, uploaded phone photos, a webcam, a future motorized hopper, and a mobile scanner should all converge on the same `CaptureSession → PhysicalCardCandidate → RecognitionResult → Review → Commit` pipeline. Most of the risk can be retired **before buying a scanner** by building deterministic fixture and image-batch providers, implementing exact-printing recognition against MTG-Archive's local Scryfall catalog, and exercising real TWAIN state transitions against the TWAIN Working Group's software-only virtual scanner. citeturn8view1turn12search0 The one architectural addition I strongly recommend after inspecting the current MTG-Archive repository is a small **Windows Capture Agent** for TWAIN/PaperStream: MTG-Archive is currently a Dockerized Next.js application, while PaperStream/TWAIN is a native Windows acquisition stack, so scanner control should not be embedded in the web container. fileciteturn19file0 The resulting foundation should let the fi-6130Z or fi-7160 become only one provider among several, while preserving exact-capacity scanning as a session-level business rule rather than a scanner-specific trick.

## Architecture, scope, and design constraints

I inspected the current `sefaction/MTG-Archives` repository before laying this out. MTG-Archive already has several pieces we should deliberately reuse rather than recreate: Next.js/React/TypeScript, Prisma/PostgreSQL, an established test/Playwright pipeline, persisted import/review workflows, inventory audit logging, configurable storage layouts with capacities, and a cache-first Scryfall integration. fileciteturn15file0 fileciteturn9file0 The `Card` model is already a printing-level Scryfall catalog record with `scryfallId`, set code, collector number, language, image data, finishes, card faces, and raw Scryfall JSON; the repo's Scryfall notes explicitly say that a full streaming bulk import has been deliberately deferred until there is a reason to implement it. **This feature is that reason.** fileciteturn11file0 fileciteturn8file0

The repository also already has capacity calculations. `StorageLayout` supports both overall and per-section capacities, and `remainingStorageSpace()` computes remaining room against current quantities. The capture subsystem should call into that logic through a thin `DestinationCapacityService`; it should not invent a second notion of box capacity. fileciteturn16file0

**Goals**

| Goal | Required outcome |
|---|---|
| Provider neutrality | No downstream recognition/inventory code knows whether an image came from TWAIN, a phone, a folder, webcam, or hopper. |
| Exact physical counting | Count **physical cards acquired**, not successfully recognized cards and not image files. |
| Exact-capacity workflow | A session can target the remaining capacity of a location/section and stop or logically truncate according to provider capabilities. |
| Exact-printing recognition | Prefer set code + collector number + language + card name over name-only recognition. |
| Offline-first | Image processing and routine resolution use local files and PostgreSQL/Scryfall bulk data; normal scanning does not require per-card Internet calls. |
| Recoverability | Capture, recognition, review, and commit are distinct persistent phases. Browser refresh or worker restart does not destroy a batch. |
| Auditability | Every committed physical card can be traced back to its capture session, recognition decision, and inventory mutation. |
| Testability without hardware | Fixture, image-batch, and virtual TWAIN tests validate most of the software before purchasing a scanner. |

**Non-goals for the first release**

Do not build foil-detection AI, card-condition grading, automated market valuation, a full mobile application, webcam live scanning, hopper motor control, image-art embedding matching, or a general-purpose family-photo archival application. Do not require the fi-6130Z or fi-7160 to finish the core feature. Do not automatically choose a printing from only a fuzzy card-name match. MTG-Archive's existing import architecture is deliberately conservative about exact printing selection, and the capture workflow should preserve that invariant. fileciteturn8file0

The fundamental model should be:

```text
                    CaptureSession
                          │
                          ▼
                    CaptureProvider
                          │
       ┌──────────────────┼───────────────────┐
       │                  │                   │
       ▼                  ▼                   ▼
 FixtureProvider   ImageBatchProvider    TwainProvider
                                              │
                                     Windows Capture Agent
                                              │
                                           TWAIN DSM
                                              │
                                        PaperStream IP
                                              │
                                     fi-6130Z / fi-7160

                          │
                          ▼
                    CaptureArtifact
                    raw image/frame
                          │
                          ▼
                       Detector
                          │
            ┌─────────────┴─────────────┐
            │                           │
       one artifact               one artifact
        one card                  several cards
            │                           │
            └─────────────┬─────────────┘
                          ▼
                 PhysicalCardCandidate
                          │
              one or more observations
                          │
                          ▼
                   Canonical Card Image
                          │
                          ▼
                       OCR
                          │
                          ▼
                Exact-Printing Resolver
                          │
                   Local Card Catalog
                          │
             ┌────────────┴────────────┐
             ▼                         ▼
         Auto-accept                  Review
             │                         │
             └────────────┬────────────┘
                          ▼
                  CommitTransaction
                          │
                          ▼
                       Inventory
```

The most important invariant is:

> **An artifact is not a physical card.**

A duplex ADF can produce two artifacts for one physical card. A six-card phone photograph can produce one artifact for six physical cards. A webcam can contribute ten frames to one physical card. Therefore, capacity counting belongs to `PhysicalCardCandidate`, not `CaptureArtifact`.

A second invariant is:

> **Recognition failure does not reduce the physical-card count.**

If card 99 of 263 cannot be identified, it still occupies one slot in the destination box.

The third invariant is:

> **Target count belongs to the session, not the scanner.**

Never expose business logic such as `fi6130.scan(263)`. The domain model says `session.targetPhysicalCount = 263`; the provider advertises how accurately it can enforce that target.

For the repo layout, I would start Codex with:

```text
lib/
  capture/
    types.ts
    provider.ts
    state-machine.ts
    session-service.ts
    target-policy.ts
    artifact-store.ts
    candidate-service.ts
    capacity-service.ts
    commit-service.ts

    providers/
      fixture-provider.ts
      image-batch-provider.ts
      twain-agent-provider.ts

    recognition/
      types.ts
      preprocessing.ts
      detector.ts
      ocr-engine.ts
      resolver.ts
      confidence.ts
      scryfall-index.ts
      normalization.ts

app/
  captures/
    page.tsx
    [sessionId]/
      page.tsx

  api/
    captures/
      ...
    capture-agents/
      ...

components/
  capture/
    CaptureSessionWizard.tsx
    CaptureProgressPanel.tsx
    CaptureReviewGrid.tsx
    CandidateResolver.tsx
    CaptureDiagnostics.tsx

tests/
  capture-provider.test.ts
  capture-session.test.ts
  capture-target.test.ts
  capture-recognition.test.ts
  capture-commit.test.ts
  capture-agent-protocol.test.ts

capture-agent/
  MTGArchive.CaptureAgent.sln
  src/
  tests/
```

The Windows agent is necessary because the production web process is currently a Docker service with persistent application data mounted into the container. A USB scanner attached to a user's Windows workstation should not be assumed visible to that Linux/containerized process. fileciteturn19file0 More importantly, Ricoh's PaperStream IP is a standard TWAIN/ISIS Windows scanner driver, while the TWAIN DSM mediates native applications and TWAIN data sources. citeturn8view2turn13search0

I recommend **an outbound agent protocol rather than browser → `localhost` scanner control**:

```text
Windows PC                            MTG-Archive
┌──────────────────┐                 ┌───────────────────┐
│ Capture Agent    │                 │ Docker / Next.js  │
│                  │                 │                   │
│ TWAIN/PaperStream│                 │ CaptureSession DB │
│       │          │                 │                   │
│    scanner       │                 │ Recognition       │
│                  │                 │ Review / Commit   │
└────────┬─────────┘                 └────────┬──────────┘
         │                                    │
         │ authenticated long-poll/HTTPS      │
         ├───────────────────────────────────►│
         │  "start session, target = 263"     │
         │◄───────────────────────────────────┤
         │                                    │
         │ multipart artifacts + events       │
         ├───────────────────────────────────►│
         │                                    │
```

That avoids browser CORS/mixed-content/loopback issues, works when MTG-Archive is hosted on another machine such as an Unraid server, and—critically—allows the **agent itself** to enforce `target=263` without a network round-trip after every card.

## Capture contracts and persistent data model

I would use **`CaptureSession` as the canonical code/database name**. The requested `ScanSession` concept is represented by that model, but naming the database model `ScanSession` would reintroduce the scanner-specific assumption we're deliberately removing.

The provider contract should be small enough that future providers do not have to fake scanner behavior:

```ts
// lib/capture/provider.ts

export type TargetEnforcement =
  | "EXACT_BEFORE_NEXT_ITEM"
  | "BEST_EFFORT_STOP"
  | "SOFTWARE_TRUNCATE"
  | "NONE";

export interface CaptureCapabilities {
  batchInput: boolean;
  streamingInput: boolean;

  duplex: boolean;
  feeder: boolean;

  nativePhysicalItemBoundaries: boolean;
  multiCardArtifactPossible: boolean;

  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canCancel: boolean;

  canEnumerateDevices: boolean;
  canConfigureResolution: boolean;
  canConfigureColorMode: boolean;
  canSuppressVendorUi: boolean;

  nativeMultifeedDetection: boolean;
  deviceCounters: boolean;

  targetEnforcement: TargetEnforcement;
}

export interface CaptureProviderDescriptor {
  id: string;             // e.g. "fixture", "image-batch", "twain-agent"
  displayName: string;
  version: string;
}

export interface CaptureDevice {
  id: string;
  displayName: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  metadata?: Record<string, unknown>;
}

export interface CaptureConfig {
  sessionId: string;
  deviceId?: string;

  targetPhysicalCount?: number;
  targetPolicy: "EXACT" | "UP_TO" | "UNBOUNDED";

  duplex?: boolean;
  resolutionDpi?: number;
  colorMode?: "COLOR" | "GRAYSCALE" | "MONOCHROME";

  showVendorUi?: boolean;

  providerOptions?: Record<string, unknown>;
}

export interface CaptureProviderContext {
  userId: string;
  sessionId: string;
  config: CaptureConfig;
  artifactSink: CaptureArtifactSink;
}

export interface PreparedCapture {
  providerRunId: string;
  config: CaptureConfig;
  capabilities: CaptureCapabilities;
}

export interface CaptureRunSummary {
  providerRunId: string;
  physicalItemsCompleted: number;
  artifactsReceived: number;
  overflowItems: number;
  stopReason:
    | "SOURCE_EXHAUSTED"
    | "TARGET_REACHED"
    | "USER_STOP"
    | "CANCELLED"
    | "ERROR";
}

export interface CaptureProvider {
  readonly descriptor: CaptureProviderDescriptor;

  getCapabilities(signal?: AbortSignal): Promise<CaptureCapabilities>;

  discoverDevices?(signal?: AbortSignal): Promise<CaptureDevice[]>;

  validateConfig(
    config: CaptureConfig,
  ): Promise<{ valid: boolean; errors: string[]; warnings: string[] }>;

  prepare(
    context: CaptureProviderContext,
    signal?: AbortSignal,
  ): Promise<PreparedCapture>;

  start(
    prepared: PreparedCapture,
    sink: CaptureEventSink,
    signal: AbortSignal,
  ): Promise<CaptureRunSummary>;

  pause?(providerRunId: string): Promise<void>;
  resume?(providerRunId: string): Promise<void>;

  requestStop(
    providerRunId: string,
    reason: "TARGET_REACHED" | "USER_REQUEST" | "CAPACITY_CHANGED",
  ): Promise<void>;

  cancel(providerRunId: string, reason: string): Promise<void>;

  getDiagnostics?(): Promise<ProviderDiagnostics>;
}
```

Events should be a discriminated union with monotonically increasing provider event sequence numbers:

```ts
export type CaptureEvent =
  | { type: "provider.ready"; sequence: number; at: string }
  | { type: "capture.started"; sequence: number; at: string }
  | {
      type: "artifact.received";
      sequence: number;
      at: string;
      artifact: CaptureArtifactDescriptor;
    }
  | {
      type: "physical-item.started";
      sequence: number;
      at: string;
      providerPhysicalId: string;
    }
  | {
      type: "physical-item.completed";
      sequence: number;
      at: string;
      providerPhysicalId: string;
      physicalSequence: number;
    }
  | {
      type: "target.reached";
      sequence: number;
      at: string;
      count: number;
    }
  | { type: "source.exhausted"; sequence: number; at: string }
  | { type: "capture.paused"; sequence: number; at: string }
  | { type: "capture.resumed"; sequence: number; at: string }
  | { type: "capture.stopping"; sequence: number; at: string }
  | {
      type: "capture.completed";
      sequence: number;
      at: string;
      summary: CaptureRunSummary;
    }
  | { type: "capture.cancelled"; sequence: number; at: string }
  | {
      type: "warning";
      sequence: number;
      at: string;
      code: string;
      message: string;
      details?: unknown;
    }
  | {
      type: "error";
      sequence: number;
      at: string;
      code: string;
      message: string;
      recoverable: boolean;
      details?: unknown;
    };
```

Every provider event must carry a unique idempotency identity such as:

```text
(sessionId, providerRunId, sequence)
```

so retries cannot create duplicate physical candidates.

The session state machine should be explicit:

```text
DRAFT
  ↓
PREPARING
  ↓
CAPTURING ←→ PAUSED
  ↓
PROCESSING
  ↓
┌───────────────────┐
│                   │
▼                   ▼
REVIEW_REQUIRED   READY_TO_COMMIT
│                   │
└─────────┬─────────┘
          ▼
      COMMITTING
          ↓
       COMMITTED

Any non-committed state:
   → FAILED
   → CANCELLED
```

A committed session is immutable except for administrative annotations. Never rerun recognition or capture against it.

The data model should add the five requested first-class concepts plus two supporting relational records: `CaptureObservation` to solve N-images↔N-cards relationships, and `CommitTransactionItem` to preserve candidate→inventory mutation traceability.

**`ScanSession` / canonical `CaptureSession` JSON schema:**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CaptureSession",
  "type": "object",
  "required": [
    "id",
    "ownerUserId",
    "providerType",
    "status",
    "targetPolicy",
    "acquiredPhysicalCount",
    "createdAt"
  ],
  "properties": {
    "id": { "type": "string" },
    "ownerUserId": { "type": "string" },
    "providerType": {
      "enum": ["FIXTURE", "IMAGE_BATCH", "TWAIN", "CAMERA", "HOPPER", "MOBILE"]
    },
    "providerInstanceId": { "type": ["string", "null"] },
    "status": {
      "enum": [
        "DRAFT",
        "PREPARING",
        "CAPTURING",
        "PAUSED",
        "PROCESSING",
        "REVIEW_REQUIRED",
        "READY_TO_COMMIT",
        "COMMITTING",
        "COMMITTED",
        "FAILED",
        "CANCELLED"
      ]
    },
    "destinationLocationId": { "type": ["string", "null"] },
    "destinationSection": { "type": ["string", "null"] },
    "targetPolicy": { "enum": ["EXACT", "UP_TO", "UNBOUNDED"] },
    "targetPhysicalCount": { "type": ["integer", "null"], "minimum": 1 },
    "targetSource": {
      "enum": ["MANUAL", "DESTINATION_REMAINING", "UNBOUNDED"]
    },
    "destinationCapacityAtStart": { "type": ["integer", "null"] },
    "destinationQuantityAtStart": { "type": ["integer", "null"] },
    "acquiredPhysicalCount": { "type": "integer", "minimum": 0 },
    "recognizedCount": { "type": "integer", "minimum": 0 },
    "reviewCount": { "type": "integer", "minimum": 0 },
    "overflowCount": { "type": "integer", "minimum": 0 },
    "config": { "type": "object" },
    "defaults": {
      "type": "object",
      "properties": {
        "condition": { "type": ["string", "null"] },
        "language": { "type": ["string", "null"] },
        "finish": { "type": ["string", "null"] }
      }
    },
    "createdAt": { "type": "string", "format": "date-time" },
    "startedAt": { "type": ["string", "null"], "format": "date-time" },
    "captureCompletedAt": {
      "type": ["string", "null"],
      "format": "date-time"
    },
    "committedAt": { "type": ["string", "null"], "format": "date-time" }
  }
}
```

**`CaptureArtifact`:**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CaptureArtifact",
  "type": "object",
  "required": [
    "id",
    "sessionId",
    "providerArtifactId",
    "providerSequence",
    "sha256",
    "mimeType",
    "storagePath"
  ],
  "properties": {
    "id": { "type": "string" },
    "sessionId": { "type": "string" },
    "providerArtifactId": { "type": "string" },
    "providerSequence": { "type": "integer", "minimum": 0 },
    "sourceRole": {
      "enum": ["FRONT", "BACK", "UNKNOWN", "MULTI_CARD", "VIDEO_FRAME"]
    },
    "sha256": { "type": "string" },
    "mimeType": { "type": "string" },
    "width": { "type": ["integer", "null"] },
    "height": { "type": ["integer", "null"] },
    "dpi": { "type": ["number", "null"] },
    "storagePath": { "type": "string" },
    "capturedAt": { "type": ["string", "null"], "format": "date-time" },
    "metadata": { "type": "object" }
  }
}
```

Do **not** store the binary image itself in PostgreSQL. Store file metadata, hash, and a safe relative storage key. Add a dedicated `CAPTURE_DATA_PATH` volume analogous to the existing uploads/imports/Scryfall volumes. fileciteturn19file0 Suggested structure:

```text
/capture-data/
  <session-id>/
    raw/
      <artifact-id>.jpg
    canonical/
      <candidate-id>-front.jpg
      <candidate-id>-back.jpg
    thumbs/
      <candidate-id>.webp
    diagnostics/
```

**`PhysicalCardCandidate`:**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "PhysicalCardCandidate",
  "type": "object",
  "required": [
    "id",
    "sessionId",
    "physicalSequence",
    "status",
    "overflow"
  ],
  "properties": {
    "id": { "type": "string" },
    "sessionId": { "type": "string" },
    "providerPhysicalId": { "type": ["string", "null"] },
    "physicalSequence": { "type": "integer", "minimum": 1 },
    "status": {
      "enum": [
        "CAPTURED",
        "PROCESSING",
        "AUTO_RESOLVED",
        "REVIEW_REQUIRED",
        "RESOLVED",
        "SKIPPED",
        "COMMITTED",
        "ERROR"
      ]
    },
    "overflow": { "type": "boolean" },
    "canonicalFrontArtifactId": { "type": ["string", "null"] },
    "canonicalBackArtifactId": { "type": ["string", "null"] },
    "selectedRecognitionResultId": { "type": ["string", "null"] },
    "finish": {
      "enum": ["NONFOIL", "FOIL", "ETCHED", "UNKNOWN"]
    },
    "condition": { "type": ["string", "null"] },
    "languageOverride": { "type": ["string", "null"] },
    "quality": { "type": "object" }
  }
}
```

`CaptureObservation` then maps candidate→artifact and contains the crop polygon, side, frame quality, and perspective-transform metadata. This is what allows one phone photograph to spawn six candidates and one webcam card to have several observations.

**`RecognitionResult`:**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "RecognitionResult",
  "type": "object",
  "required": [
    "id",
    "candidateId",
    "engineVersion",
    "decision",
    "confidence",
    "signals"
  ],
  "properties": {
    "id": { "type": "string" },
    "candidateId": { "type": "string" },
    "engineVersion": { "type": "string" },
    "decision": {
      "enum": ["AUTO_ACCEPT", "REVIEW", "NO_MATCH", "MANUAL"]
    },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "selectedCardId": { "type": ["string", "null"] },
    "selectedScryfallId": { "type": ["string", "null"] },
    "ocr": {
      "type": "object",
      "properties": {
        "name": { "type": ["string", "null"] },
        "setCode": { "type": ["string", "null"] },
        "collectorNumber": { "type": ["string", "null"] },
        "language": { "type": ["string", "null"] }
      }
    },
    "signals": { "type": "array", "items": { "type": "object" } },
    "candidateMatches": { "type": "array", "items": { "type": "object" } },
    "contradictions": { "type": "array", "items": { "type": "string" } },
    "manuallyConfirmedByUserId": { "type": ["string", "null"] },
    "manuallyConfirmedAt": {
      "type": ["string", "null"],
      "format": "date-time"
    }
  }
}
```

Never overwrite old recognition attempts. Reprocessing should append a new result and update the candidate's selected result. That makes recognition-algorithm changes diagnosable.

**`CommitTransaction`:**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CommitTransaction",
  "type": "object",
  "required": [
    "id",
    "sessionId",
    "idempotencyKey",
    "status",
    "candidateCount"
  ],
  "properties": {
    "id": { "type": "string" },
    "sessionId": { "type": "string" },
    "idempotencyKey": { "type": "string" },
    "status": {
      "enum": ["PREPARING", "COMMITTING", "COMMITTED", "FAILED", "ROLLED_BACK"]
    },
    "candidateCount": { "type": "integer", "minimum": 0 },
    "inventoryMutationCount": { "type": "integer", "minimum": 0 },
    "auditRecordCount": { "type": "integer", "minimum": 0 },
    "capacitySnapshot": { "type": "object" },
    "startedAt": { "type": "string", "format": "date-time" },
    "completedAt": { "type": ["string", "null"], "format": "date-time" },
    "error": { "type": ["object", "null"] }
  }
}
```

A supporting `CommitTransactionItem` should record:

```text
candidateId
recognitionResultId
cardId
inventoryItemId
mutationType = CREATED | QUANTITY_INCREMENTED
beforeQuantity
afterQuantity
auditLogId
```

The current schema already groups physical duplicates by `InventoryItem.quantity` and tracks before/after effects in import records, while the import workspace explicitly cares about conservation of physical copies. Capture should follow the same semantics rather than creating one `InventoryItem` database row per physical card. fileciteturn14file0 fileciteturn9file0

## Providers and target enforcement

The providers should differ in acquisition behavior but produce the same events and artifacts.

| Provider | Physical boundary | Duplex | Streaming | Device control | Target enforcement | MVP? |
|---|---|---:|---:|---:|---|---:|
| `FixtureProvider` | Native/scripted | Configurable | Yes | Simulated | **EXACT_BEFORE_NEXT_ITEM** | **Yes** |
| `ImageBatchProvider` | Detection-derived | No | No | N/A | **SOFTWARE_TRUNCATE** | **Yes** |
| `TwainProvider` | Scanner sheet | Yes | Yes | Yes | **BEST_EFFORT_STOP** until hardware proves stronger | **Yes** |
| `CameraProvider` | Detection/stability-derived | No | Yes | Camera only | Software target | Future |
| `HopperProvider` | Motor/gate-native | Optional | Yes | Full | **EXACT_BEFORE_NEXT_ITEM** | Future |
| Mobile sync | App-derived | No | Yes/batch | Phone camera | Software target | Future |

**FixtureProvider**

This is not throwaway test code. It becomes the reference implementation for every state transition.

It should support a manifest such as:

```json
{
  "provider": "fixture",
  "duplex": true,
  "latencyMs": 20,
  "items": [
    {
      "id": "card-001",
      "front": "adf-duplex/0001-front.jpg",
      "back": "adf-duplex/0001-back.jpg"
    },
    {
      "id": "card-002",
      "front": "adf-duplex/0002-front.jpg",
      "back": "adf-duplex/0002-back.jpg"
    }
  ],
  "faults": [
    {
      "afterPhysicalItem": 17,
      "type": "RECOVERABLE_FEED_ERROR"
    }
  ]
}
```

It must be able to simulate latency, duplex, feeder exhaustion, recoverable errors, duplicate/retried events, out-of-order artifact delivery, cancellation, overflow, and an input set larger than the session target.

**Acceptance:** Feed 300 fixture cards into a target-263 session. Exactly 263 candidates are eligible for commit, 37 are untouched/overflow according to fixture policy, recognition success has no effect on the count, duplicate provider events do not produce duplicate candidates, and restarting the session processor from persisted state does not alter the answer.

**ImageBatchProvider**

This accepts drag/drop, file picker, or API uploads:

```text
JPEG
PNG
WebP
HEIC → convert or reject clearly in first release
```

Provider responsibilities end after safely persisting source artifacts. **Card detection belongs downstream**, so the provider does not need Magic-specific knowledge.

For the first usable version support:

```text
one file → one card
one file → multiple detected cards
```

The multi-card case should create multiple `CaptureObservation` crops from the same parent artifact.

ImageBatch target behavior should be explicit. If 50 phone photographs yield 300 card candidates but the destination needs 263, the provider cannot "un-take" a photograph. Therefore:

```text
candidate 1..263  → normal session cards
candidate 264..300 → overflow/unassigned
```

Never delete overflow; let the user move it into a new session.

**TWAINProvider**

This should actually be `TwainAgentProvider` on the server, delegating hardware access to the Windows Capture Agent.

Ricoh's current PaperStream IP documentation lists both the **fi-6130Z and fi-7160** among supported discontinued devices and describes PaperStream IP as compatible with standard TWAIN applications. citeturn8view2 The TWAIN Working Group's Data Source Manager is explicitly available in 32- and 64-bit forms and is the mediator between TWAIN applications and scanner/camera data sources. citeturn13search0turn13search7

For the first agent spike I would build **x86 first**, even on 64-bit Windows. Ricoh explicitly states that PaperStream driver choice follows the **application's bitness**: a 32-bit application uses PaperStream IP (TWAIN), whereas a 64-bit application uses PaperStream IP (TWAIN x64). citeturn9search0 This keeps scanner integration isolated enough that adding an x64 agent later is trivial.

Agent protocol:

```text
POST /api/capture-agents/pair
POST /api/capture-agents/{agentId}/heartbeat

GET  /api/capture-agents/{agentId}/commands
     ?cursor=<last-command>
     &wait=25

POST /api/capture-agents/{agentId}/events

POST /api/captures/{sessionId}/artifacts
     multipart/form-data
```

`START_CAPTURE` should contain everything necessary for local target enforcement:

```json
{
  "commandId": "cmd_...",
  "type": "START_CAPTURE",
  "sessionId": "cap_...",
  "deviceId": "paperstream-source-id",
  "targetPhysicalCount": 263,
  "targetPolicy": "EXACT",
  "settings": {
    "duplex": true,
    "resolutionDpi": 300,
    "colorMode": "COLOR",
    "showVendorUi": false
  }
}
```

The agent maintains:

```text
completedPhysicalItems = 0

sheet complete:
    completedPhysicalItems++

    upload/artifact events

    if completedPhysicalItems == target:
        request local TWAIN stop
```

It must not depend on the MTG server responding between cards.

For the .NET TWAIN backend, keep an interface:

```csharp
public interface ITwainBackend
{
    IReadOnlyList<TwainDevice> EnumerateSources();
    TwainCapabilities ReadCapabilities(string sourceId);

    Task<TwainRunResult> AcquireAsync(
        TwainAcquireOptions options,
        ITwainEventSink sink,
        CancellationToken cancellationToken);

    Task RequestStopAsync();
}
```

Do not let NTwain, direct DSM P/Invoke, or any other library type escape that boundary. The official NuGet registry currently shows NTwain as an actively published TWAIN .NET package, while the TWAIN Working Group itself provides the DSM and sample implementation; the backend abstraction lets Codex test a wrapper without making the entire subsystem dependent on it. citeturn13search4turn13search0

**Virtual TWAIN plan**

The official `twain/twain-samples` repository is especially valuable here because it explicitly includes a **software-only virtual scanner** and sample TWAIN application/data source. citeturn8view1 Use it before any Fujitsu exists:

```text
MTG Capture Agent
      │
      ▼
TWAIN DSM
      │
      ▼
TWAIN Sample Source
   virtual scanner
```

Test, in order:

1. Enumerate the virtual source.
2. Open source.
3. Query capabilities.
4. Configure color.
5. Configure 300 DPI if exposed.
6. Enable source.
7. Acquire one image.
8. Acquire a batch.
9. Exercise pending-transfer handling.
10. Request stop during a batch.
11. Close source.
12. Repeat 100 times and confirm no process restart is needed.
13. Kill/restart agent between sessions and confirm MTG-Archive recovers.

A real TWAIN interaction must therefore be demonstrated before scanner purchase; only **PaperStream/device-specific** behavior remains unproven.

**Future providers**

`CameraProvider` should emit frames as artifacts and use a stability detector to decide when a new physical card is present. Several existing open-source MTG scanners already demonstrate webcam/photo OCR workflows, including a local Tesseract/Scryfall scanner and browser-based collector-number scanners. citeturn6search3turn6search4

`HopperProvider` should control a feeder/motor/gate and own the strongest target enforcement:

```text
if completed == target:
    DO NOT feed next card
```

That makes it `EXACT_BEFORE_NEXT_ITEM`, which is ultimately more deterministic than cancelling an ADF while the next card may already be in its transport.

`MobileProvider` should not bypass capture sessions by posting directly into inventory. A future ManaBox-style mobile UI should create or join a server `CaptureSession`, upload observations, receive recognition results, and let the normal review/commit pipeline finish the work. A recent open-source mobile/browser project illustrates that exact-printing camera workflows using name + set/collector/language are practical, although MTG-Archive should keep its own deterministic resolver rather than depend on that implementation. citeturn6search7

## Recognition, review, and inventory commit

The recognition pipeline should start with a **canonical card image**, never with a "scanner image."

```text
Raw Artifact
     │
     ▼
Decode + EXIF orientation
     │
     ▼
Card detection
     │
     ▼
Quadrilateral / card bounds
     │
     ▼
Perspective correction
     │
     ▼
Orientation normalization
     │
     ▼
Quality metrics
     │
     ▼
Canonical card image
     │
     ├───────────────┐
     ▼               ▼
 Name ROI       Metadata ROI
     │               │
     ▼               ▼
    OCR             OCR
     │               │
     └───────┬───────┘
             ▼
       Signal Normalizer
             │
             ▼
       Printing Resolver
             │
             ▼
       Local Scryfall Card
             │
       ┌─────┴─────┐
       ▼           ▼
     Auto        Review
```

OpenCV supplies standard contour, thresholding, and perspective-transformation primitives suitable for the detection/rectification stage. citeturn11search1turn11search2turn11search6 Tesseract's own documentation recommends choosing page-segmentation modes suited to small, known text regions rather than treating every input as a full page, which is exactly why the card-name and collector-info regions should be OCRed independently. citeturn10search0turn10search2

Do not lock this to Tesseract. Define:

```ts
interface OcrEngine {
  readonly version: string;

  recognize(input: {
    imagePath: string;
    region: "NAME" | "SET" | "COLLECTOR_NUMBER" | "LANGUAGE";
    languageHints?: string[];
  }): Promise<{
    text: string;
    normalizedText?: string;
    confidence?: number;
    alternatives?: Array<{
      text: string;
      confidence?: number;
    }>;
  }>;
}
```

That leaves room for Tesseract.js, native Tesseract, ONNX OCR, or another local model without touching recognition logic.

The first OCR targets are exactly the four the user requested:

| Signal | Region | Role |
|---|---|---|
| Card name | title/name band | Confirmation and fallback |
| Set code | lower metadata | Strong exact-printing key |
| Collector number | lower metadata | Strong exact-printing key |
| Language | lower metadata when printed | Printing disambiguation |

Open-source MTG scanner projects independently converge on these same kinds of signals: some use the name with Tesseract, while more exact-printing-oriented implementations emphasize collector number, set code and language before resolving through Scryfall. citeturn6search3turn6search4turn6search7turn6search9

**Preprocessing sequence**

Codex should implement processing as versioned stages:

```text
preprocessorVersion = "capture-preprocess-v1"

decode
→ strip metadata
→ normalize EXIF orientation
→ identify card rectangle(s)
→ reject implausible aspect ratios
→ perspective rectify
→ normalize long-edge orientation
→ resize canonical working copy
→ compute blur metric
→ compute clipping/glare metric
→ generate OCR ROIs
→ persist canonical + thumbnail
```

For ADF sources, the provider may assert `expectedCardsPerArtifact=1`; detection can begin with a fast "trim border / validate aspect ratio" path rather than doing expensive multi-object detection.

For phone photographs:

```text
artifact
  ↓
find candidate quadrilaterals
  ↓
filter by approximate MTG card aspect ratio
  ↓
perspective rectify each
  ↓
one PhysicalCardCandidate per card
```

Do not overfit blur/glare thresholds at first. Record the metrics from day one and derive useful thresholds from actual failures.

**Local Scryfall strategy**

This should extend the **existing `Card` table**, not create a parallel card universe. The current `Card` model is already sufficiently rich to act as a printing catalog, and the existing Scryfall service already uses local records before live requests. fileciteturn11file0 fileciteturn8file0

Implement the deferred bulk maintenance job:

```text
scripts/scryfall-bulk-refresh.ts

fetch bulk-data manifest
       ↓
download current printing dataset
       ↓
stream records
       ↓
normalize
       ↓
batch upsert Card
       ↓
record catalog refresh metadata
```

Do not fetch one Scryfall endpoint per scan. Scryfall explicitly recommends its bulk offerings when performing large numbers of simple name/collector-number lookups and asks API users to remain under 10 requests/second. citeturn12search0

The repository already has persistent Scryfall data paths and refresh configuration in Docker, so the new maintenance job should use those rather than introduce another storage root. fileciteturn19file0

Add this index:

```prisma
@@index([setCode, collectorNumber, lang])
```

alongside the existing:

```prisma
@@index([setCode, collectorNumber])
@@index([name])
```

because `set + collector + language` is the strongest routine exact-printing lookup available from OCR. fileciteturn11file0

The resolver should follow this hierarchy:

```text
A. set + collector + language
   └─ unique → compare card name for contradiction

B. set + collector
   └─ unique → verify name/language

C. exact normalized name + set
   └─ identify candidate printings

D. exact normalized name
   └─ candidate list only

E. fuzzy name
   └─ review only
```

This deliberately mirrors the conservative principles already documented for the CSV importer, which uses Scryfall ID, then set+collector, then exact name+set, and does **not** silently choose a printing from name-only ambiguity. fileciteturn8file0

**Confidence should use gates, not only an opaque weighted score.**

Recommended v1:

| Result | Required signals | Action |
|---|---|---|
| Tier A | Unique set+collector+language and no contradictory name | Auto-accept |
| Tier A | Unique set+collector plus ≥0.93 normalized name similarity and no contradiction | Auto-accept |
| Tier B | Unique set+collector but weak/unreadable name | Review-recommended |
| Tier B | Name+set gives a small candidate set | Review |
| Tier C | Name only | Review |
| Tier D | Conflicting name vs set/collector | **Never auto-accept** |
| Tier D | No credible match | Manual resolution |

Still compute a `0..1` UX score, for example:

```text
>= 0.97           visually "High confidence"
0.85–0.969        "Review recommended"
< 0.85            "Needs resolution"
```

but **contradiction rules override the numeric score**. A perfect-looking collector-number OCR pointing at `Card A` while the name OCR clearly says `Card B` must go to review even if an arithmetic formula says 0.98.

The test metric that matters most should be **auto-accept precision**, not auto-accept recall. It is acceptable to send a card to review unnecessarily. It is not acceptable to silently record the wrong printing.

**Duplicate policy**

Physical duplicates are normal inventory and must never be deduplicated by `scryfallId`.

```text
Lightning Bolt M11 #149
Lightning Bolt M11 #149
Lightning Bolt M11 #149
```

means three cards, not one capture.

Deduplication applies only to **delivery/event identity**, such as the agent retrying event `#428` after a network timeout.

Use:

```text
UNIQUE(sessionId, providerRunId, providerEventSequence)
```

for event idempotency.

An identical SHA-256 image is only a warning. Two genuinely separate copies of the same card can produce byte-identical images under a controlled scanner, so the image hash must never silently collapse physical items.

**Foil policy**

Keep foil inference out of phase one.

```text
candidate.finish =
    NONFOIL
    FOIL
    ETCHED
    UNKNOWN
```

The existing inventory model has `FoilStatus.NONFOIL | FOIL | ETCHED` and defaults to nonfoil, so capture must **not allow `UNKNOWN` to accidentally become the existing default** during commit. fileciteturn11file0

Session setup should offer:

```text
Finish policy:
○ Review each / unknown
○ Treat entire batch as nonfoil
○ Treat entire batch as foil
○ Treat entire batch as etched
```

Phase two can investigate visual foil classification. It should never be a prerequisite for useful scanning.

**Review queue UX**

Build on the interaction principles already present in `/imports`: persistent review state, explicit commit, one destination/commit area, keyboard-friendly resolution, and no inventory mutation merely because a review screen was opened. fileciteturn9file0

Recommended card review:

```text
┌──────────────────────────────────────────────────────────────┐
│ Session 2026-09-23-001                     258 / 263 resolved│
├──────────────────────────────┬───────────────────────────────┤
│                              │ Proposed                       │
│       captured image         │                               │
│                              │ Lightning Bolt                │
│                              │ M11 · #149 · EN               │
│                              │ Confidence 98.7%              │
│                              │                               │
│                              │ Name       ✓                  │
│                              │ Set        ✓ M11              │
│                              │ Collector  ✓ 149              │
│                              │ Language   ?                  │
│                              │                               │
│                              │ [Accept] [Search printing]    │
└──────────────────────────────┴───────────────────────────────┘
```

Filters:

```text
Needs review
Conflicting signals
No match
Unknown finish
Capture-quality warning
Overflow
All
```

Useful keyboard actions:

```text
Enter       accept proposed printing
S           search printing
F           finish picker
K/J         previous/next
X           skip physical card
```

Review should display **why** the match was chosen, not merely a confidence percentage.

**Commit**

The capture commit service should reuse MTG-Archive's existing inventory and audit patterns. `InventoryAuditLog` already supports bulk audit creation and arbitrary metadata; add `capture_committed` to the named actions and include `captureSessionId`, `candidateId`, and `recognitionResultId` in audit metadata. fileciteturn17file0

Commit algorithm:

```text
BEGIN TRANSACTION

1. Lock/read session.
2. Verify session is READY_TO_COMMIT.
3. Verify idempotency key has not already committed.
4. Recompute destination occupancy/capacity.
5. Reject or require user action if capacity changed.
6. Validate every non-skipped candidate:
      selected Card exists
      finish resolved
      condition resolved/defaulted
      owner/opener resolved
      location/section still valid
7. Group compatible physical copies:
      card
      owner
      opener
      condition
      foilStatus
      language
      location
      locationSection
      source semantics
8. Upsert/increment InventoryItem rows.
9. Create CommitTransactionItem records.
10. Create inventory audit entries.
11. Mark candidates COMMITTED.
12. Mark CommitTransaction COMMITTED.
13. Mark CaptureSession COMMITTED.

COMMIT
```

The important capacity race is:

```text
session started:
Row 2 remaining = 263

someone manually adds 5 cards meanwhile

commit:
Row 2 remaining = 258
```

The application must **revalidate at commit**, not trust the old snapshot. The five excess captured candidates should remain safely in review and be movable to another section; never silently overfill the modeled destination.

## Diagnostics, TWAIN testing, and real-hardware validation

The diagnostic feature is part of the product, not temporary logging. TWAIN/PaperStream failures will be much easier to solve if a user can export one deterministic bundle.

The Capture Agent diagnostic screen should show:

```text
Agent
────────────────────────
Version
OS version
Process architecture
.NET runtime
Agent ID
Server connection status

TWAIN
────────────────────────
DSM path/version
DSM architecture
Available sources
Selected source

PaperStream
────────────────────────
Source display name
Driver/application version if obtainable
Capabilities queried
Current settings

Acquisition
────────────────────────
Duplex
Resolution
Pixel type
Transfer mechanism
Show UI
Target
Completed physical items
Artifacts
Overflow
Last TWAIN status / condition code
```

Log every state transition as structured JSON lines:

```json
{
  "timestampUtc": "2026-09-23T18:21:03.844Z",
  "monotonicMs": 1193384,
  "level": "INFO",
  "sessionId": "cap_123",
  "providerRunId": "run_456",
  "component": "twain",
  "event": "image-transfer-completed",
  "twainState": 6,
  "physicalSequence": 27,
  "side": "FRONT",
  "width": 744,
  "height": 1039,
  "sha256": "..."
}
```

Capture at least:

```text
Agent startup/shutdown
TWAIN DSM load
source enumeration
source open/close
capability discovery
requested capability values
actual negotiated values
source enable/disable
transfer-ready
each image transfer begin/end
pending-transfer count if available
front/back pairing
physical-item completion
multifeed event
paper/feed errors
stop request timestamp
physical count at stop request
last transfer received
source exhausted
TWAIN return code
TWAIN condition/status code
unexpected exception
```

Add:

```text
[ Export diagnostic bundle ]
```

producing:

```text
diagnostics.zip
  agent.json
  capabilities.json
  acquisition-settings.json
  events.jsonl
  session-summary.json
  optional-thumbnails/
```

No credentials, bearer tokens, full user paths, or raw family/card images should be included unless the user explicitly checks "include sample images."

The official TWAIN sample source should be the first integration target because it is explicitly a software-only virtual scanner. citeturn8view1 The definition of "TWAIN POC complete" is not merely "device appears in a list"; it is:

```text
virtual source
  → agent discovers source
  → MTG-Archive creates session
  → agent receives START
  → source supplies images
  → artifacts reach MTG-Archive
  → physical events counted
  → target causes stop request
  → session reaches processing/review
  → no inventory modified yet
```

**Real fi-6130Z validation matrix**

Ricoh specifies that the fi-6130Z is duplex, uses two CCD sensors, offers ultrasonic multifeed detection, has a 50-sheet paper chute, scans color at 30 ppm / 60 ipm at 300 dpi, and officially supports cards up to 1.4 mm; its documentation conservatively specifies continuous scanning of up to three cards. citeturn8view3 That means YouTube/community results with much larger MTG stacks must be treated as useful experimentation rather than an official feed guarantee.

Run only sacrificial bulk cards at first.

| Test | Procedure | Record |
|---|---|---|
| Baseline counters | Read Software Operation Panel before testing | total/roller counters available |
| Single card | 20 one-card acquisitions | failures, skew, marks |
| Batch 10 | 10 batches × 10 | doubles, jams, order |
| Batch 25 | 10 batches × 25 | same |
| Batch 50 | Experimental if stable | same |
| Duplex pairing | Mark backs 1–50 | whether front/back events pair correctly |
| Stop at one | Load 5, target 1 | physical position of cards 2–5 |
| Stop at two | Load 10, target 2 | whether card 3 enters transport |
| Stop at five | Load 10, target 5 | same |
| Stop at N | Multiple values | overscan frequency |
| Multifeed | Controlled intentional double | driver/event behavior |
| 200 dpi | Known OCR corpus | OCR success/file size/time |
| **300 dpi** | Same corpus | baseline candidate |
| 400 dpi | Same corpus | marginal OCR benefit |
| 600 dpi | Same corpus | benefit vs throughput/memory |
| Auto-crop on/off | Same cards | edge loss / metadata loss |
| Rotation on/off | Same cards | correctness |
| Blank-page removal | dark/light cards | any accidental dropped face |
| Paper protection | controlled safe test | event/error behavior |
| Surface inspection | before/after macro photos | scratches/roller marks |
| Sleeve experiment | optional penny sleeves | reliability/surface behavior |

PaperStream offers auto rotation, cropping/deskew, blank-page deletion and other processing. Those features are useful for office documents but must be individually validated on card art instead of assumed safe. citeturn8view2

The fi-6130Z documentation lists the pick and brake roller replacement guidance at roughly 200,000 sheets or one year, while noting that actual cycles vary with material and cleaning. citeturn8view3 The Software Operation Panel family exposes consumable counters and lets users reset them after replacing rollers; record their state before and after the validation corpus. citeturn15search1

**fi-7160 validation**

Run **the identical corpus and test IDs**, so the comparison is meaningful.

The fi-7160 provides an 80-sheet ADF, 60 ppm/120 ipm at 300 dpi, 600-dpi optical resolution, ultrasonic multifeed detection, Paper Protection, and support for cards up to 1.4 mm. citeturn7search0 Current Ricoh compatibility documentation also explicitly lists PaperStream IP TWAIN/TWAIN x64 for the fi-7160 under Windows 11. citeturn9search3

The comparison report should end with:

```text
                               6130Z         7160
-----------------------------------------------------
300-DPI card throughput
feed failure / 1,000
double-feed / 1,000
visible marks / 1,000
stop-at-N overscan rate
mean overscan count
front/back pairing errors
auto-recognition %
review-required %
mean image bytes/card
```

That will tell us whether upgrading from a 6130Z later is actually worthwhile rather than assuming the newer scanner is better for this workload.

## Test suite and fixture corpus

The existing repository already runs TypeScript tests through `tsx --test`, Playwright UI tests, type checking, and a canonical `npm run verify`, so capture work should enter those existing gates rather than create a disconnected test system. fileciteturn15file0

Use this fixture structure:

```text
tests/
  fixtures/
    capture/
      manifest.json

      adf-duplex/
        manifest.json
        0001-front.jpg
        0001-back.jpg
        0002-front.jpg
        0002-back.jpg
        ...
        0300-front.jpg
        0300-back.jpg

      single-card/
        modern-en.jpg
        old-frame-en.jpg
        borderless.jpg
        showcase.jpg
        extended-art.jpg
        dark-frame.jpg
        light-frame.jpg
        basic-land.jpg
        token.jpg
        dfc-front.jpg
        dfc-back.jpg
        non-english.jpg
        slightly-rotated.jpg
        blurred.jpg
        partially-cropped.jpg
        glare.jpg
        unreadable.jpg

      phone-grid/
        four-cards-straight.jpg
        six-cards-straight.jpg
        six-cards-perspective.jpg
        six-cards-shadow.jpg
        mixed-rotation.jpg

      scryfall/
        tiny-bulk-fixture.jsonl
        expected-index.json

      expected/
        detection.json
        ocr.json
        recognition.json
        session-targets.json
```

Use your own scans/photos for the recognition corpus where possible. Keep large/private fixture images outside normal Git history or in a dedicated test-fixture storage mechanism; commit manifests and expected results so tests remain reproducible.

**Unit suite**

At minimum:

```text
Capture session state transitions
Illegal state transitions rejected
Target count calculation
Remaining destination capacity adapter
Target snapshot creation
Target count unaffected by recognition failures

Provider capability negotiation
Unsupported settings produce clear validation
Event sequence idempotency
Event replay
Out-of-order event handling
Cancellation
Pause/resume behavior

Artifact filename/path safety
SHA-256 generation
MIME validation
Maximum size/dimension checks

1 artifact → 1 candidate
2 duplex artifacts → 1 candidate
1 multi-card artifact → N candidates
N webcam observations → 1 candidate

Collector-number normalization
Set-code normalization
Language normalization
Name normalization

Exact set+collector+language
Exact set+collector
Name+set fallback
Name-only ambiguity
Contradictory signals
No-match case

Auto-accept gate
Review gate
Contradiction veto

Physical duplicate preservation
Provider-event duplicate suppression

Commit idempotency
Commit rollback
Capacity revalidation
Overflow exclusion
Audit creation
```

**Integration suite**

Create real PostgreSQL-backed tests for:

```text
FixtureProvider
→ CaptureSession
→ artifacts
→ candidates
→ mocked recognition
→ review
→ CommitTransaction
→ InventoryItem
→ InventoryAuditLog
```

Then:

```text
tiny Scryfall bulk fixture
→ streaming catalog loader
→ Card upsert
→ resolver
→ expected exact printing
```

Then:

```text
ImageBatchProvider
→ six-card photograph
→ six candidates
→ normalization
→ six recognition attempts
```

And separately:

```text
Mock ITwainBackend
→ Capture Agent
→ agent protocol
→ MTG API
→ persisted artifacts/events
```

**Virtual-TWAIN integration suite**

Run on a Windows CI/dev host:

```text
official TWAIN sample source
→ actual DSM
→ actual agent TWAIN backend
→ real transfer
```

This should not be mocked. It is the bridge between ordinary software tests and the eventual Fujitsu.

**Playwright end-to-end**

Extend the existing UI suite:

```text
Open /captures
Create Image Batch session
Choose owner/opener/default attributes
Choose destination + section
See calculated capacity
Upload fixture batch
See progress
Open review
Resolve ambiguous candidate
Set finish
Commit
Navigate to inventory
Verify expected quantity/location
Open audit trail
Verify capture-session provenance
```

Add a capacity race case where occupancy changes between session creation and commit.

Recommended pre-hardware quality gate on a representative 200–500-card corpus:

```text
Auto-accept precision:          >= 99.5%
Silent wrong commits:           0
Recognized or reviewable:       >= 95%
Fixture target-count errors:    0
Event replay duplicate cards:   0
Commit idempotency failures:    0
Virtual TWAIN session failures: 0 in 100 sequential sessions
```

Those are **engineering targets for MTG-Archive**, not industry benchmarks. In particular, prefer a lower auto-accept rate over weakening the 99.5%-precision target.

Security tests should verify session ownership, agent authentication, artifact size limits, path traversal rejection, invalid MIME rejection, replayed upload idempotency, expired agent credentials, and refusal to commit another user's session.

## Prioritized milestones and Codex execution order

The hours below are **single-developer engineering estimates**, not calendar guarantees. They assume Codex assists with routine implementation but a developer still reviews architecture, tests recognition quality, and handles native TWAIN behavior.

| Priority | Milestone | Est. effort | Hardware required? | Exit criterion |
|---|---|---:|---:|---|
| P0 | Domain/contracts/schema | **12–18 h** | No | Provider abstraction, persistence, state machine and capacity policy tested |
| P0 | Fixture session engine | **16–24 h** | No | 300→263 deterministic target test passes with restart/idempotency |
| P0 | Artifact + ImageBatch pipeline | **24–36 h** | No | Phone/file images become canonical candidate records |
| P0 | Scryfall bulk + recognition | **36–52 h** | No | Exact printing resolver and confidence gates meet corpus target |
| P0 | Review + transactional commit | **24–36 h** | No | Capture can safely populate real inventory with audit history |
| P1 | Windows agent + virtual TWAIN | **32–48 h** | **No** | Actual TWAIN sample source works end-to-end |
| P1 | Fujitsu/PaperStream validation | **16–28 h** | Yes | Real card feed, stop-at-N and duplex behavior characterized |
| P1 | Hardening/performance/docs | **16–24 h** | Mostly no | Recovery, cleanup, metrics, deployment docs complete |

**Pre-hardware subtotal: roughly 144–214 developer hours.** The actual number could trend toward the lower end because MTG-Archive already has import-review, inventory audit, local Scryfall caching, storage capacities, PostgreSQL, and Playwright infrastructure that can be reused. fileciteturn8file0 fileciteturn9file0 fileciteturn16file0 fileciteturn17file0

For Codex, I would create the work in this exact order.

**Milestone P0-A — Capture domain foundation, 12–18 h**

Tasks:

```text
[ ] Add lib/capture/types.ts
[ ] Add CaptureProvider contract
[ ] Add capture state machine
[ ] Add target-enforcement enum
[ ] Add Prisma capture models
[ ] Add CaptureObservation supporting model
[ ] Add CommitTransactionItem supporting model
[ ] Add CAPTURE_DATA_PATH configuration
[ ] Add DestinationCapacityService wrapper
[ ] Add ownership/auth helpers
[ ] Add migrations
[ ] Add state/target/idempotency unit tests
[ ] Document invariants in docs/CAPTURE_ARCHITECTURE.md
```

Acceptance:

```text
npm run verify passes
No provider-specific fields required by core domain
Physical count and artifact count are distinct
Destination capacity can derive target count
Illegal state transitions fail
Commit state cannot return to capture state
```

**Milestone P0-B — FixtureProvider and orchestration, 16–24 h**

Tasks:

```text
[ ] Implement FixtureProvider
[ ] Add scripted fixture manifest
[ ] Implement CaptureSessionService
[ ] Implement provider-event persistence/idempotency
[ ] Implement physical-item completion logic
[ ] Implement EXACT target enforcement
[ ] Add cancellation/failure/restart behavior
[ ] Add minimal /captures session page
[ ] Add progress endpoint/panel
```

Acceptance:

```text
Input = 300
Target = 263
Eligible candidates = exactly 263
No recognition required to count them
Replaying every provider event does not change result
Restarting processor mid-session preserves result
```

**Milestone P0-C — ImageBatch and preprocessing, 24–36 h**

Tasks:

```text
[ ] ArtifactStore
[ ] Image upload validation
[ ] SHA-256 metadata
[ ] thumbnail generation
[ ] SingleCardDetector
[ ] CardDetector interface
[ ] perspective normalization
[ ] quality metric recording
[ ] OpenCV multi-card detector spike
[ ] ImageBatchProvider
[ ] overflow behavior
[ ] sample phone-photo UI
```

Acceptance:

```text
single-card photo → one candidate
six-card fixture → six candidates
perspective photo → canonical crops
overflow preserved but excluded from target
raw artifact remains traceable from every crop
```

**Milestone P0-D — Local catalog and recognition, 36–52 h**

Tasks:

```text
[ ] Implement streaming Scryfall bulk-refresh maintenance job
[ ] Reuse/upsert existing Card model
[ ] Add setCode+collectorNumber+lang index
[ ] Add catalog freshness/status UI
[ ] Add OcrEngine interface
[ ] Implement initial local OCR engine
[ ] Implement name ROI
[ ] Implement metadata ROI
[ ] Normalize OCR values
[ ] Implement exact-print resolver
[ ] Implement contradiction gates
[ ] Implement confidence tiering
[ ] Persist RecognitionResult history
[ ] Build recognition benchmark command
```

Acceptance:

```text
No live Scryfall call required for catalogued card
set+collector+lang exact printing resolves locally
name-only ambiguous printing never auto-commits
contradictory signals never auto-accept
recognition benchmark outputs precision/recall/review rate
```

This also completes a deferred item explicitly documented in the current Scryfall integration architecture. fileciteturn8file0

**Milestone P0-E — Review and inventory commit, 24–36 h**

Tasks:

```text
[ ] CaptureReviewGrid
[ ] CandidateResolver
[ ] search local printings
[ ] keyboard controls
[ ] batch finish/default controls
[ ] unknown-finish gating
[ ] overflow UI
[ ] CommitTransaction service
[ ] capacity revalidation
[ ] inventory upsert/increment
[ ] inventory audit linkage
[ ] rollback/idempotency tests
[ ] Playwright E2E
```

Acceptance:

```text
No inventory mutation before explicit commit
Unresolved required fields block commit
Wrong/changed capacity blocks unsafe commit
Commit retry creates no duplicate inventory
Every committed quantity traces to candidate/session
Existing inventory/audit UI remains valid
```

**Milestone P1-A — Windows Capture Agent and real virtual TWAIN, 32–48 h**

Tasks:

```text
[ ] Create capture-agent solution/project
[ ] Implement agent config + secure pairing
[ ] Agent heartbeat
[ ] Command polling
[ ] Event upload
[ ] Artifact upload/retry/spool
[ ] ITwainBackend interface
[ ] TWAIN DSM wrapper/library spike
[ ] x86 build
[ ] source enumeration
[ ] capability dump
[ ] transfer lifecycle
[ ] duplex metadata
[ ] local physical-card counter
[ ] local stop-at-target
[ ] diagnostic JSONL
[ ] diagnostic export
[ ] Install TWAIN software-only sample source
[ ] Run actual virtual-source integration tests
```

Acceptance:

```text
MTG-Archive discovers connected agent
Agent enumerates virtual TWAIN source
User starts acquisition from MTG-Archive
Images arrive without manual filesystem copying
Physical count reaches target
Agent requests local stop
TWAIN source closes cleanly
100 sequential test sessions succeed
Diagnostic bundle explains each session
```

At this point, **the software concept is proven without purchasing a Fujitsu**.

**Milestone P1-B — Physical scanner, 16–28 h**

The only new work after receiving the fi-6130Z should ideally be:

```text
Install current compatible PaperStream IP
Select PaperStream source
Run existing diagnostic suite
Tune profile
Characterize stop-at-N
Characterize multifeed
Characterize card feed capacity
Benchmark DPI
Inspect card safety
Save validated hardware profile
```

It should **not** require redesigning session storage, recognition, review, or commit.

The eventual profile could look like:

```json
{
  "id": "ricoh-fi6130z-mtg-v1",
  "deviceFamily": "fi-6130Z",
  "resolutionDpi": 300,
  "colorMode": "COLOR",
  "duplex": true,
  "showVendorUi": false,
  "paperStream": {
    "autoCrop": false,
    "autoRotate": false,
    "blankPageRemoval": false
  },
  "targetEnforcement": "BEST_EFFORT_STOP"
}
```

The actual PaperStream choices should be filled in from hardware testing rather than assumed.

**Final integration checklist before buying the scanner**

I would consider the purchase technically de-risked when all of these are green:

```text
CAPTURE DOMAIN
[ ] CaptureSession persists across restart.
[ ] Artifacts and physical candidates are distinct.
[ ] Front/back can map to one physical card.
[ ] One image can map to several physical cards.
[ ] Recognition failure still consumes physical capacity.
[ ] Provider event replay is idempotent.

CAPACITY
[ ] Existing storage layout service supplies remaining capacity.
[ ] Target can be set from destination remaining space.
[ ] FixtureProvider stops exactly at N.
[ ] Overflow is retained, never lost.
[ ] Destination capacity is revalidated at commit.

IMAGE PIPELINE
[ ] Phone image upload works.
[ ] Single-card normalization works.
[ ] Multi-card fixture detection works.
[ ] Raw → crop → candidate provenance is retained.

RECOGNITION
[ ] Local Scryfall catalog refresh works.
[ ] Routine recognition requires no Internet.
[ ] Name/set/collector/language signals are persisted.
[ ] Unique set+collector printing resolves.
[ ] Contradictions force review.
[ ] Name-only ambiguity forces review.
[ ] Benchmark auto-accept precision meets chosen gate.

REVIEW
[ ] User can inspect captured and proposed card side-by-side.
[ ] Printing can be corrected manually.
[ ] Finish can remain unknown until review.
[ ] Batch defaults work.
[ ] Keyboard review works.

COMMIT
[ ] Nothing changes inventory before commit.
[ ] Transaction is idempotent.
[ ] Audit records include capture provenance.
[ ] Quantity conservation tests pass.
[ ] Capacity races are handled safely.

TWAIN
[ ] Official virtual source enumerates.
[ ] Real TWAIN image acquisition works.
[ ] Multi-image acquisition works.
[ ] Stop/cancel works.
[ ] Agent survives repeated sessions.
[ ] Agent records all TWAIN states/statuses.
[ ] Diagnostic ZIP can be exported.

DEPLOYMENT
[ ] Windows agent pairs securely to MTG-Archive.
[ ] Agent can reach Docker-hosted MTG-Archive.
[ ] Artifact retry works after temporary disconnect.
[ ] No browser localhost dependency exists.
[ ] npm run verify passes.
[ ] Playwright capture E2E passes.
```

At that point the only substantial unknowns left are **physical**: how many MTG cards the 6130Z reliably tolerates per load, whether its multifeed settings need adjustment, whether stopping acquisition leaves card N+1 in the tray or transport, which PaperStream image settings produce the best OCR, and whether repeated feeding causes any unacceptable marks. Ricoh's own fi-6130Z specification already establishes duplex scanning, card handling up to 1.4 mm, ultrasonic multifeed detection and TWAIN support, while PaperStream IP's current support table includes both the 6130Z and 7160; the proposed hardware validation therefore narrows the remaining uncertainty to our unusually card-heavy workload rather than basic compatibility. citeturn8view3turn8view2

For Codex, these are the source links I would put directly into `docs/CAPTURE_ARCHITECTURE.md`, in priority order:

1. **TWAIN Working Group sample application + software-only virtual scanner:**  
   https://github.com/twain/twain-samples  
   This is the primary pre-hardware acquisition test target. citeturn8view1

2. **TWAIN Working Group Data Source Manager:**  
   https://github.com/twain/twain-dsm  
   Use this for DSM architecture, x86/x64 behavior, source locations and low-level diagnostics. citeturn13search0turn13search7

3. **Ricoh PaperStream IP:**  
   https://www.pfu.ricoh.com/global/scanners/fi/psip/  
   Current PaperStream functionality and supported-scanner list, including fi-6130Z and fi-7160. citeturn8view2

4. **Ricoh PaperStream application-bitness guidance:**  
   https://fi-faq.pfu.ricoh.com/hc/en-us/articles/13322763972121-Is-there-the-PaperStream-IP-for-64-bit-Windows  
   Use when choosing x86 versus x64 Capture Agent builds. citeturn9search0

5. **Ricoh fi-6130Z technical specification:**  
   https://www.pfu.ricoh.com/global/scanners/fi/discontinued/fi6130z/fi6130z.html  
   Source of truth for 6130Z feed, speed, duplex, card, consumable and multifeed characteristics. citeturn8view3

6. **Ricoh fi-7160 technical specification:**  
   https://www.pfu.ricoh.com/global/scanners/fi/fi7160/  
   Use the same test matrix later to decide whether an upgrade is worthwhile. citeturn7search0

7. **Scryfall API documentation / bulk-data policy:**  
   https://scryfall.com/docs/api  
   https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17  
   Scryfall explicitly directs large-scale simple lookups toward local bulk data rather than constant API traffic. citeturn12search0

8. **Tesseract OCR preprocessing/segmentation guidance:**  
   https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html  
   Particularly relevant to separate title and collector-line ROIs. citeturn10search0

9. **OpenCV perspective-transform and contour documentation:**  
   https://docs.opencv.org/4.x/  
   Use for phone-photo card detection and canonicalization. citeturn11search2turn11search6

10. **Representative open-source MTG recognition implementations:**  
    https://github.com/MerrittTaylor/MTG-Scanner — straightforward local Tesseract + photo/webcam + Scryfall workflow. citeturn6search3  
    https://github.com/GrimbiXcode/mtgscan — browser/camera collector-number-oriented scanning. citeturn6search4  
    https://github.com/IgorLikesAnime/mtg-card-scanner — exact-printing concept using name + collector number + set + language. citeturn6search7  
    https://github.com/JackTheTripperr/MTG-Bulk-Scan — another implementation that cross-checks recognized name/set/collector information against Scryfall. citeturn6search9

The implementation sequence I would actually hand Codex is therefore **Capture domain → FixtureProvider → ImageBatchProvider → canonical image pipeline → local Scryfall bulk catalog → recognition → review/transactional commit → Windows Capture Agent → virtual TWAIN → buy the fi-6130Z → PaperStream hardware validation**. That sequencing makes the scanner purchase the final integration test rather than the beginning of the experiment.