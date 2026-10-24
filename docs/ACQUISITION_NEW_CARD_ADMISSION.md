# New-card catalog admission integration

This bounded software control addresses the new-card admission boundary recorded
in [#307's October 20 acceptance transfer](https://github.com/sefaction/MTG-Archives/issues/307#issuecomment-6306902872).
It extends the existing disposable acquisition database fixture rather than
introducing another qualification pipeline. Related roadmap: #302.

The fixture starts with no local rows for its random synthetic printing IDs.
Saved synthetic OCR supplies an observed set/collector/language and exact title.
The actual reconciliation handler, Scryfall request builder, provider response
validator, pagination, PostgreSQL cache/Card writer and recognition snapshot
refresh run together. Only HTTP responses are substituted, within a `finally`
scope that restores fetch and the three process-local Scryfall settings.
The configured `.invalid` origin and internal container network prevent a live
provider request; this is not live-provider availability or optical evidence.

The finite sequence asserts:

- Two malformed-identity responses are rejected before Card publication.
- Two lookups each stop at an interrupted second page: six HTTP calls, no
  transport retries, unresolved coverage and no strong/automatic acceptance.
  The validated first printing may be retained, but cannot prove uniqueness.
- After explicit fixture-only cache expiry, three requests enumerate the two
  valid printings. The original and List counterpart are both proposed for
  manual review; the already-published local Card ID remains unchanged.
- A warm retry makes zero further HTTP requests. The original OCR/output stays
  immutable, and complete Inventory rows match before/after all three phases.
- Requests contain only the expected public printing/name/page parameters,
  never photo/account bodies. Provider-supplied `next_page` URLs are not followed.

## Author qualification — October 23, 2026

Source base: main `932e305c2721c2ede97a6c8aebb84e9d7b9953a8`.
Changed verifier SHA-256:
`278419516ec9c90d5ddd158545fa1a1939cd3b44ba08e74c150e80b210f5d52c`.
The full `scripts/verify-acquisition-store.ts` suite passes, including existing
ownership, concurrency, rollback, replay, correction/restore, scanner-software,
writer and terminal fixture cleanup controls. No existing acceptance assertion
or deadline was removed. The normal acquisition CI job already invokes this
suite; no workflow or additional always-on service is needed.
Current-schema `tsc --noEmit` and whitespace checks also pass. The first compiler
attempt exhausted its default approximately 1 GiB JavaScript heap; the terminal
retry uses a 1536 MiB process heap inside the unchanged owned 2 GiB container.
The failed attempt is retained; no shared resource limit was raised.

Local execution used PostgreSQL 16 on a new internal network, a tmpfs database,
no host ports and no host/application mounts. Runner limit: 2 GiB / 2 CPUs;
database: 512 MiB / 1 CPU. Admission budget: 3 GiB Docker memory, 2 GiB Windows
reserve and 2 GiB storage. Observed availability was approximately 22 GiB in
Docker, 71 GiB on Windows and 514 GiB on E:. Existing review services/data were
preserved. These are dated samples, not general resource guarantees.

The owned runner reuses installed dependencies from image
`sha256:dd347915db85b8985a2d15e5a603fb4e483b66f7816133fb646e5b28d79c5d8d`.
Its embedded build manifest matches the fixture's package-lock SHA-256
`1603be4dc0593013938fdc515ba9f10a818a3200ba7866c6e58c0cabb394ef33`;
Prisma 6.19.3 is freshly generated for current source inside that runner. This
reuse is local evidence; required exact-head CI uses its normal fresh install.

Initial setup stopped because the runtime image omits `/app/package-lock.json`.
The embedded source-manifest comparison supplied the binding instead. Automatic
approval review initially mistook inherited Compose image labels for a shared
runner; exact newly created runner/database IDs, owner labels, network namespace,
empty mounts and database URL were inspected before the command was approved.
Neither event was an executed database test or a product failure.

This changes tests only. It needs no application image rebuild or browser reload.
It does not qualify live HTTP, all languages/faces/suffixes, native inference,
independent printing accuracy, scale, historical generation reproduction,
installation deployment or user acceptance. Keep #307/#302 open. Final-head CI
and independent source/evidence review belong to the PR; individual Brian
approval is required before merge.
