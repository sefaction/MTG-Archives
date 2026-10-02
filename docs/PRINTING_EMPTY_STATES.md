# Empty printing alternatives preserve the selected review

Issue578 was reproduced by real saved-review fixtures: a selected printing is
present, but its empty alternative list says No printing found and suggests an
unreadable photo/missing catalog. Absence of alternatives is different from an
actual no-match recognition outcome or an unsuccessful manual search.

The correction editor now distinguishes:
- No suggestions yet: search by card name, set or collector number.
- Selected current printing with no alternatives: keep that printing and offer search.
- Empty completed search: adjust the name, set or collector number.

No recognition status, option selection, dirty draft, stored review, finish or
Inventory authority changes. Empty search results do not erase the current printing.

Baseline: unchanged cumulative Docker FAILED4/4 desktop/phone cases at precisely
these wording assertions. Existing terminal status checks passed before those
assertions; their results are retained separately. Source61130e5 changes only
this copy conditional and extends real persisted navigation/recovery fixtures.

Core PASS764 units/zero skips, typecheck/lint/build/ten manifests. Real Windows
installer-required Docker build PASS. Local web/acquisition/catalog loaded image
mtg-archives-web:printing-empty-state,
sha256:0a62569cf2578cd72109543c03c495103634ede355ab7f26301fd402c4605e6a;
exact510-input source digest
c0049744895ffeb35ce8b40fd8692700980b375b6c27b054359a93d2ee8f59e7.
The first reload helper used an incorrect visual-container name and stopped before
mutation; corrected name was obtained from the live container inventory, then the
load/source verification passed. Existing mounts/services remained unchanged.

Complete affected browser group and final conservation are recorded after cleanup.
A new local catalog-worker restart at07:37:39.101457645Z, OOMKilled=false, is tracked
under579 separately; this wording change does not establish its cause. Native100
throughput still FAILED50/100; production565 and physical gates remain independent.
No physical feed, production mutation or merge was performed.

Final qualification PASS19/19, zero skips,7.0minutes: desktop/phone empty-alternative
and empty-search preservation, manual recovery with no suggestions, navigation,
bulk/drafts/corrections/finish/audit/public/actual200%zoom and successive Windows
fixture helper batches. These are software fixture results, not physical acceptance.
Private before/after logs/traces remain separate; unchanged baseline4/4 failures
are retained. Two catalog-worker stops07:37:39 and07:39:43UTC occurred during this
group, restartCount2/OOMfalse, then ordinary work resumed. They remain reliability
failures under579; browser pass does not supersede them.

After all owned cleanup, original Inventory10280 rows/12482 copies,81 saved reviews
and907 photo IDs/digests matched all baseline hashes exactly at07:43:53UTC. Owned
native users/agents0 and helper child stopped. No active browser test remains.
