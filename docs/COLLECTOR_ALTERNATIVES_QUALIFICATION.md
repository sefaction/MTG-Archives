# Collector OCR alternatives: scoped qualification

Related to #838 and parents #463/#307. This batch is stacked on #870, whose literal partial-number guard remains intact. Direct human request on October 20 authorizes investigation and repair of the remaining collector readings using available evidence.

## Result and evidence boundaries

Complete same-row spaced digits and one digit-like glyph can now produce bounded lookup hypotheses. `M 0 3 2 3` suggests `323`; `R 03S6` preserves both `336` and `356`; `0 3 0 Z` also preserves a possible real `30z` suffix beside `302`. Ordinary padded/suffixed collectors remain literal, unchanged evidence. No digits are joined across rows, reading channels or orientations. Conflicting markers, multiple differing positioned readings, malformed/missing/distant source rows and excessive ambiguity gain no hypothesis. Two whole numeric runs such as `17 18` are not joined.

These alternatives have their own `COLLECTOR_OCR_ALTERNATIVE` reason. They never acquire literal `SET_AND_COLLECTOR_TEXT` or `SCANNER_SOURCE_IDENTIFIERS` support. A canonical-footer suggestion needs an exact title and the same channel's set/language; positioned source suggestions need same-direction exact whole-line name retrieval and the existing row geometry. Original and stamped counterparts remain distinct. The existing four-printing-lookup budget is unchanged, with literal queries first. Text-only and image-assisted review retain the alternative before arbitrary same-name display truncation. A visible message explains the uncertain digits. Human choice, physical count, finish, Inventory and automatic confirmation authority do not expand.

All 255 healthy footer outputs match the parent implementation exactly. The comparison reinterprets 32 distinct retained saved observation generations against each record's saved proposal subset: two gain a review alternative and change first position; none gains automatic acceptance and every raw envelope remains byte-equivalent. One newly suggested `323` belongs to an unavailable original; it is not a newly verified label. The available original flag in another case is not a new pixel inspection. This is reused development evidence, not an archived full catalog/model/index replay or independent recognition accuracy. The separate synthetic capped-title controls demonstrate recovery without claiming all historical cases are fixed.

## Author checks

- 76 focused source controls pass without skips/retries, including the existing literal fragment guard, row geometry, stamp/visual conflicts, caps, explicit review and lookup budget.
- TypeScript check passes.
- Exact-head CI, built Linux/source/compiled-byte checks, actual catalog/PostgreSQL/desktop-phone/manual choice and cumulative local runtime conservation are pending. This PR remains draft until the author qualification is complete; the separate reviewer controls independent readiness.

## Retained failures

The initial prior fragment test expected no lookup at all; its literal no-prefix assertions still pass, while the separate complete-row hypotheses require explicit query expectations. The first healthy parity run caught regex backtracking interpreting healthy `L 1` as `11`. Rarity is now consumed deterministically and all 255 healthy controls pass. Initial new test typing and missing opposite-direction fixture errors were corrected; these were fixture failures, not passing qualification intervals. Logs and exact source hashes remain in the private owned run evidence.

## Remaining scope

Unrecoverable/multiply ambiguous readings remain unknown. The three absent originals/independently verified labels, exact archived full generation, independent #749/#800 printing discrimination and broader #463/#307 resource/release acceptance remain open. No historical reviews/Inventory are repaired. No raw native reread, OCR/model/budget change, physical operation, production action or merge approval occurs. Existing #842 provenance omissions and historical account/resource/WAL failures remain separately recorded.
