# Actual native printing pipeline integration (#304)

This opt-in controller composes the canonical OCR and visual/printing components,
built with their unchanged Docker recipes, against one disposable database and
upload volume. Production worker
entrypoints perform canonical preparation, real Paddle OCR, real VGG/SIFT visual
retrieval, catalogue reconciliation and actual registered printing observations.
The test introduces no fabricated native observations or predicted labels.

Inputs are controlled padded copies of genuine larger public JPEGs, preserving
the normal 500-pixel printing source-width requirement. The two original normal
reference JPEG hashes must match the unchanged `stamp-reference-labels.json`
annotations for Saber Ants `58f0a2f9-5c5e-4477-ae7e-a52cf5778962:0` and Timberland
Ancient `cfe4a22f-c945-42f4-8b3a-ac3a03ffa015:0`. The normal printing runtime loads
both genuine templates and verifies its bundled Keyrune font/CSS assets. This
reuses development references and annotations; it is not held-out optical or
printing-discrimination accuracy, physical scanner/camera acceptance, a complete
installation catalogue, DINOv2, 150k-copy scale or sustained recovery acceptance.

## Producer and component boundaries

`prepare-native-printing-integration.py` accepts only the explicit Linux/root
fixture opt-in. It verifies the two genuine cached public images against the
existing annotation hashes, then uses the real reference plan, image validation,
atomic publication, snapshot, encoder and index producer. The two-record source
starts PENDING and becomes completely READY. No completeness flag, annotation,
template identity or feature vector is changed to make the worker start. The
small published index is complete for its supplied source, not for all Scryfall
or subsequently discovered printings.

OCR, visual and printing receive no external network, only read-only public
assets/models and the ordinary restricted native child environment. Only the
metadata catalogue component may initially reach the public provider through
the existing bounded query/pagination/cache code. Its response validation, Card
publication and all cache states remain genuine. The equal-byte second photo's
catalogue pass runs without egress and must use the actual persisted complete
cache with zero requests. Missing printing references remain visibly unreadable.

## Staged controller

`verify-native-printing-integration.ts` requires the exact disposable hostname
`nativeprinting304-pg`/database `acquisition_native_printing304`, root on Linux,
`MTG_NATIVE_PRINTING_FIXTURE=1`, `UPLOADS_DATA_PATH=/uploads` and a private journal
at `/fixture/state.json`. Setup refuses existing application rows and an
existing journal, permits only the eight exact standard LocationType migration
seeds, records every full baseline table fingerprint before writes, then
creates only synthetic owner/session/Inventory rows and genuine public Card
metadata. Never use an installation or retained review database.

Run the following staged sequence under one verified local runtime owner:

1. Build both unchanged runtime Dockerfiles from the same exact candidate Git
   export; verify all locked OCR/VGG model files read-only. Prepare the public
   index and actual native descriptors in isolated temporary containers.
2. Migrate the empty disposable PostgreSQL database. Invoke controller `setup`.
   Keep visual/printing enabled and optional reference refinement disabled.
3. For `upload:0` and `upload:1`, run each normal worker once, followed by the
   corresponding `check:canonical`, `check:ocr`, `check:visual`, `check:catalog`
   and `check:printing`. The second upload has identical pixels but a distinct
   physical slot/photo/candidate/job graph. Normal durable visual and printing
   reuse must avoid additional inference and preserve the original evidence.
4. For `upload:2`, process the other public-derived image through the first four
   actual stages. Controller `late` uses the ordinary printing generation,
   native transport and handler, saves an explicit human review after real
   native observation and before publication, and requires SUPERSEDED without
   overwriting that review. Outer assertions prevent a swallowed handler error
   from falsely passing this schedule.
5. `finish` requires 15 actual stage jobs for three physical originals: 14
   COMPLETE and one late SUPERSEDED. Original bytes, immutable stage inputs and
   source outputs, explicit review, seeded quantity-two Inventory/audits and
   zero acquisition commits must remain exact. Actual descriptors bind model,
   index, catalogue, runtime source, annotations and symbol assets; printing
   stays review-only.
6. Confirm every actual worker container terminal before invoking `cleanup`
   with `MTG_PRINTING_FIXTURE_CHILDREN_TERMINAL=1`. It removes exact owned rows
   and private files, including public provider additions introduced into the
   initially empty fixture, and compares every original full-row table
   fingerprint including migrations. Preserve failed cleanup/data rather than
   retiring a database/volume on an uncertain result. Disconnect and host
   resource retirement failures remain separate from the original failure.

The public-image preparation, network requests, worker logs, journal, actual
descriptors, complete source/image manifests, failures and exact terminal
cleanup must be bound to the tested revision on the PR. Hosted CI is separate
from this opt-in native execution; passing types/unit/build checks never claim
that hosted runners executed the model fixture. The composed run exposed finite
numbers being rounded by Prisma's JSON-object write path during ordinary job
completion. Publication now binds JSON text inside the existing fenced
transaction, as visual/printing and correction-evidence publication already
do. The ordinary PostgreSQL catalogue verifier checks exact source geometry,
direct stored JSON and the complete descendant output; no numeric tolerance is
used. No browser workflow, algorithm, schema or acceptance policy changes. Broader
#304/#307/#310/#302, pending #943/#951 stage bindings and #946's reference-byte
race remain separately scoped; no merge, deployment or user acceptance follows.

## Recorded local result

The complete composed run passes at `2fdea512407e42bada36771a60c4c62a7468c4cf`.
The actual OCR image is
`sha256:f9fa9b70598e7c7723696dd5fe926cabf1c1f23c3033120949e4f36ffea5ebb6`
and the actual visual/printing image is
`sha256:039b3ae5fa7e50522fbb00970a715b190754ea0fdf70a9db81c2fb4f4d2af1b6`.
All 502 OCR and 489 visual/printing copied source inputs match the committed Git
export. Subsequent changes to this document do not change those image inputs.

All 15 stage jobs have the expected terminal states: 14 COMPLETE and the late
printing job SUPERSEDED. The first image has 477 genuine geometric inliers;
actual printing reports PRESENT and an ALIGNED locked reference. Its independent
equal-byte second photo reuses visual and printing observations with zero extra
inference, and catalogue reconciliation makes zero public requests without
egress. The third genuine printing request finishes before the saved human
review; its late publication is refused and that review remains exact. Three
originals, saved inputs/source outputs, quantity-two Inventory and audits are
preserved, no acquisition commit is created, and cleanup restores full-row
fingerprints for all 85 public tables.

Earlier failures remain evidence: the first setup refused legitimate migration
seeds before any fixture write; a later real catalogue publication changed
`0.016075611114501953` to `0.01607561111450195`. A rolled-back isolated probe
localized that change to the JSON-object write path. The corrected publication
passes exact comparisons throughout; no historical record is repaired or
declared valid. The normal-width public templates remain unchanged; genuine
larger public inputs meet the existing printing-width guard without upsampling.
