# Private inventory sorting metadata

Resolves [#729](https://github.com/sefaction/MTG-Archives/issues/729), related to
the still-open private loading observation in [#721](https://github.com/sefaction/MTG-Archives/issues/721).

Private name browsing fetched fifteen metadata fields for every matching
printing even though name sorting and grouping need only id, name and oracleId.
Reuse the established Public projection decision in a shared selector. All
other sorts and metadata-dependent color, identity, keyword and price filters
keep their complete previous projection. Ownership/visibility, SQL constraints,
Scryfall queries, page hydration and navigation remain unchanged.

The actual private page query is extracted without changing its statements or
selection/ordering logic and evaluated against the existing local snapshot.
Sixteen old/new pairs have identical complete groups, page groups, full visible
rows and totals. Cases include exact/grouped, descending second page, Scryfall
creatures, colors, keyword, zero price bounds, other sorts, two regular owners
and an untrusted other-owner filter. Pair order alternates. Regular owners' raw
visible rows remain inside their scope. Public continues using the same selector
and its existing export, preserving its separate visibility rules.

For default admin name browsing, 7,322 printing metadata rows change from
7,192,001 to 815,368 JSON bytes, about 88.7% smaller. The complete result retains
9,572 groups and 54 hydrated visible rows. Paired local calls measured 5,868 and
1,555 ms; these are local observations rather than production latency claims.

The actual unchanged private search baseline reproduces the existing #721
observation: five passes and one ten-second Query-field timeout after URL change;
its retained snapshot shows Loading inventory. The initial anchored test-title
filter selected no tests, was retained as a failed setup attempt and cleaned its
temporary account; the corrected selector runs the original six repeats. No
assertion or deadline is changed. A reduced read cost does not by itself prove
the cause or resolution of the intermittent loading observation.

The initial metadata-only image builds with the required verified installer and
loads with exact source/environment/storage guards. Its private browser run has
eleven passes and one phone failure at the same ten-second Query-field guard.
Public privacy/parity passes; fresh seven original-table projections and fifteen
other service lifecycles remain conserved. The failed phone's ordinary GET
returns headers after about 19 ms and a complete 272 KB HTML body near 9,930 ms,
including Query markup and Suspense completion. This bounds that instance;
it does not establish every historical streamed-response cause.

A current-source read-only stage profile finds 6,096 ms in Scryfall constraints,
versus 435 ms in sorting metadata and under 500 ms in each remaining measured
query stage. The evaluator always prefers normalized face arrays, including
empty arrays, but the SQL reader unnecessarily decodes legacy faces anyway.
The combined candidate skips that decode only for a sole card_faces fallback
and an actual normalized array. Null/non-array primaries retain legacy faces;
oracle and other multi-key/full projections retain their previous raw handling.
No admission, compiler, caching or interpretation policy changes.

Real PostgreSQL read-only VALUES controls distinguish unchanged SQL's unused
fallback from the candidate: eight face-shape fixtures across nine queries keep
identical matches and omit unused legacy output. Null, SQL NULL, malformed and
valid arrays/primaries and oracle fallback are covered. All 59 actual snapshot
query predicates over 7,322 candidates match the complete Card rows under a
repeatable-read snapshot. Type metadata measured 1,069 ms in that verifier;
these are bounded local samples. Twenty-five focused behavior checks and types
pass. The first required Core check's stale inline releasedAt assertion was
replaced with actual shared-selector behavior while retaining release sorting,
DTO and default-visibility checks; the corrected implementation passes all three
required checks. The original failure remains retained.

Current combined qualification is incomplete: the second cumulative Docker
build/browser run, final conservation and exact final-head CI must complete
before readiness. Private query, contract, browser and failure evidence stays
ignored under `.local-data`. Original rendering guards/deadlines are unchanged.

No Inventory write, schema, recognition policy, physical feeding, production or
64 decimal GB / 2% correction-library change is included. The broader loading
issue #721 remains open unless independently resolved.
