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

## Fresh paired qualification — October 15, 03:30 UTC run

The existing images and code were qualified again in one fresh, strictly bounded serial window. This addresses the saved current-runtime qualification gap. It does **not** restore the first failed parallel startup or the older unexplained aggregate Config interval. Scoped author qualification for the private memory observation is PASS in this fresh window; broader parallel startup/resource acceptance remains incomplete under812 and the historical parent evidence. Readiness remains the separate reviewer's responsibility.

Before mutation, all three current containers exactly matched the saved field-rich baseline, the manual scanner owner was idle, all review work/data counts were0 and all16 primary/seven review roles were recorded. No application or native image was rebuilt. Only visual, printing and recognition were recreated, one at a time, from the same existing compose file, images, models and policies.

All three retained their models and passed startup without a native failure, init restart or OOM. Container-start-to-readiness times were31.008s visual,3.797s printing and40.962s recognition; these include process startup/preparation and are not measurements of the describe subphase. Existing30-second describe deadlines and all other deadlines remain unchanged. This serial case does not reproduce or resolve the original parallel timeout.

Every Config field and environment key/value was compared. Only Docker's default Hostname and environment array ordering changed; canonical environment maps and all keyed value hashes match exactly. Image, command, privilege, resource, storage and other configuration fields are preserved. Mounts remain exact.

The first fresh raw HostConfig equality assertion failed for visual because four Bind entries were reordered. That failure and its original script/log are retained. Exactly restoring their order among24 bounded permutations reproduces the original whole HostConfig hash8bf720efd593e86f94accd5ec915933685e654c1dc21cfddda72d3d7c20bab5c. This proves all other fields and bind values/multiplicity unchanged; it is not a resource-policy exception. Deliberate in-memory Memory and mount-value changes both fail that exact-hash guard. The already successful visual startup was reused, and only the remaining two roles continued. Printing and recognition HostConfig hashes match raw. No prior failed record was changed into a pass.

All16 primary and four unrelated review roles preserve full identity/image/configuration/storage/lifetimes. Primary native event counters remain exact, including printing's old six kills and10847 max events. The new review cgroups each have0 max/OOM/kill/group events; no cross-container delta is claimed across recreation. All332 source inputs match each actual native worker. The same626/e482 cumulative and624/f12c web manifests remain applicable, and local loginHTTP200.

Fresh before/after proofs preserve the same catalogue118505/109292 and projection, all157 primary original byte hashes, entire review upload tree,11 actual owner/auth/deck/Inventory/correction/session table fingerprints and the one absent-table marker. No fixture or Inventory writes occurred; review jobs/capture/sessions/Inventory/examples remain0. Existing successful portable/Linux controls and exact implementation CI were reused because code/images did not change. This report's exact-head required CI is tracked separately in the PR/checkpoint.

New exact evidence and current container baselines are under ignored .local-data/native-memory-requalification-20261015: fresh-qualification.json, serial-first-terminal.json, host-config-order-proof.json, ordering-negative-controls.json, serial-terminal.json, runtime-proof.json, current-field-rich-config.json and paired source/data/counter records. The original .local-data/native-memory-qualification failures are preserved. Do not repeat this completed fresh window without new changes or evidence; continue812's bounded describe timing investigation while808/805await their existing reporter/input details.
