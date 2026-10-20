# Fragmented collector readings retain uncertainty

Related to #869, partial #838, and parents #463/#307. This repair prevents a whitespace-separated digit fragment from being treated as a complete collector. It does not reconstruct the intended number. Existing capped/uncapped admission and positioned-row handling remain delivered.

On main b06925a058733b6b8fe3ca569f58aa320e9d358b, synthetic `C 3 0 2` with a clear name and `ABC EN` supports printing 3 and can permit automatic acceptance. The repaired parser rejects that incomplete prefix. Fraction numerator/denominator fragments also retain uncertainty. Dropping a bad fragment marks the observation as recovered/uncertain even when another clear collector remains, preventing a new automatic decision from the reduced evidence. Adjacent complete fractions and separate observations remain distinct; digits are never concatenated.

Only footer interpretation and its text/catalog identities change. Raw observations, raw admission, native/model budgets, manual choices, Inventory authority and resource settings remain. Footer version advances to v5, text interpretation to scanner-fragmented-collector-v17 and catalog interpretation to catalog-reconciliation-fragmented-collector-v16. Existing saved observations can be reinterpreted without a raw reread; historical reviews/Inventory are not repaired in bulk.

## Author controls

- Old-source negative retained: new parser/resolver/query tests fail against unchanged main, including the accepted prefix and the extra false collector beside a clear reading.
- Final focused parser/recognition/catalog/admission suite: 125 passed, zero skipped/retried. The new regression covers fractional fragments, tabs/nonbreaking spaces, no exact-printing query for unresolved digits, no newly automatic acceptance, and unchanged padded/suffixed/fraction/independent readings.
- Separate old/current matrix: all 255 healthy controls retain exact parsed output; 270 fragmented cases formerly supply partial collectors and now supply none with uncertainty preserved. A clear-title wrong-prefix control changes from automatic=true to false.
- All 32 retained source-job native orientation payloads are byte-identical after an in-memory old/current comparison with the retained current-family catalog. No automatic acceptance expands. These are reused development observations, not independent accuracy or complete historical-generation replay. One observed numeric fragment is backed only by saved text; its original pixels are unavailable, so its intended printing is unverified.
- The first candidate missed uncertainty for a fragmented one-digit fraction total; that failed candidate is retained and repaired without accepting healthy single-digit totals. An adjacent-complete-fraction preservation expectation was corrected to the existing extraction order (fraction pass precedes rarity pass); no product ordering change was made for it.

Typecheck, exact-head CI, built Linux, actual catalog/database/compiled browser and cumulative local publication results are recorded in the PR and dated work checkpoint when completed. Until then the PR remains draft with those checks pending. No successful costly pricing or previous scanner qualification is repeated.

## Limits and remaining scope

This closes only false partial-number support after a separately approved merge. Recovery of the actual spaced/ambiguous collector, missing originals, archived full catalog/model/index replay and independent printing accuracy remain under #838/#463/#307. No native inference or physical feeding establishes a new label here. Existing #842 input-manifest omissions require separate explicit binding of middleware/declarations during any build. Earlier native-pressure, account, database/WAL and failed qualification evidence remains failed or unknown. The 64 decimal GB per-owner correction limit and 2% controls remain unchanged. Production rollout and individual merge approval belong to their separate workers.
