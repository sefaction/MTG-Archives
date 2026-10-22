# Locations filter review — issue 905 / PR 906

## Candidate and authority

Product/test commit `2c558e351ef5c92750627d1247acc3dded3e3231` includes the
history acknowledgement correction; base main is `11f54612`. This evidence-only
commit changes documentation, with identical application, test and build inputs.
Brian explicitly removed the runtime hold on October 22 and requested carrying
the issue through readiness for review. No merge or production authority follows.

The local candidate is at <http://127.0.0.1:13012/locations>. Synthetic local
review login: `review905` / `review905-local`. It contains two test owners, seven
locations and two synthetic inventory rows totaling 154 physical copies.

## Verification

- All 19 focused component/location/static checks and focused TypeScript pass.
  The two new versioned delayed-history typing/IME cases fail on preceding
  component source and pass after the correction. Original failures are retained.
- Independent source reviewer `/root/review_905`, separate from the author,
  reviewed the complete PR and correction, callers, tests, Next router and
  evidence at product commit `2c558e35`: no actionable findings. The earlier
  exploratory overlapping-response schedule delivers state that Next's action
  queue discards; it does not establish another product defect.
- The local production build, typecheck and client-manifest guards pass. One
  dedicated builder was limited to 2,560 MiB, equal total memory/swap and one CPU.
  Builder-only adaptations set Node heap to 1,536 MiB, `CIRCLE_NODE_TOTAL=2`
  (one Next build worker) and disabled telemetry. Application source, dependencies,
  typecheck and runtime configuration were otherwise unchanged. No OOM kills
  occurred. The completed owned builder/cache was removed.
- All 1,223 declared source inputs match the running image's build manifest:
  `1f32e0858dd718f53ca29714bedadee6587c14c1b09605dd3c2b3f5306459d7f`.
  This binds declared inputs; it is not a whole Docker-context digest, unchanged
  canonical recipe claim or reproducible binary identity.
- Real authenticated Chromium passed four groups at **1366, 390 and 320 px**
  (**12 groups total**): main Locations navigation and Back/Forward restore
  branch/query/space/type/status; rapid filters preserve branch and clear
  pagination/selection; a delayed own-search RSC response preserves newer IME
  input; owner privacy, exact section counts/advisory warning and layout.
- Section checks identify `Sect 0` with `68 / 85`, `Sect 1` with `86 / 85` and
  `1 over capacity`. Screenshots were visually inspected at all three widths.
  Page scroll width equals viewport width; the section map retains its intended
  internal scrolling. No page errors were reported.
- The delay adapter forwards the actual authenticated server response unchanged
  after a timing gate. Browser history checks use real Back/Forward; they do not
  force the exact delayed-history-props interleaving. The versioned negative/pass
  component tests cover that controlled ordering. No natural race frequency,
  physical phone hardware or broad performance benchmark is claimed.
- Full fixture Inventory rows, ownership/location counts and zero audit rows are
  unchanged. The original review database's selected user/location/Inventory/audit
  counts and quantity total match before/after; this is not complete database
  conservation. The app points exclusively at the new isolated database.

Seven required hosted checks passed on product commit `2c558e35` in
[Verify 39844065806](https://github.com/sefaction/MTG-Archives/actions/runs/39844065806).
The final documentation head requires its own seven checks; the PR records their
terminal result. Product-input evidence is reusable because this commit changes
only documentation, outside the declared application/build-input roots.

## Retained review and cleanup

- Web: `mtg-review905-web-01a16522`, immutable container
  `884e2c1c521211cd319d48d9d81ba4f9ff6256b23f69a5ff31fcb02f0521b482`.
  Image: `sha256:5672282a9d87538b94ef6f59399229952a43534f4d309d9bee68716a43cd9aba`.
  The web is limited to 640 MiB and binds only local port 13012.
- Isolated database: `review905_01a16522` inside verified review PostgreSQL
  `e31c324812a04af7df77bc0ee96315ef63c3244c63196065e8a0fede34c9f84f`.
  Original databases, primary services and scanner processing were not changed.
- The current synthetic review app/database/image are intentionally retained for
  Brian's review. Test browser processes, temporary auth sessions, the private
  environment file and dedicated builder are retired. No active test/build child
  remains; the exact runtime claim is released after terminal cleanup.
- Private scripts, reports, traces, screenshots, identities and original failures:
  `.local-data/review-905-20261022/` in the primary checkout. Initial local
  admission was rejected before a build began; the coordinator's corrected
  Docker-VM-aware guard subsequently admitted the measured bounded build.

Keep #905 open until an individually approved resolving merge. Readiness is
separate from merge, production deployment and Brian's acceptance.
