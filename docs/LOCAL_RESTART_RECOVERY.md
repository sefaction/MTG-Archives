# Local restart recovery qualification — October 2, 2026

Issue [585](https://github.com/sefaction/MTG-Archives/issues/585) tracks the later local PostgreSQL/worker failure window. This recovery batch follows the approved application parent-deletion fix in [PR586](https://github.com/sefaction/MTG-Archives/pull/586), now merged into main.

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

The second guarded capture was deliberately interrupted when the user returned and ended the autonomous goal. Its archive has no successful evidence.json. The runner restored all nine original service states (website plus eight workers), removed its UUID-owned helper, and source Inventory/review/photo hashes matched. Both earlier archives remain private and unqualified; neither can be used as a successful recovery result.

After the user individually approved PR586 and PR589, PR586 merged with the reviewed source tree preserved. PR589 was moved onto that approved main with its application tree unchanged. A third, fresh UUID capture passed against the verified cumulative image:70 compared tables,12,482 physical copies and all four file roots stayed equal before and after capture. The archive is2,526,802,126bytes; backup creation took341.194seconds. Services were restored before isolated restore. Restore then safely failed before loading data because the drill expected the archive at the root while current backups use application/. Issue590 tracks this drill lookup defect. The correction accepts the current namespace and unambiguous legacy captures, and rejects missing/ambiguous/unrelated names. Final rebuilt-image restore qualification reuses only this successful capture in a new disposable target. This delivery does not resume the broader autonomous issue queue.
The first corrected-path full restore then failed at actual forced restoration after its dry-run/negative controls. Disposable resources were cleaned and source hashes conserved. A separate tiny isolated PostgreSQL16 fixture reproduced missing gin_trgm_ops: schema replacement removes pg_trgm, and schema-filtered dumps omit its extension definition. Rollback preserved the synthetic canary. Issue591 tracks the app restore defect; the correction recreates the known dependency after schema reset inside the same fail-fast transaction. Permanent rollback controls now include a trigram index, and full restore checks the extension. Both the small regression and the complete large restore passed against the final rebuilt image without a working-library override.
The source database remains running and is never a restore target. The existing isolated restore uses a UUID-owned PostgreSQL16 target on an internal network with no host ports or outbound workers. Deployment credentials, external model/index/reference mounts and the separate pricing database are outside this application archive.

## Final qualification result

The complete isolated recovery passed against the final rebuilt image. Forced restore took354.592seconds. All70 compared tables and1,865 file/directory entries across four roots matched the qualified source snapshot, including12,482 physical copies. Migrations were current and pg_trgm was present. Dry-run left the target unchanged; missing/corrupt dump controls preserved the canary; an actual SQL failure rolled back schema replacement and preserved both the canary and its trigram index. Four volatile notification activity tables are included in the archive/restore but excluded from stable-content comparison. CardPriceSnapshot is included and compared by count.

The fresh UUID-owned restore containers and internal network were removed. Capture service-state journal is restored, all original local services are running/unpaused, and HTTP login returned200. Final source conservation matches10,280 Inventory rows/12,482 copies,81 saved reviews and907 photos, including all three original identity/content hashes. Owned native fixture users/agents are zero; existing normal host helpers were untouched. Failed and successful evidence remain private under separate UUID backup directories.

Validation also passed794 unit tests with zero failures/skips, typecheck, production build/lint, ten client manifests and the installer-required Docker build. The loaded cumulative web image is sha256:1a2bc15365a6886aa0a578a942f5b5497711e5628bd5410875116891c1776e7e; all517 source inputs matched digest8ca74de70abb115c60a335e837799d0c02a10a8240ec37c7ca69edb2f6b3cbcf. Both native service lib/script maps match while frozen Python/model mounts are preserved. Exact-head GitHub checks are required before merging PR589 under the existing individual approval.
## Operational boundary

For a planned laptop restart, finish or drain any real physical scan first, stop active tests, save the checkpoint, and stop the local Compose stack gracefully before shutting down Docker/Windows. Normal background work requires an awake, powered, connected laptop. No Windows power/update policy or automatic shutdown hook was changed.

The drill qualifies snapshot integrity within its stated comparisons. It does not establish cross-resource atomicity, indefinite uptime, production recovery or scanner epoch/credential/lease fencing after a full disaster restore. Those remaining acquisition recovery gates stay tracked in issue310 and docs/SCANNER_NATIVE_START.md. The source Inventory/review/photo conservation checks remain mandatory.

