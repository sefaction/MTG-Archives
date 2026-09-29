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
  are explicit. Timeout or worker failure retains original evidence/suggestions.
- Exact whole-line catalog names can offer `UNLOCALIZED_NAME_HINT` suggestions.
  Whole-photo text does not become a located title, footer identifier, language
  or stamp observation. Geometry and original canonical readings stay intact.
- Name hints remain review-only. Existing printing/stamp and visual stages still
  run independently. Image-supported same-name printings can survive the bounded
  suggestion list; an image match does not prove printing or stamp absence.
- Missing-local names use the existing shared Scryfall cache before unrelated
  visual matches. No scanner-only catalog, photo or artifact store is introduced.
- Review shows **Name only · check printing**. Advanced retains separately labeled
  whole-photo readings. Saved human choices and explicit Inventory commit remain
  authoritative.

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
The browser case uses ordinary ingestion/queues, checks seven original/derived
inputs, location/section, evidence, review/reload and zero Inventory, and cleans
only its owned fixture. Its local Docker acceptance is pending.

This batch depends on #490. Simple/Advanced #488, recovery qualification #491
and independent-main upload recovery #492 remain separate PRs included only in
cumulative local review. #463 remains open; automatic hybrid confirmation stays
off and fresh final-evaluation originals remain reserved from tuning.
