# Bound private photo descriptor reads

Related to existing #305 and release tracker #310. This completes one storage-read boundary, not either tracker’s full acceptance scope.

The [initial author checkpoint](PHOTO_READ_CHECKPOINT_HISTORY.md) is preserved separately; current main's complete shared checkpoint is unchanged.

The private photo reader previously checked pathname metadata, opened the file and called `readFile()`. A file growing after the metadata check could consume and return more than the existing 10 MiB limit. A supplied digest might reject those bytes afterward, but could not bound the read itself; reads without a digest could return them.

The reader now reads chunks of at most 64 KiB and consumes at most 10 MiB plus one overflow-detection byte. Oversized data is refused before concatenation or digest checking. Existing pathname/no-follow checks, exact byte order, digest checks, descriptor closure and ordered primary/close failures remain. The source file is never changed by a refusal. Ordinary EOF and short reads retain their existing meaning.

## Short-read storage correction — October 31, 2026

Independent review of the first implementation found that every short read retained a separate 64 KiB backing allocation through its small subarray. A controlled valid 377-byte PNG with one-byte real descriptor reads retained 24,707,072 backing bytes before concatenation, despite consuming only 377 bytes. That review remains recorded on PR #979; Brian explicitly assigned the correction to the current author.

Partial reads now fill the same owned buffer until it is full. Only filled chunks and the final populated slice enter the retained array. Retained payload storage and array entries depend on payload size rather than the number of reads: at most 160 payload chunks for the 10 MiB limit, plus one bounded current/overflow-detection buffer. The separately returned concatenated buffer is still required; this is not a total process-memory or RSS bound. Read limits, exact order/digests, no-follow checks and primary/close failure behavior remain unchanged.

- Eight bounded-size memory controls fail on the actual old reader. The larger one-byte/chunk-crossing case is deliberately excluded from the negative run to avoid allocating its amplified old storage.
- All twelve new controls pass after correction, including original/preview with and without digests, multi-chunk partial reads, 65,539 one-byte real reads followed by EOF, partial read/close causes and digest/close ordering. The original thirteen bounded-reader controls and read/removal assertions are unchanged.
- Windows: 61 distinct focused/related passes and one existing Linux-directory-descriptor skip. Linux Node 22: all 62 distinct controls pass, including the real directory descriptor. The first Windows command named a nonexistent additional file; its 25 actual passes cover only the new and original bounded-reader suites. The corrected separate command supplies the 36 related passes/one skip; no missing suite is counted as executed.
- The original valid-PNG counterexample now retains one 65,536-byte backing store instead of 24,707,072 bytes. All 377 bytes/digest, 378 real descriptor calls including EOF, the independent neighbor and descriptor closure remain exact. This measures retained backing stores at concatenation, not RSS.
- Fresh development-mode desktop1366/phone320 workflows pass real upload, canonical preparation, original/preview decoding, private headers, other-owner/anonymous refusal, oversized-body refusal and acknowledgement replay. Canvas pixels and screenshots are inspected; populated peer stock/two copies and independent bytes remain exact, no Inventory/commit writes occur, and the complete two-width workflow restores all85 public-table fingerprints. This is one paired restoration, not a separate85-table pair per width.
- Runtime source288e5b17 has all1,328 declared inputs/digest40ded696 read back equal to its exact Git archive. The final main integration adds the separately qualified #983 test files; application/library/schema inputs are unchanged. That input reuse and fresh exact-head CI are separately recorded on the live PR. This is source-overlaid Next.js development evidence, not a production image build or an installed qualification.
- All three new temporary containers (one Linux control plus two browser/database services), two sole synthetic volumes and two empty networks are retired after exact ownership/terminal checks. Owned uploads are independently empty; all13 primary service identities/configurations/lifetimes remain exact. Earlier source-bound author evidence below remains historical evidence; it is not promoted to a new cumulative runtime pass.

No historical short-read incident, RSS/OOM cause, native/optical result, deployment or broad #305/#310 completion is inferred. The separate correction-directory durability and #958 work remain outside this correction.

## Original author verification

Base: main `0b514d2a061e06b09b1ebb3a04a52cbd9fb9f8da`.

- Thirteen new controls compile the complete production declarations and use real files/descriptors. Unchanged base source gives **7 passes / 6 expected failures**; the candidate passes all thirteen. Cases cover growth after pathname stat for original/preview with and without matching digests, growth after descriptor opening, overflow plus close failure, empty/one-byte/multiple-chunk/exact-limit reads, short reads, early oversized refusal and digest rejection. The overflow budget is asserted; independent neighboring bytes are conserved.
- Windows serial checks: **91 passes / 3 existing platform skips** across the new tests, existing read/removal/write-cleanup controls and related real-photo/partial-file/upload tests. The existing error-control adapter now forwards real descriptor `read` calls; its original assertions are unchanged.
- Isolated Linux checks: **94 distinct passes / zero skips** across the same checks. The dependency image initially lacked its generated Prisma client: the 74 independent filesystem controls passed, while three related modules could not load. Generating the client against the exact candidate schema allowed all 20 related cases to pass. Installed TypeScript, tsx, zod, sharp, Prisma and client versions match the lockfile.
- A disposable PostgreSQL/Next.js development review executes real upload, canonical worker preparation and original/preview HTTP reads at **1366 and 320 pixels**. Both image variants decode correctly in Chromium; original bytes, private/no-store headers, anonymous/different-owner refusal, zero Inventory/commit writes and populated peer rows are checked. The scan pages have no horizontal overflow and screenshots were inspected. Cleanup restores full-row fingerprints for **all 85 public tables**. The first browser attempt failed before reaching the app because Docker did not publish its internal-network port; that attempt also restored all 85 tables. A dedicated loopback-only frontend network resolved the harness issue.

The local review uses the complete base source plus the candidate library/test files, real migrations and generated client. It is compiled development-mode workflow evidence, not a production build or an installed-production qualification. Required exact-head CI, independent review and Brian’s individual merge approval remain separate gates; the PR records their current status.

## Evidence limits

File growth is deliberately injected into owned synthetic originals; no historical incident, hostile writer, natural storage fault, optical/native accuracy, scanner operation, production change or broad release acceptance is claimed. Earlier test-launch/export/client/network failures remain in private evidence. No schema, authorization, quota, retention, worker scheduling, recognition or Inventory policy changes are included. The desktop owner’s separate correction-library retry durability work remains untouched.
