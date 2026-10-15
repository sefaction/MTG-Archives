# Private native memory failure windows

Related: [809](https://github.com/sefaction/MTG-Archives/issues/809), [draft811](https://github.com/sefaction/MTG-Archives/pull/811). Implementation69087d1b4f8b4755f8467e172eede930df7f767e adds observation around native child generations. Historical803/755/777 causes remain UNKNOWN.

## Contract

Before a child starts and after a failure closes it, the existing private observer receives bounded self-cgroup-v2 memory gauges and whitelisted event counters/deltas. Warm streams use the child generation lifetime, including preparation and idle exits; this is not a per-job measurement. Other processes can share the group. A delta never proves which child was killed or why. Gauges/high-water marks are snapshots, not deltas or independent throughput evidence.

Only fixed files under a namespaced root are read, at most4096bytes each. Safe integer parsing rejects overflow, malformed/duplicate/missing required counters; unknown future event names are not projected. Platforms/non-root membership/missing or malformed files are explicitly unavailable. Counter decreases and scope changes retain samples but produce no delta. Internal group identity, paths, errors, process arguments/environment, photos, stdin/stdout/stderr and credentials are not projected.

Public trusted error fields remain reason/exitCode/signal/systemCode in the existing WeakMap. Memory exists only in the private observer record. Observer failure cannot replace the original error or prevent retirement. Successful calls remain quiet; intentional shutdown is not logged. Child identity isolation, inputs, retries, lease/deadline/resource limits and human Inventory authority are unchanged.

## Completed controls

39 Windows native, generation, preparation, printing-stop and privacy controls pass without skips/retries; types pass. SourceCI38666973550 passes all three required jobs on exact69087d1. Final-report CI is recorded against its exact head in the PR/checkpoint.

A disposable Linux control passes11 parser/window/privacy/failure controls. Explicit one-shot and warm SIGKILL controls prove available counter windows, zero OOM deltas, retirement before reuse, separate public error projection and quiet shutdown. The same explicit controls also pass in both exact new native images. No OOM was deliberately generated.

Retained failures: the first capability-free root harness failed existing UID/GID-drop spawn with EPERM; only its disposable SETUID/SETGID/KILL permissions were corrected. The initial cumulative byte guard failed on two LF-to-CRLF checkouts; exact tested bytes were copied after Git-blob and newline-only identity checks. The guard was not relaxed. A read-only SQL quoting harness and an image-ID-as-FROM reference failed before runtime mutation; their failed sources/logs remain retained.

## Cumulative local load and limits

Cumulative branch codex/background-fixture-local-review includes806/810 plus implementationebabc37. Full626-input manifest e48219dc6fc75347f29b9a396c65129294e1fc71d4aeaf7cbc3e62accee3841c differs from the existing624-input web manifest only in the five intended native library/script inputs. Web remains unchanged at f12c4b44ff6726ba9afc5601c02eded60f5fb423b1ab433417b27d2af7d42bf0. Only the three idle isolated native workers were recreated; no heavy web/dependency/native-model build occurred.

Two small COPY-only images retain every immutable base layer and exact image configuration. All332 native library/script inputs match cumulative source in both images and all three actual running workers. Their model identities match the previous qualified runtime. Review image IDs:

- OCR: acb39102ae99eabcc554ffc82397a3ed8c9d7bddaac930c3e3306ce2f9da6635
- Visual/printing: 6f4c87e1f7cb5197dba852568f02ba26d2dbb1a86dcc12e1092c6ab6739e2112

All16 primary services and four unrelated review roles preserve exact identity/image/configuration/storage/lifetimes. Targeted HostConfig, mounts and command hashes match. The three targeted aggregate container Config hashes differ: **the original full Config guard FAILED and the explanation remains UNKNOWN**. Existing before evidence lacks field-level values; bounded metadata-only reconstruction did not restore the hashes. No assertion or historical interval is waived. A new field-rich baseline is saved solely for future qualification.

Fresh catalogue118505/109292 and projection15ea2bf28301d311017fd1f432798ea0, all157 primary original byte hashes, the entire review upload tree,11 actual ownership/auth/deck/Inventory/correction/session table fingerprints and one absent-table marker are unchanged. Review pending/running jobs, capture outbox, sessions, Inventory and correction examples remain0. Local loginHTTP200; no fixture namespaces or application data were created by this batch.

## Real startup failure retained

The initial zero-failure startup check **FAILED**. At01:48:36UTC visual description exceeded its unchanged30-second deadline and logged TIMEOUT/SIGKILL. Its new memory window is available with max/oom/oom_kill/group deltas0, peak903962624bytes under the unchanged3221225472byte limit, swap0. The existing policy recovered the same visual generation at01:48:51UTC. Recognition and printing also report their prior models; current native init restarts/OOM flags remain0/false.

This demonstrates useful natural failure evidence, not the underlying cause or a clean startup interval. Duplicate-checked [812](https://github.com/sefaction/MTG-Archives/issues/812) retains the observed local readiness delay. Recovery does not erase that failure,803's old OOM or any older failed lifetime/configuration interval.

**Overall operational acceptance remains INCOMPLETE;811 stays draft.** Next qualification must preserve the initial failed Config/startup guards and use the saved field-rich baseline for new evidence; investigate812 without forcing host failure or extending deadlines.808 still needs the reporter's affected installation/failing example;805 still needs its exact retained optical inputs. Do not repeat unchanged successful controls or pretend either report is resolved. Separate reviewer owns readiness, approval, merge and issue closure. No primary restart/reset/resource increase, physical scanner operation, production action or capacity check occurred.

Private exact records stay ignored under .local-data/native-memory-qualification in the feature worktree, including initial-readiness-failure-safe.json, startup-timeline-safe.json, conservation-source-proof.json, the original failed conservation-source.log and fresh current-field-rich-config.json.
