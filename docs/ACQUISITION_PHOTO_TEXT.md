# Whole-photo name fallback

This bounded OCR fallback helps photos whose card localization or usable title
reading failed. It reuses the existing verified PaddleOCR engine and durable
recognition job. It introduces no new upload, geometry, scanner, review or
Inventory route, model, confidence threshold or production setting.

## Evidence and decisions

- Catalog-supported titles, including short names such as Fog, keep the normal
  fast path. Fuzzy or missing title results may attempt whole-photo OCR.
- Read at most four directions with a 1600-pixel maximum edge. Native work checks
  a 25-second budget between directions; the parent enforces at most 32 seconds
  and the remaining existing 45-second job deadline. Completed partial readings
  are explicit. The warm native protocol sends each completed direction before
  starting the next one. An internal timeout or worker failure can retain those
  validated readings as PARTIAL, alongside the original evidence/suggestions.
- Exact whole-line catalog names can offer `UNLOCALIZED_NAME_HINT` suggestions.
  Whole-photo text does not become a located title, footer identifier, language
  or stamp observation. Geometry and original canonical readings stay intact.
- Name hints remain review-only. Existing printing/stamp and visual stages still
  run independently. Image-supported same-name printings can survive the bounded
  suggestion list; an image match does not prove printing or stamp absence.
- Missing-local names use the existing shared Scryfall cache before unrelated
  visual matches. No scanner-only catalog, photo or artifact store is introduced.
- Review shows **Name only · check printing**. Advanced retains separately labeled
  whole-photo readings and defaults to the source image, so a bad detected crop
  cannot hide the card supplying the hint; explicit crop/zone inspection remains.
  Saved human choices and explicit Inventory commit remain
  authoritative.

## Completed-reading transport

Progress records bind one completed direction to the expected original photo,
native descriptor and whole-photo task. At most four records plus the final
result share the existing aggregate 64-KiB request output bound. Split/coalesced
frames are supported; no progress is accepted by ordinary OCR, image or printing
requests. A killed child must exit before another request reopens the process.

Final readings must preserve the completed prefix. Duplicate directions,
changed identities or contradictory final evidence discard progress. An outer
job cancellation still propagates and publishes nothing; retaining a name hint
does not extend a job deadline, restore a lease, infer printing identifiers or
enable automatic acceptance.

This amendment is being qualified after a live seven-input run completed all
printing jobs but lost two whole-photo hints to TIME_BUDGET. Budget checks occur
between native directions, while the parent enforces a wall-clock deadline, so a
later direction can otherwise hide earlier work. The failed run did not record
direction timestamps; this mechanism is not yet an observed cause attribution.
The earlier successful seven-input check and the later failure remain separate
evidence. The 100-input resource run ended with 57 printing results at its fixed
20-minute gate; owned fixtures were cleaned with no Inventory changes. It did
not qualify full-batch throughput or review and will not be rerun unchanged.

`tools/acquisition-eval/qualify_photo_text_progress.ts` is an opt-in native-image
helper, not an app or background service. Use network disabled, one CPU/2 GiB,
the same read-only models at `/models`, frozen catalog at `/snapshot`, private
phone/scanner originals at `/phone`, `/additional`, `/scans`, and an owned private
output directory at `/output`. Mount the matching repository `lib` and runtime
sources into `/app` and run the helper at its repository-relative path with
`MTG_ACQUISITION_PHOTO_TEXT_PROGRESS_TEST=1`. Ordinary difficult-photo/control
cases keep existing budgets and record completed-direction timestamps. A
separate controlled child termination after the first real completed direction
checks retention and clean reopening; it is neither a natural timeout
reproduction nor a performance/accuracy result. Full reports contain private
OCR/photo evidence and must remain local.

The real-native qualifier passed with unchanged model hashes/runtime versions
and the frozen full 109,271-card snapshot. Winter, Tormented Loner produced its
first direction at 26.8 seconds; the parent then timed out later work, retaining
that reading as PARTIAL/TIME_BUDGET and offering the correct name. Cunning
Geysermage retained three directions and offered its name. Both attempts ended
within about 35 seconds, including primary recognition, without increasing the
existing limits. Normal photo and Card scan controls skipped fallback and
completed in about five seconds. Controlled termination preserved exactly its
completed direction, and reopening passed. Native primary evidence remained
unchanged and all decisions stayed manual. These development observations do
not establish independent printing accuracy or explain every historical
timeout. Sanitized evidence is in `photo-text-progress-results.json`.

Fifteen focused transport/photo-text/generation guards and four Python guards
passed; disposable acquisition/import/core checks passed with owned cleanup in
170 seconds.

The changed-source cumulative browser check then passed all seven inputs in
361 seconds, using the unchanged 600-second printing gate and ordinary queues.
All names were offered first, all printing stages completed, original native
evidence stayed intact, and every decision remained manual. Simple/Advanced,
source/reference images at 1366/390/320 pixels, conditions across modes,
correction/reload, location/section and zero Inventory/owned cleanup passed.
All four screenshots were inspected. The built/loaded native descriptor differs
from the isolated qualifier only through verified CRLF/LF source formatting;
both identities and exact loaded source hashes are recorded separately in
`photo-text-pipeline-results.json`. Incoming runtime validation stays exact.
This pass does not remove the retained 100-input failure or qualify independent
printing accuracy or automatic acceptance. Printing lifetime still reached its
1-GiB limit without OOM kills; the array cache is not a total-memory guarantee.

## Verification and limits

`tools/acquisition-eval/photo-text-results.json` records a local, network-isolated
runtime qualification using the same models, one CPU, 2 GiB and the full 109,271-card
snapshot. Three previously unoffered difficult-photo names became offered; two
dependent quarter-turn variants also passed. Normal phone and declared-scan
controls skipped fallback. All seven requests completed within 45 seconds and
original native evidence and input identities remained intact. Fallback cases
took 29.1–31.7 seconds, were PARTIAL and required review. These are reused
development images and name-retrieval results, **not independent exact-printing
accuracy, automatic precision, or sustained throughput evidence**.

Focused TypeScript guards and model-free Python tests cover stale identities,
timeouts, cancellation, evidence separation, image-supported printing ties and
bounded transport. The disposable database verifier proves missing-local lookup
despite an unrelated visual match, stable local IDs, shared-cache reuse, saved
review preservation and zero Inventory writes.

Run `npm run verify:acquisition -- --core` for disposable database/core checks.
For the opt-in real-worker browser check, set `MTG_LOCAL_PILOT_TEST=1` and the
private corpus roots `MTG_ACQUISITION_CORPUS_PATH`,
`MTG_ACQUISITION_ADDITIONAL_PHOTOS_PATH`, and
`MTG_ACQUISITION_PLAYABLE_SCANS_PATH`, then run
`npm run ui:test -- tests/ui/acquisition-photo-text.spec.ts --workers=1`.
The seven-input browser case uses ordinary ingestion/queues and waits for every
printing result before checking review. Two loaded runs failed the same
600-second completion gate: one of seven results initially, four of seven with
the separate #494/#495 handoff fix. The latter admitted all seven photos promptly
(first OCR job about 32 seconds after test start), but 13 active OCR runs shared
the workers. Both failures are retained privately. Both owned fixtures cleaned
up with zero Inventory. Owner scheduling #497 later passed the seven-input
gate, and the current progress/cache combination passed it again as recorded
above. The intervening cache-loaded name-hint failure remains retained. Fair
admission alone does not establish throughput or recognition accuracy, and the
100-input/300-input gates remain unqualified.

`tests/ui/acquisition-photo-text-streaming.spec.ts` checks the intended streaming
review separately. It submits the three difficult originals through the same
ordinary queues, inspects each catalog suggestion as it arrives, and checks the
first card before the remaining cards have catalog results. It covers original
source/printing image display, explicitly unlocalized text, correction/reload,
location/section and zero Inventory. Each card retains a 600-second wait for its
catalog result; this is not a relaxed rerun of the seven-input printing gate.
Run it with the same private phone roots and local opt-in. Its report is written
incrementally when `MTG_ACQUISITION_PHOTO_TEXT_REPORT_PATH` is set.

The loaded streaming check passed in 5.6 minutes. All three names were offered
first, required review and retained their original native evidence. First-card
review was available after about 83 seconds while the other two remained queued.
Simple/Advanced inspection, source and reference images at 1366/390/320 pixels,
unsaved condition across modes, saved correction after reload and subsequent
background results, location/section, zero Inventory writes and owned cleanup
passed. Screenshots were inspected. Sanitized evidence is in
`tools/acquisition-eval/photo-text-streaming-results.json`; private images and
raw reports remain local. No native deadline, policy or queue priority changed.
That streaming check alone did not qualify the full-batch printing gate; the
current seven-input pass is separate. Neither establishes independent printing
accuracy or removes the 100-input throughput failure.

This batch depends on #490. Simple/Advanced #488, recovery qualification #491
and independent-main upload recovery #492 remain separate PRs included only in
cumulative local review. #463 remains open; automatic hybrid confirmation stays
off and fresh final-evaluation originals remain reserved from tuning.
