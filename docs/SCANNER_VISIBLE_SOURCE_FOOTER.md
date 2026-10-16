# Visible scanner footer evidence

Related issue [#801](https://github.com/sefaction/MTG-Archives/issues/801); draft [#804](https://github.com/sefaction/MTG-Archives/pull/804), stacked on #802. Local cumulative review is available at http://127.0.0.1:13011.

A scan can lose a physical edge while retaining readable printing details. Previously, whole-photo fallback supplied name hints only. The new CARD_SCAN channel retains actual OCR polygons from the existing bounded pass, mapped back to each oriented original image. It does not prepare a card outline or recover missing pixels.

Only near-card-aspect portrait frames qualify. Observations must be inside the lower-left source region, bounded in size and count. A collector fraction with a two-to-five-digit denominator or explicit rarity/number row must sit immediately above a consistent set/language row in the same direction and source frame. Bare numbers, power/toughness, copyright years, conflicting pairs and distant/reversed rows remain unknown. Overflowed raw OCR observations cannot supply source metadata; ordinary name-hint truncation retains its existing meaning. Regular PHOTO inputs cannot introduce this channel. Existing photo/model/progress identity checks also cover the new fields.

Catalogue lookup can use this observed pair without requiring the set to exist locally. Promoting a suggestion additionally requires an exact whole-line name among the first two text rows in that same completed direction. Original and List printings can share printed identifiers; both remain eligible. Strong existing identifier evidence retains precedence, and contradictions remain review evidence. Neither source identifiers nor an unlocalized name establish automatic acceptance, title location, language certainty, stamp presence, physical count or Inventory receipt.

Advanced review shows the source rows under “Visible scan identifiers,” retaining whole-photo text, unknown edges and existing clipping/rescan guidance. OCR call count, direction order and time budgets are unchanged. The OCR model descriptor and text/catalogue resolver versions change to prevent stale reuse.

## Qualification

304 acquisition source tests, seven native photo-text controls and type checking pass. All three required checks pass on implementation head065efe9 in [run38620294278](https://github.com/sefaction/MTG-Archives/actions/runs/38620294278).

The ordinary upload/native/printing/browser workflow passes in3.0minutes on six frozen, reused originals. Expected identities enter scoring after inference. No stages fail; all six expected printings are offered. First choices improve from3/6 to4/6: clipped Band Together WAR153 moves from third to first, with the same catalogue generation for that source. Five other first choices remain unchanged. Two original/List mistakes remain. Historical catalogue generations differ for three controls, so this is not a universally fixed-catalogue paired accuracy experiment.

All six original hashes, stored uploads, initial geometry/text/lines/orientations/reading zones are conserved. Band Together remains NEEDS_CROP/CLIPPED with no localized orientations; the new evidence contains its observed153/264 C and WAR·EN rows in1560×2160 source pixels. Desktop1366 and phone320 review show the source evidence and clipping guidance; original download bytes match. Early/final automatic acceptance is false, human review/receipt absent, Inventory unchanged. All11 exact owned cleanup checks return zero.

Loaded source has624 inputs, digest f12c4b44ff6726ba9afc5601c02eded60f5fb423b1ab433417b27d2af7d42bf0. Six application roles were intentionally recreated; PostgreSQL identity, mounts, settings, deadlines and resource limits are preserved. The187 reference annotations equal prior data. The bounded private build recipe adds builder-only NODE_OPTIONS=--max-old-space-size=1536; shipped application inputs and runtime settings match the checked cumulative tree.

OCR/visual/printing peaks are1462968320/1519034368/1015246848 bytes within2/3/1GiB limits. Their new containers have zero max/OOM/kill events and restarts. Observed swap peaks7122944/38400000/19415040 bytes remain evidence; this does not establish pressure-free or sustained throughput.

## Failed interval retained

The first web build compiled, then failed with BuildKit RPC Unavailable/EOF. Five isolated workers exited; primary visual/catalogue/pricing workers restarted during the observed interval. P1001 and P2024 logs are recorded under [#755](https://github.com/sefaction/MTG-Archives/issues/755#issuecomment-6176035763); temporal concurrence does not establish cause. The isolated workers were restored, and a separately recorded bounded build succeeded. No primary restart/reset or resource increase was performed by this batch.

Overall uninterrupted lifetime/primary conservation acceptance remains failed. Recovery and the later six-image pass do not erase it. Prior printing OOM investigation #803 is separate and remains unresolved. Keep this PR draft with those operational limitations explicit.

These six images are development regressions, with no independent physical-boundary labels and unknown physical-copy/training independence. This is a demonstrated clipped-footer correction, not near99% exact-printing or edge accuracy. Private original images and detailed runtime records remain outside Git under cumulative .local-data/visible-footer-20261014.

## PR #804 completion review — October 16, 2026

Scope: independent completion audit of `2c863ad349715a12c7aec73bad6ce8ff2861ca4d`, stacked on [#802](https://github.com/sefaction/MTG-Archives/pull/802), for [#801](https://github.com/sefaction/MTG-Archives/issues/801). This record supplements the original qualification and retains its failed interval.

### Independent source review

No blocking defect found in the 14-file delta from #802. Reviewed the bounded source-pixel schema/native mapping, same-direction exact whole-line name requirement, explicit neighboring collector/marker rows, legacy PHOTO exclusion, source/model/progress identity binding, catalogue retrieval, proposal ordering and review display. Existing strong identifiers retain precedence; the supplemental channel stays review-only, preserves unknown physical boundaries and does not add automatic acceptance or Inventory authority. Original/List printed identifiers remain ambiguous.

The qualification harness had a separate false-green gap: failed stages or absent printing output on non-target inputs were recorded but did not fail the test. It now requires completed primary/printing stages, no failed stages, expected printing offered for each scorable control and false primary/final automatic acceptance. Only the demonstrated Band Together control requires the expected first result; the known original/List errors remain visible. Expected identities still enter scoring after inference. A second worker independently reviewed the source flow and this harness correction with no blocking finding.

Dependency #802 final source/documentation head `60b574f1359f552677caba56f0fdbddd7d3ef85b`, including current main, integrates cleanly at `25c9cfc4b2147cad56a2a2959b9a3c0d4e48ef44`. All runtime implementation blobs remain identical to the originally qualified #804 source. Type checking passes after integration and the test correction.

Fresh checks on the exact PR head:

- `tsx --test tests/acquisition-scanner-source-text.test.ts tests/acquisition-photo-text.test.ts tests/acquisition-catalog-queries.test.ts`: 14 passed, no failures/skips.
- `tsx --test tests/acquisition*.test.ts`: 304 passed, no failures/skips.
- `tsc --noEmit --incremental false`: passed.
- `git merge-tree --write-tree origin/main origin/codex/scanner-visible-footer`: clean integration, tree `c109cb533a96ff6d73f6c50442c97227a36e2c01` against main `18c7a94af30b8c9e455f85855ac2254a6efa412f`.
- Fresh GitHub read confirms all three required checks passed on this exact head in run [38646241438](https://github.com/sefaction/MTG-Archives/actions/runs/38646241438). No GitHub review had been recorded at audit start.

### Remaining bounded qualification

The historical six-source native/browser workflow passed, but its preceding build interval failed with RPC EOF and worker restarts under #755. That failure remains evidence with unknown cause. Current acceptance needs a new, independently assessed bounded operational window; it does not require making the historical interval pass retroactively. #803's historical printing OOM remains separate.

The runtime owner investigating #777 retains exclusive control of the shared local stack. No competing build, restart or native qualification was started by this audit. The current cumulative stack already includes #802/#804, so verify its exact input/model provenance before deciding whether any build is necessary.

Prepared test: deduplicate #802's seven originals and #804's six originals by SHA256, then run the existing `acquisition-scanner-source-footer.spec.ts` serially against the verified isolated `mtg-anchor-qualification` project/database at port 13011. The six #804 originals and frozen manifest are retained privately in `.local-data/worktrees/footer-position-cumulative-20261013/.local-data/visible-footer-20261014/ordinary-controls`. Their sample IDs are `val34-19`, `val34-01`, `val34-02`, `val34-13`, `val-extra-36` and `val-extra-65`.

The combined nine-original run explicitly enables `MTG_SCANNER_SOURCE_FOOTER_SERIAL=1`: submit one existing original, wait for its printing terminal state and all owned jobs to become idle across two polls, fail before another input if a stage failed, then submit the next original. The unchanged overall 30-minute processing/35-minute test bounds apply. Its report labels `SERIAL_EXISTING_ORIGINALS`; it is a new bounded completion control, not a claim that the original six-source bulk test ran unchanged. The default bulk path remains available. Independent second-worker review and type checking pass for this opt-in scheduling change; no native/product timeout, source data, resource limit or policy changes.

Before the test, recheck host/Docker capacity, active owner release, source/model identity and service/cgroup snapshots. Preserve existing OOM flags as baseline facts; require zero new OOM/kill/restart or adverse peer-lifetime/configuration changes during this test window. Stop at one failing window and preserve diagnostics; do not expand limits or launch competing recovery. Record any swap/reclamation and assess it rather than asserting pressure-free operation.

Require Band Together's observed `153/264` and WAR rows, expected first suggestion, unchanged NEEDS_CROP/CLIPPED geometry and absent localized orientations. Require exact original bytes/download, preserved initial observations, desktop 1366/phone 320 review with clipping guidance, null human review/receipt, false automatic acceptance, zero Inventory changes and exact owned cleanup. Compare all other deduplicated controls with their retained outputs, recording catalogue changes and remaining wrong-first suggestions. These are reused development controls, not independent accuracy or measured physical-boundary labels.

Readiness remains pending that bounded window and #802's disposition. Individual approval and merge are separate; neither merge nor production deployment is authorized by this audit.
