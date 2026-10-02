# Local restart recovery qualification — October 2, 2026

Issue [585](https://github.com/sefaction/MTG-Archives/issues/585) tracks the later local PostgreSQL/worker failure window. This batch is separate from the application parent-deletion fix in [PR586](https://github.com/sefaction/MTG-Archives/pull/586), on which it is stacked.

## Established incident timeline

All times below are October2,2026, Central daylight time.

| Time | Evidence |
| --- | --- |
| 04:00:29.208 | Windows System/User32 event1074 records shutdown.exe requesting a planned restart, reasoncode0x800000ff. Requester identity and private fields omitted. |
| 04:01:29.642 | Docker backend records disconnect/shutdown signals. |
| 04:01:30.131 | PostgreSQL cannot open pg_filenode.map because of I/O errors; catalog ADMISSION/P2010 follows at04:01:30.136. |
| 04:01:34–35 | PostgreSQL WAL and pg_control I/O PANIC; further catalog UNKNOWN stops align with failed connections. |
| 04:02:12 | Windows records the shutdown transition. |
| 06:28:01 | Docker/WSL starts again. |
| 06:28:22–34 | PostgreSQL reports an interrupted database and startup recovery; workers see rejected startup connections. Database becomes ready06:28:34.746. |

This supports planned OS restart/Docker teardown as the incident context. It does not establish a physical disk defect, who requested the restart, or the cause of earlier uninstrumented application exits. Workers recovered under their existing normal restart policies. No production operation occurred.

## Guarded local recovery drill

The first capture used the qualified PR586 image with eight exact MTG worker IDs stopped. It rejected source database equality, retained its private archive without a successful evidence.json, and did not start any isolated restore. The reported stage was the last table compared, not proof that migrations changed. All eight original workers were restored and Inventory, saved-review and photo identity hashes remained equal.

A twelve-second read-only probe then showed live ScannerAgent heartbeat metadata changing through the website despite stopped background workers. Existing normal host helpers were not touched. Issue [588](https://github.com/sefaction/MTG-Archives/issues/588) tracks the resulting capture-quiescence gap.

The new optional --quiesce mode checks the local engine, exact Compose identities, standard repository-bound mounts and terminal scanner runs. It records original service IDs/states before mutation, stops only originally running known MTG worker roles and pauses web. A same-image helper captures with all four source appdata roots mounted read-only and only its new private archive directory writable. It checks terminal runs again after pausing. Capture success or failure resumes web and attempts every intended worker restoration before isolated restore. Failure diagnostics retain only changed table names, counts and content-change flags. Scanner/auth data remain in full comparisons.

The source database remains running and is never a restore target. The existing isolated restore uses a UUID-owned PostgreSQL16 target on an internal network with no host ports or outbound workers. Deployment credentials, external model/index/reference mounts and the separate pricing database are outside this application archive.

Pending: qualify the new capture against the rebuilt image, isolated restored database/file equality and negative controls; verify disposable cleanup, exact worker-state restoration, source conservation and HTTP health. No recovery success is claimed yet. Failed and successful evidence remain private under separate UUID backup directories.
## Operational boundary

For a planned laptop restart, finish or drain any real physical scan first, stop active tests, save the checkpoint, and stop the local Compose stack gracefully before shutting down Docker/Windows. Normal background work requires an awake, powered, connected laptop. No Windows power/update policy or automatic shutdown hook was changed.

The drill qualifies snapshot integrity within its stated comparisons. It does not establish cross-resource atomicity, indefinite uptime, production recovery or scanner epoch/credential/lease fencing after a full disaster restore. Those remaining acquisition recovery gates stay tracked in issue310 and docs/SCANNER_NATIVE_START.md. The source Inventory/review/photo conservation checks remain mandatory.

