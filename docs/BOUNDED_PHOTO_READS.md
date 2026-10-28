# Bound private photo descriptor reads

Related to existing #305 and release tracker #310. This completes one storage-read boundary, not either tracker’s full acceptance scope.

The private photo reader previously checked pathname metadata, opened the file and called `readFile()`. A file growing after the metadata check could consume and return more than the existing 10 MiB limit. A supplied digest might reject those bytes afterward, but could not bound the read itself; reads without a digest could return them.

The reader now reads chunks of at most 64 KiB and consumes at most 10 MiB plus one overflow-detection byte. Oversized data is refused before concatenation or digest checking. Existing pathname/no-follow checks, exact byte order, digest checks, descriptor closure and ordered primary/close failures remain. The source file is never changed by a refusal. Ordinary EOF and short reads retain their existing meaning.

## Author verification

Base: main `0b514d2a061e06b09b1ebb3a04a52cbd9fb9f8da`.

- Thirteen new controls compile the complete production declarations and use real files/descriptors. Unchanged base source gives **7 passes / 6 expected failures**; the candidate passes all thirteen. Cases cover growth after pathname stat for original/preview with and without matching digests, growth after descriptor opening, overflow plus close failure, empty/one-byte/multiple-chunk/exact-limit reads, short reads, early oversized refusal and digest rejection. The overflow budget is asserted; independent neighboring bytes are conserved.
- Windows serial checks: **91 passes / 3 existing platform skips** across the new tests, existing read/removal/write-cleanup controls and related real-photo/partial-file/upload tests. The existing error-control adapter now forwards real descriptor `read` calls; its original assertions are unchanged.
- Isolated Linux checks: **94 distinct passes / zero skips** across the same checks. The dependency image initially lacked its generated Prisma client: the 74 independent filesystem controls passed, while three related modules could not load. Generating the client against the exact candidate schema allowed all 20 related cases to pass. Installed TypeScript, tsx, zod, sharp, Prisma and client versions match the lockfile.
- A disposable PostgreSQL/Next.js development review executes real upload, canonical worker preparation and original/preview HTTP reads at **1366 and 320 pixels**. Both image variants decode correctly in Chromium; original bytes, private/no-store headers, anonymous/different-owner refusal, zero Inventory/commit writes and populated peer rows are checked. The scan pages have no horizontal overflow and screenshots were inspected. Cleanup restores full-row fingerprints for **all 85 public tables**. The first browser attempt failed before reaching the app because Docker did not publish its internal-network port; that attempt also restored all 85 tables. A dedicated loopback-only frontend network resolved the harness issue.

The local review uses the complete base source plus the candidate library/test files, real migrations and generated client. It is compiled development-mode workflow evidence, not a production build or an installed-production qualification. Required exact-head CI, independent review and Brian’s individual merge approval remain separate gates; the PR records their current status.

## Evidence limits

File growth is deliberately injected into owned synthetic originals; no historical incident, hostile writer, natural storage fault, optical/native accuracy, scanner operation, production change or broad release acceptance is claimed. Earlier test-launch/export/client/network failures remain in private evidence. No schema, authorization, quota, retention, worker scheduling, recognition or Inventory policy changes are included. The desktop owner’s separate correction-library retry durability work remains untouched.
