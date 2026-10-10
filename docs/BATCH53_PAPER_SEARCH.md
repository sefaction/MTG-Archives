# Paper printing name search

Issue [#712](https://github.com/sefaction/MTG-Archives/issues/712), fixed by
[PR #713](https://github.com/sefaction/MTG-Archives/pull/713), remains open until
individual approval and merge. Batch 53 on production could not find Krosan Vorine or Crashing Boars by name.
An actual authorized browser lookup reproduced no results for Crashing Boars.
Explicit PLST / EXO-108 and PLST / LGN-131 searches returned the correct paper
List editions. No review or Inventory addition was saved during diagnosis.

Live Scryfall named requests on October 10, 2026 return digital=true for
Krosan Vorine (VMA 219) and Crashing Boars (TPR 168). The provider previously
returned NOT_FOUND immediately for that first result, without enumerating its
paper editions. Regression coverage reproduces that rejection on unchanged code.

Name lookup now uses a digital first response only as canonical name metadata,
then requires complete, validated paper enumeration. The digital identity is
excluded from returned/imported cards and from the required paper membership
check. Explicit digital printing/ID requests remain unavailable. Digital-only
names remain NOT_FOUND after an empty paper lookup. Failed or invalid enumeration
remains unresolved and cannot establish checked coverage.

Name query keys advance to version 2 to bypass historical false-negative cache
entries immediately. Explicit printing and ID keys remain version 1. Existing
lease, bounded pagination, cooldown, language, exact name/face, duplicate and
advertised-count protections remain active.

Validation: all 13 provider/query tests and 862 core tests pass; the three new
behavior cases failed on the unchanged provider. Typecheck and complete disposable
PostgreSQL acquisition/shared-import verification pass. The persisted manual-search
case exercises the digital-first provider through the cache, imports both paper
editions without the digital identity, and repeats the search from local metadata.
The actual repaired live provider finds both reported List editions (two paper
Krosan Vorine editions and three Crashing Boars editions) with checked coverage.

The first full suite attempt failed Git ownership checks in the sandbox; the
workspace-owner rerun passes. Those environmental failures are retained privately.
Required-installer cumulative web and both native Docker builds pass. Two actual
desktop1366/phone320 correction-search, interrupted-save/retry and reload cases
pass with zero failures/skips/retries, no Inventory additions and complete owned
fixture cleanup. Rendered screenshots were inspected. This tests manual correction
compatibility; it does not establish recognition accuracy.

The cumulative local application at http://127.0.0.1:13001 includes main9dc0e2a,
all ten previously ready unapproved batches684/687/688/690/693/695/697/699/700/707,
drafts706/709 and this fix. Build source0c2f5cd has 596 matching application inputs,
digest ddb9fc88d6b620ceedc45e280f1f9125c7ae95f03d1e4a12ec3a6de8886e1382.
Web image2331ba0, recognitionf8563fe and visual/printing4eb30b3 are loaded; all308
native shared inputs match web. All13 ordinary services run; six app/acquisition
services were recreated with unchanged mounts/environment/limits, and seven
unrelated services retain their image/lifetime/settings. Original Inventory,
candidate/photo/artifact/receipt/scanner projections and substantive other-owner
correction data are conserved. Fresh original-photo checks are recorded in the
local checkpoint. No production review/Inventory save or deployment was performed
by this agent; ordinary production searches may cache public printing metadata.

All three GitHub checks pass on implementation head1f705ed. Any subsequent
documentation head is verified separately. Production deployment and individual
PR merge approval remain separate.
