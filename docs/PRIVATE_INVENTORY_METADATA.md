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

Current qualification is incomplete: focused behavior checks, types, required
CI, the current cumulative Docker build/browser workflow and final original
data/service/fixture conservation must complete before readiness. Private
read-only query and browser evidence stays ignored under `.local-data`.

No Inventory write, schema, recognition policy, physical feeding, production or
64 decimal GB / 2% correction-library change is included. The broader loading
issue #721 remains open unless independently resolved.
