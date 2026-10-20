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

Typecheck and all three source-head required checks pass in run39384669215. Built Node22 controls and actual catalog/database/compiled desktop-phone review now pass in the cumulative local review. The final documentation-only head and its exact CI are recorded in the PR/checkpoint. The PR stays draft for the separate independent reviewer; no successful costly pricing or earlier scanner qualification was repeated.

## Limits and remaining scope

This closes only false partial-number support after a separately approved merge. Recovery of the actual spaced/ambiguous collector, missing originals, archived full catalog/model/index replay and independent printing accuracy remain under #838/#463/#307. No native inference or physical feeding establishes a new label here. Existing #842 input-manifest omissions require separate explicit binding of middleware/declarations during any build. Earlier native-pressure, account, database/WAL and failed qualification evidence remains failed or unknown. The 64 decimal GB per-owner correction limit and 2% controls remain unchanged. Production rollout and individual merge approval belong to their separate workers.

## Cumulative local author delivery — October20,2026

Application source c0d938bfef881fe0b8cc41df27aaa3ffa1e0840c; cumulative application commit0eeb508731e0c9773a52f3bf918cee2229807ce4. Documentation-only follow-up does not change the built inputs. Review URL http://127.0.0.1:13011. This is a component overlay on the already qualified review bases, not a claim that the entire main/cumulative tree runs uniformly.

- Final web/general/catalog image: sha256:4fe5483df631368c982e595af27dec0b1e834646675c85e6b72b604bdb281d97, distinct tag mtg-archives:fragmented-collector-css-1b71671b.
- OCR image: sha256:d5f3abf946dd1c764217cc0bb4db2d4cd2e6560b57260988f01e5073f19a859a.
- Visual image: sha256:47fed09ce3c93389ac74d7fb89cb4e2e89bfd7ab91ca72201d0b3892760a6322.
- Printing image: sha256:e30139321aa7cf60f17cf79903ad63fe1a7c4d0c8da5294c94d429dd8571d82e.

Each base image’s full Config and original layer prefix remain; only three library files and their manifest change, with rebuilt web output. All336actual library/script inputs per role match the expected source maps. All557runnable compiled web files match the corrected compiler output. Existing model generations, full environment, commands, mounts, HostConfig/resources, logging and stop behavior remain. Whole rendered-model and negative resource-mutation guards pass. Middleware/declaration inputs are separately hash-bound because #842 remains open.

Fifteen actual Node22 parser/source/recognition/query compatibility controls pass at512MiB/1CPU. They are reused for the corrected CSS image only after exact equality of all336runtime inputs and a fresh installed guard/compiled-byte/utility-CSS probe; they are not a second claimed fifteen-test run. Host125focused controls,255healthy and270fragmented comparisons,32saved observations and typecheck remain unchanged.

The real PostgreSQL catalog handler and compiled browser verify that a synthetic 'C 3 0 2' does not produce a prefix-printing query or printed support. A separate clear17 remains supported and automatic acceptance stays false. An explicit human choice of alternate3 persists through save/reload, with unchanged raw output and zero Inventory additions. Desktop1366/phone320 layouts and a fresh CSS readiness assertion pass in29652ms, one expected test/zero skips,retries or flaky. The fixture is synthetic saved OCR, not new native inference or independent accuracy. The five idle review workers are intentionally paused/restored with the same container IDs/configuration and fresh native readiness; they do not process synthetic native jobs.

Paired read-only checks preserve25review domain-table/existence projections, the existing catalog identity/name/printing/language/digital projection and every review upload. The catalog comparison is not a full price-ledger audit. Original18non-target service identities/settings/lifetimes are conserved, including the primary app and Pricing868; no primary or production reload occurs. Dated terminal idle/HTTP/model observations and exact final container identities remain in the checkpoint/evidence. These brief checks do not establish sustained resources or historical cause resolution.

## Retained failed qualification intervals

The first web runtime-base build omitted Tailwind/PostCSS build-only configuration: CSS requests returned200, but the real phone control failed on an unstyled overflowing page before save. Its entire report/trace/synthetic journal remains archived. Exact manifest-bound configs were added to the isolated builder; the same2304MiB/1CPU/1536MiBheap compile bound succeeds. A separate tag preserves the failed image sha256:fb64a343bc13f85040132eb1b1d83d31353dc15b769dcf4acc3f2416edd569b9. Only web/general/catalog are then replaced; successful native overlays are not rebuilt. The repeated real browser case passes after the correction, and does not retroactively pass the original failed interval. The official repository Dockerfile already copies these build configs; no product CSS fix or production regression is inferred.

An earlier marker check incorrectly required worker-only interpretation version strings in Next chunks; inspection of230chunks confirms these constants are tree-shaken from web paths. Actual installed runtime guards plus exact runnable compiled output are verified instead, without repeating that successful compiler. A read-only test-loader cache needed a private16MiB temporary filesystem under the same memory cap. Pre-execution helper quoting and an audit-adapter syntax failure are retained separately; no database query or product failure followed from those syntax errors.

All source observations, failed intervals and previous868strict-account reconstruction limitations remain. No global account rebaseline, historical repair, raw reread, native/model/resource-limit change, physical operation, merge or production action was performed. Exact owned run1b71671b-ae06-4b13-b198-2a12756500dd evidence is local and private; no credentials, sessions, user photos or raw private observations are published.
