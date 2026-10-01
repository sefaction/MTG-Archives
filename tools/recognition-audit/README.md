# Private, isolated recognition audit

These tools measure current native inference and experimental routing. They do not
change application workers, original pixels, saved reviews or Inventory. Keep
photos, observations, catalog projections, configs and reports in ignored
`.local-data/recognition-audit/`. No private corpus is silently treated as a CI test.

`benchmark.ts` consumes a frozen manually verified manifest and private config.
The config names existing native image digests, public model/index/reference mounts,
reviewed runtime/evaluation sources, full local catalog projection and originals.
It starts only its named `mtg-audit-paired-*` containers with network disabled,
read-only inputs and bounded CPU/memory. Never run concurrent instances with these
names. The parent must still finish/clean up its containers after interruptions.

Expected labels enter scoring only. Baseline runs native OCR and global visual
retrieval concurrently, then pure current catalog combination and bounded printing
verification. Identifier-first skips broad visual work for exact nonconflicting
footer/title evidence. Identifier-partial also scopes retrieval to observed names
and reliable partial identifiers, with global fallback for weak/no geometric
support. The actual fixed reading strips and registration/stamp implementation are
shared. The parent's whole-photo reader preserves completed progress on timeout.

Resource limits are two CPUs per native role, OCR/printing2GiB and visual3GiB,
with one effective model thread. Native caches are shared; method order rotates
per image. Per-stage cold starts/restarts, completed-call counters and interrupted
counter lower bounds are separate. Existing application load remains a timing
limitation. Provider/cache-miss, app queue, upload and preparation latency are not
measured by this frozen full-catalog-cache inference harness.

The output is private per-image evidence, exact-first/rank, offline auto-decision
eligibility, correction need, routes, stage/overall elapsed time and call counts.
Offline eligibility never confirms a saved review. Always report its denominator;
zero decisions supplies no acceptance-precision estimate. An unidentifiable image
has no expected printing; do not count a generic back as a successful front.

`EvidenceCache` is a bounded in-memory audit prototype, not a deployed cache.
Its key includes server-established owner scope, photo, input kind, native model,
index, catalog, policy and ordered candidates. It clones results and preserves
unknown evidence. Production publishers must additionally retain current
job/candidate/review/revision fences. `reuse_benchmark.ts` measures warmed exact
lookup/serialization against separately measured native calls and verifies byte-
equivalent JSON observations. It does not invent skipped pipeline timings or
improved accuracy. Persistence, TTL and cross-process invalidation are future work.

`summarize_snapshot.py` summarizes explicitly read-only historical exports.
Catalog output can inherit OCR timing: the summarizer excludes that inherited
field from catalog timing. Scheduling lineage repeats are opportunities, not
proof of safe evidence reuse across every owner/version/input boundary.

Run focused checks with the repository's locked dependencies:

```powershell
npm run typecheck
node node_modules/tsx/dist/cli.mjs --test tools/recognition-audit/*.test.ts
python -m unittest discover -s tools/recognition-audit -p 'test_*.py'
```

Private runs require explicit config/manifest/output arguments; absence of assets
is an error, not a green skip. Frozen source/truth/model/index hashes and current
reviewed main provenance belong in the private report and summarized methodology.
See `docs/RECOGNITION_PIPELINE_AUDIT.md` for the protocol, findings and limitations.

Summarize a complete paired report with `summarize_benchmark.py REPORT OUTPUT`.
`compare_benchmark.py REPORT MANIFEST OUTPUT` additionally verifies the frozen
input/truth pairing, counts correlated printing groups and reports paired wins,
losses and route timings. Group counts and Wilson intervals describe this corpus;
they do not establish random independent population accuracy. Keep complete private
reports and manifests to reproduce the public aggregates.

Configs/manifests are trusted operator inputs, not remotely accepted uploads. This
harness is private diagnostic tooling, not a server API. The printing request uses
proposal order consistently; the application obtains the same proposed identities
through its database lookup, whose order is unspecified. Candidate-face ordering
and shared reference-cache warming are additional timing limits. Provider lookups,
application publication and user-review interactions require separate integration
qualification before a routing/cache prototype becomes application behavior.
