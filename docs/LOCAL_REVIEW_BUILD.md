# Local review build — vault pilot

Verified 2026-09-19 on this laptop. This is a local review deployment, not a production release.

- URL: http://127.0.0.1:13001
- Application code: `92265999654a2e789e629f47fdcb5223daca560a`
- Included setup commit: `266a888bd805b9e85663e5e1964c29e69295804d`
- Included unmerged PRs: [#210](https://github.com/sefaction/MTG-Archives/pull/210), [#217](https://github.com/sefaction/MTG-Archives/pull/217)
- Web image: `sha256:8be875f43806106a51f916103d2be7ecc78ecfb41ed79cc447086d040b418636`
- Next build ID: `ATbj2FnvmeVV-E27ougst`
- Web container healthy; Windows host login URL returned HTTP 200.
- No schema migration or reassignment of existing card placements. Normal Compose builds recreated local service containers while preserving persistent data.

## Final validation

`MTG_LOCAL_PILOT_TEST=1 npm.cmd run verify` completed successfully after the Docker build finished, with no concurrent build:

- Prisma generation: passed
- Typecheck: passed
- Automated tests: 504 passed, 0 failed
- Host production build: passed
- Docker production build: passed separately
- Browser suite: 25 passed, 0 failed, 2 skipped in 1.8 minutes
- The two existing skipped tests require inventory-detail/meld fixtures absent from this account; they are coverage gaps, not passes.
- The opt-in vault browser regression passed creation, copy-limited single/multiple selection, overflow, refreshed counts, desktop/phone layout, non-admin owner isolation, and copy totals across multiple pages.
- Real PostgreSQL checks passed 13 cases including reservations, audit links, quantity conservation, stale selections, concurrent requests, and a 150,000-copy / 3,000-row / 1,200-location storage-summary fixture. Observed summary query time was 121–157 ms; this is not a full-page scale benchmark.
- Desktop and phone screenshots were visually inspected. Temporary database/browser fixtures were removed; subsequent fixture counts were zero. They are synthetic and reproducible by the test commands.

An earlier run overlapping a Docker rebuild had search navigation timeouts. The clean final run passed both search tests. Keep rebuilds and browser runs sequential on this laptop.

## Review

Open Locations, expand the Vault group, and inspect the six section counts. On Inventory in Exact printings mode, select rows to reveal the destination picker and copy-limit controls. Existing nonstandard labels are preserved and not silently remapped.

PR #217 is stacked on #210 for a clean diff. Individually approve/merge #210 first, then retarget #217 to main and recheck before separately approving its merge. Do not merge #217 into the setup branch. No merge or auto-merge has been performed.

See [VAULT_PILOT.md](VAULT_PILOT.md) for acceptance scope and remaining audit gaps. Large-tree UI work is tracked in #215. Scheduled unattended execution is still not configured.
