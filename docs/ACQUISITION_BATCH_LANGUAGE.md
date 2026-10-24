# Confirmed batch language (#308)

Brian's October 23, 2026 answer to the batch-language policy question was:
“Yes, use the confirmed batch language.” A language explicitly selected by the
operator may supply missing language confirmation for an otherwise strong exact
printing. Readable conflicting language still requires individual review.
The decision and original scope are recorded in
[#308/comment6378899312](https://github.com/sefaction/MTG-Archives/issues/308#issuecomment-6378899312).

New batches initially use printing evidence, without assuming English. An
operator may choose a supported batch language before capture or during review.
Saved reviews retain their actual printing and language when defaults change.
A per-card override chooses the correctly translated printing; the server still
requires the decision language to agree with that printing. Older clients that
omit the new default field preserve existing confirmation; explicit null clears
it for future reviews. Frozen scanner Start and bulk confirmation bodies keep
their original language across reload/retry and later defaults.

The machine's saved OCR and ordinary proposals remain immutable. Catalog
reconciliation separately publishes bounded conditional interpretations from
clear saved primary set/collector/title evidence. They require the same title,
catalog uniqueness/coverage, orientation, layout and stamp checks as existing
strong matches. Ambiguous numeric set tokens without punctuation remain
unconfirmed. Supplemental, inferred/reference, visual and hybrid-printing review
restrictions are preserved; a batch language cannot bypass another uncertainty.
Candidate languages come only from the actual local printing group, with at
most eleven supported interpretations and no additional provider/native work.

Automatic review uses a conditional interpretation only under the session lock
with a current explicit matching batch language. Its command records the chosen
language, defaults revision and whether it supplied unreadable language. Existing
human-pending/edit, owner/actor, current-photo/generation, source freshness and
replay fences remain. A readable/default mismatch is also exposed by the
existing bounded/private conflict filter until individually reviewed.
Readable observations in either direction veto conflicting confirmation even
when that observation names an unknown set. The filter projects only bounded
language codes; automatic confirmation also checks the saved native footer
evidence, rather than trusting the selected proposal's language alone.

Reviews do not write stock. Explicit Inventory preview/addition carries each
saved printing language into separate lots, receipt members and audits. There
is no schema migration, historical correction or automatic Inventory addition.

## Verification scope

Focused policy/recognition/footer/problem-filter/scanner tests cover missing
versus conflicting language, unchanged source text, title/collector/orientation/
stamp/duplicate/catalog ambiguity, old-client omission versus explicit clearing,
saved printing preference and frozen scanner Start. Types and focused checks
are recorded in the PR with their actual execution results.

The ordinary acquisition SQL verifier adds actual catalog completion and
automatic/manual review, current default changes, human-pending protection,
immutable source/jobs, no implicit stock, language-aware preview/lots/members
and replay. The opt-in desktop/phone spec exercises actual UI creation/uploads,
the built catalog/automatic-review services with controlled saved OCR/local
catalog responses, readable conflict, draft reload, manual override, frozen bulk
recovery, later default, final explicit Inventory addition and replay.

## Author qualification, October 23, 2026

- Product source `2c8e1786d33f971934be4570ffe3a737354a5f44` passed the
  canonical root Dockerfile production build, including compilation, types,
  static generation and client-manifest checks. Tested image:
  `sha256:2b562ea9aa672464111cf6bc2b85cd10b1daf93a0b96f74ba93b8c10bfd8f651`.
  All 1,290 declared build inputs match its exact Git export; input digest
  `454db7bf8a1a37bc74d7c249140273dab35f4af0bd39b4e4b68c4c4097e7f468`.
- The full actual PostgreSQL acquisition verifier passed, including the new
  language cases and existing writer/concurrency/privacy/retention controls.
  Independent before/after counts and row digests match for all 85 public
  tables. The production runner omits raw route/component/test/tool/docs source;
  the verifier container received exact Git-export verification-only additions,
  with copied bytes read back and hashed. Runtime library/scripts/Prisma/bundle
  files were not replaced. This test composition is distinct from a bare image.
- Browser verifier source `9338ae1c` passed both Chromium cases, desktop1366
  and phone320, in 26.2 seconds against that same image. It exercised actual UI
  creation/uploads, readable conflict, draft reload, manual French override,
  lost-success/retry with identical original English confirmation bodies, later
  French defaults, saved review preservation, no implicit stock and explicit
  Add5. The result is English3/French2 in two lots, two audits and five receipt
  members; replay changes none. Original bytes and processing jobs stay exact.
  Both cases restore all 85 table fingerprints and remove their originals.
- The full Windows unit suite at `9338ae1c` reports 1,650 executions, 1,644
  passing, zero failures and six platform skips. Those skips cover Linux
  descriptor/symlink cases and the actual compiled Windows helper report;
  portable/unit checks do not stand in for those platform executions.
  The refined35 focused checks, typecheck and changed-file lint also pass.

The first SQL attempt used whole Prisma Card objects in its expected recognition
index, so Date objects differed from their persisted JSON strings. The fixture
now uses the actual RecognitionCard identity projection; equality is still exact.
All 85 tables were independently verified restored after that failure. The first
browser attempt omitted reopening the Inventory panel after reload; the next
completed Add5 but used nonexistent membership `id` ordering in its final query.
The fixture now follows the visible Inventory link and orders by the actual
`candidateId` primary key. All four failed browser cases restored all 85 tables;
their logs, traces and screenshots remain preserved. These were verifier fixes;
the tested application image did not change between browser attempts.

Later changes after the product build are limited to that browser verifier and
this evidence guide. Exact source binding, terminal/cleanup receipts and hosted
final-head CI/readiness belong to the PR; neither older-head CI nor the local
tests substitute for final-head checks or independent review. The fixture and
guard opt-ins follow [review acceptance](ACQUISITION_REVIEW_ACCEPTANCE.md).

Controlled observations do not establish native recognition accuracy, physical
scanner, sustained/full-catalogue performance, production deployment or user
acceptance. Opener PR955 and the broader #308/#302 acceptance remain separate.
