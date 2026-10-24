# Explicit original opener defaults (#308)

The original P6 Batch 2 requirement includes an explicit batch opener and
per-card overrides. New scan and image batches can choose who originally opened
the cards before capture. Unknown remains the initial choice; collection owner,
the person scanning and the input method never imply an opener.

Review defaults can change the opener for unreviewed cards. A saved per-card
choice, including Unknown and older reviews that did not contain this field,
keeps its provenance when batch defaults change. A reviewer can explicitly
override it when correcting the card. Older clients that omit the field retain
an already saved opener and cannot silently erase it during unrelated edits.

The editor persists an unsaved opener correction in its existing account/batch/
photo-scoped browser draft. Bulk review freezes the explicit opener in the same
request as printing, finish and condition, so retries cannot substitute a later
batch default. The Inventory preview names each chosen opener. Only the separate
explicit Inventory addition writes stock; receipt grouping, member snapshots
and audits retain that opener, and replay cannot duplicate or reassign stock.

An opener is historical attribution, so existing inactive players remain valid
choices. Missing players are refused. Existing owner/Admin Mode checks still
control batch access and writes. The choice list contains only the same player
IDs and display names already used by Inventory; no authentication or private
collection data is added.

The optional JSON fields are backwards compatible and require no migration or
rewrite of old reviews, receipts or Inventory. Old omitted fields continue to
mean Unknown; changing a default alone never alters a saved review. Scanner
continuation and the existing frozen-start request carry explicit defaults.

## Qualification

`acquisition-opener.test.ts` covers legacy Unknown, default application only to
unreviewed cards, per-card overrides, older-client preservation and bounded
identities. The browser-draft test preserves known/Unknown corrections.

The ordinary PostgreSQL commit verifier adds explicit/default/override/legacy
cases, missing-player and foreign-actor refusals, unchanged stock before explicit
commit, saved-review preservation, named preview, separate lots and complete
member/replay conservation. Its existing automatic-confirmation controls also
freeze an explicitly chosen opener and retain it through later manual correction.

The opt-in `acquisition-opener-defaults.spec.ts` exercises desktop and phone
layouts against an owned migrated fixture: real batch setup and uploads,
per-card Unknown and known overrides, draft reload, lost-response bulk retry
across a later default change, actual preview and explicit Inventory addition.
Presentation suggestions are controlled fixture data; this does not run native
recognition or measure accuracy. Before/after fingerprints cover all 85 public
tables and original bytes/source jobs remain exact.

Author qualification on October 23, 2026 completed as follows:

- Product commit `628eeb22f85424cf32cdc6139328701df35002df` built with the
  unchanged canonical Dockerfile into image
  `sha256:cb2d66daefe5bfae3193b92598ee4fb72d4ce929cf36b3b2f91f796922c271cc`.
  Compilation, types, static/client guards passed; the existing unrelated
  InventoryBrowser ref-cleanup lint warning remains.
- The image's 1,270-file source manifest has digest
  `37671b27df3eb9c1a0b6fbe83f0f5d33781f3f007ab917395bcaf8d6272e6dc0`.
  Every input matched the exact Git export. Readback of 476 runtime source
  files also matched. At browser head `79a2f99fb0492173d0db17f8140093719c475d8c`,
  the only later manifest differences were the scanner-start and opener-browser
  verification files; application inputs remained unchanged.
- The full Windows unit run had 1,630 executions: 1,625 passed, five existing
  platform skips, zero failures. The skips cover four Linux descriptor cases
  and one compiled Windows-helper report. Seven focused opener/scanner tests
  subsequently passed, including the newly added frozen Start round-trip.
- The complete standard acquisition PostgreSQL verifier passed on the migrated
  95-migration fixture, including explicit opener defaults/overrides, legacy
  Unknown, unavailable-player and foreign-actor refusals, automatic confirmation,
  named preview, three lots, five member snapshots and replay. All 85 public
  tables' complete-row fingerprints returned exactly to baseline.
- The production runner omits raw route/component/test source needed by that
  verifier. Its temporary SQL container received exact Git-export
  `app/`, `components/`, `tests/`, `tools/`, `docs/` and lockfile additions;
  copied files were read back and hashed. Application runtime sources and the
  compiled application were not replaced. This is verification composition,
  not a claim that those raw source directories ship in production.
- The final actual browser run passed both 1,366px desktop and 320px phone in
  13.5 seconds, with zero skips or flaky results. Each added five copies only
  after confirmation, producing A:1/B:3/Unknown:1 across three lots, three
  audits and five members. Original bytes/source jobs remained exact, preview
  names were readable, and neither layout overflowed horizontally. All ten
  before/after pairs across five browser iterations restored all 85 tables.
  A final independent read of the review database also matched the baseline.

Earlier failed attempts remain recorded with the author evidence. Resource
sampling and source-export argument errors occurred before runtime work; the
initial PostgreSQL probe saw a temporary initialization socket. Two SQL attempts
lacked verification-only imports/routes; their fixtures were restored before
the complete-source retry passed. An internal-only Docker network did not make
the requested loopback port usable; adding an owned browser bridge enabled the
same image/process without changing the database network.

The first browser attempt did not scroll a lazy card into view after reload.
The second used a nonexistent Prisma membership relation after a successful
Inventory addition. In the third, a review write completed before the pending
Stop request returned its stale-revision refusal; the test now awaits accepted
STOPPING/COMPLETE before review. The fourth passed both widths; the final run
additionally proved the changed default was actually saved before resuming the
frozen bulk requests. These were verifier corrections after the product build,
not evidence that a historical production failure was resolved.

Compact manifests, logs, screenshots and original failure artifacts are retained
privately under `.local-data/batch-defaults308/`. After exact restoration and an
empty-upload check, seven owned containers, two owned networks and the empty
upload volume were retired; web/database both exited zero without OOM. The
exact runtime claim was released. Four pre-existing review/database services
were verified unchanged; the current application image is retained. Exact-head
hosted checks and independent review are recorded separately on the PR.

### Independent review correction: legacy draft omission

Review5636334060 found that a valid version-1 browser draft from an older client
omits `openerPlayerId`. The first implementation restored that omission as an
explicit Unknown, so saving an unrelated correction could erase an already saved
known opener. The server correctly preserves omitted fields but honors explicit
Unknown; the browser therefore must retain the distinction too.

Draft restoration now uses the loaded review/default policy only when the draft
field is absent. A saved known opener stays known, a saved Unknown (including
legacy reviews) stays Unknown independently of the current batch default, and
explicit known/Unknown draft choices still override. Eleven focused storage and
policy tests pass, including the parsed legacy draft through the actual restore
policy and server preservation helper; final typecheck and focused lint pass.

The same actual desktop1366/phone320 regression was run against both images.
Both old-image cases reproduce the missing-field-to-Unknown bug at the restored
known-opener editor. Both corrected-image cases pass the full workflow in15.8s,
with zero skips/flaky results: legacy draft reload/save over saved known and
Unknown, existing explicit Unknown draft, frozen bulk retry, named preview and
explicit Add5 with A1/B3/Unknown1,three lots/three audits/five members. Originals
and source jobs remain exact. An initial negative iteration reproduced the
desktop bug but hit an earlier phone lazy-editor layout shift; the verifier now
keeps the intended card in view until its editor is visible. All six browser
before/after pairs, including that failed iteration, restore all85 tables; a
fresh final fingerprint also matches and uploads contain no files.

The unchanged canonical Dockerfile built correction
`a5feaf43f2f331f3ecdd570dec384bfba4c4f5dd` into image
`sha256:b876c86b9ab9a2d933efc98c36cd62dd18bf543f7a9241f5d2622cc2e47bae50`.
All1,270 manifest inputs match exact Git export, digest
`cba8a39c1cb8241f7fe5cb98f9ea22e1ebf3849fb4a69f91252e592b7a397d8b`;
476 runtime source files were read back and matched. Browser head
`aa30bf3fee14140b54d1ff22c371bebcdebe7720` differs only in its verifier file;
application inputs remain unchanged. Earlier full SQL qualification remains
separate; the correction window migrated the isolated review database and
verified actual browser/database behavior without claiming a new local full SQL
run. Refreshed current-head hosted SQL/build/unit gates are recorded on the PR.

Four correction-window containers,two networks and the verified empty upload
volume were retired; exact runtime claim released, protected services unchanged.
The corrected image and old-image negative reference plus compact proof/failure
artifacts remain at `.local-data/legacy-draft308/` and the original batch folder.

Batch language remains a distinct original #308 requirement. Its automatic
confirmation semantics are awaiting Brian's answer: whether an explicitly chosen
language may complete otherwise strong exact-printing evidence when the image
language is unreadable. A readable conflict must still require review. This
opener work makes no language or recognition-policy change and does not close
#308/#302 or establish physical, production or installation acceptance.
