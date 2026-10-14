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
