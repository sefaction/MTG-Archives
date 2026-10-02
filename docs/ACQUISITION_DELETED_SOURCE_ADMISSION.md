# Deleted source at acquisition admission

Issue579 tracks three observed local catalog-worker stops, OOMKilled=false:
07:03:47.493792482Z,07:37:39.101457645Z,07:39:43.418260825Z. Their old safe
logs omitted the exception, so actual stop causes remain unproven. They are
separate from production565's missing service and498's empty initial claim.

Catalog, visual and printing admission select a bounded fair set of source IDs,
then read each source. A removed source previously threw findUniqueOrThrow and
escaped the catalog worker loop. Change only those admission reads to nullable
lookups and skip a missing row. Continue live selected work; database failures,
malformed inputs, claim/handler failure policies, fairness and version fences stay
intact. This is a specific qualified deletion window, not every cancellation race.

Worker-stop diagnostics now retain ADMISSION/PROCESSING/AUTO_CONFIRM and a bounded
public Prisma code. Messages, stacks, query text, account/input/provider payloads
are omitted. UNKNOWN preserves a safe stop record for other or malformed errors.
Errors still stop the worker for normal operator/service recovery.

## Reproduction and evidence

- Unchanged unit baseline:6 missing-source cases FAIL,3 genuine-error propagation
  cases PASS. All12 focused cases PASS after the fix, including privacy/accessor
  guards for diagnostics and continuation to the next live selected source.
- Actual disposable PostgreSQL baseline FAILED P2025 after a real SQL eligibility
  query selected the catalog source, then the boundary hook deleted precisely it.
  The owned database/volume was removed; original failure report retained.
- Post-fix actual PostgreSQL exercises that boundary for ALL THREE changed stages.
  Each skips absent source with no downstream job/review/Inventory change, restores
  the fixture row, then ordinary admission/processing continues. Complete acquisition
  and shared receipt/import integrity suites PASS; owned database/volume removed.
  Reports: .local-data/verification/acquisition-2026-10-02T07-46-31-483Z (FAILED),
  acquisition-2026-10-02T07-50-07-225Z (PASSED), privately retained separately.
- Core PASS776 units/zero skips, typecheck/lint/build/ten manifests. Sourcefd2a592.
  Real-installer web image and native visual image built; printing uses the previous
  frozen runtime as base and changes only lib/scripts to preserve algorithm bytes.
  Loaded-source/runtime and successive-browser evidence follows when complete.

Remaining: identify any further stop cause using bounded diagnostics; qualify the
post-read/deletion window and longer worker lifetime. No complete reliability,
production565, native100 throughput, physical feeding or printing accuracy claim.
Native100 remains FAILED50/100 in20minutes. All changes stay unmerged pending each
PR's individual approval. Inventory/original/review conservation remains mandatory.

## Loaded local qualification,03:36 Central

All five intended services run updated lib/scripts. App image
sha256:1252a8303cab5cc683c5fcc225a6a147bc90bed2a16f34d2d5fe3745e8e3fa27,
exact512 source digestbe098216e672c39c02fff47781acf7ba24fe1d6799dec933c7777cb8470ce391.
Visual imagef0bdc5a271acf981fab1cf73fced0d979cc97fd98f15515084c86392848bd01b;
printing imagee470bac36d5d9fd4079ae70e144709fd3aff0c4aa483d0408ca9b2f34e9effaa.
246 copied source files per native runtime match; all13 visual/14 printing Python
files match pre-reload bytes. Index/models/references and resource policies retained.
Two verifier syntax errors were corrected; both private failed probe logs retained.

Initial COMPLETE browser group FAILED1/19,18passed9.9minutes. Trace call608 waited
for Load more matches after its count check, but automatic paging removed it.
Browser-close cleanup then prevented database cleanup, leaving32 owned photos.
Known exact fixture identity and32photos/0reviews/0Inventory validated, then removed;
all original hashes matched again. Fixture now scrolls already-rendered rows and
waits for row growth; closed-browser cleanup still reaches database cleanup. Same
180second overall gate; action bound tightened15seconds. Failure remains retained
in night-deleted-source-bulk-pagination-race-failed-*; no isolated retry substitutes.

Corrected COMPLETE group PASS19/19,zero skips7.1minutes. Includes desktop/phone
recovery/navigation/empty-search/draft/bulk/finish/printing-correction/audit/public/
actual200%zoom plus successive website-started Windows fixture helper batches,
one explicit Inventory addition and byte/review/receipt preservation. All originals
conserved at08:36:31UTC:10280 Inventory rows/12482copies,81saved reviews,907photo
IDs/digests, owned native users/agents0. Helper stopped and browser session finished.

Catalog/visual/printing restartCount0/OOMfalse throughout both groups and intervening
cleanup since reload (roughly34minutes); no catalog stop diagnostic. This bounded
pass does not prove the causes of the original3 restarts, longer lifetime or the
post-read/deletion window.579 remains open; native100/production/hardware gaps stay
exactly separate. No merge/deploy or production configuration/data operation.
