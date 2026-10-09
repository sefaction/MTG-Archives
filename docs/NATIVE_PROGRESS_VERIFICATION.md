# Deterministic native progress verification

Issue [686](https://github.com/sefaction/MTG-Archives/issues/686) concerns the native output-limit test's timer-based assumption that three progress frames arrive separately. A prior full core run passed 865 tests and saw one callback rather than the expected two; the unchanged native file and a subsequent full core rerun passed. The runtime still rejected oversized output.

A controlled probe of the unchanged timer fixture and unchanged runtime now confirms the mechanism. With an idle consumer, stdout delivery lengths were `[10,23018,23028,23028]`, two frames parsed, and rejection was `OUTPUT_LIMIT`. With the consumer paused for 120ms after its first callback, delivery was `[10,23018,46070]`; the second and third frames plus final reply coalesced. Their aggregate bytes exceeded 65,536 before the chunk was parsed, so one callback was correct. This controlled observation does not recover the earlier run's unrecorded chunk grouping.

The test now waits for an acknowledgement from the consumer before sending each later frame. It checks both an idle consumer and a consumer deliberately paused for 120ms at each callback. Two 23,000-character progress frames must parse; the third must reject specifically with `OUTPUT_LIMIT`, and a single failure observation must occur when the child closes. The first frame is written in two pieces; no claim is made that an operating system must deliver those pieces as separate read events. Existing coalesced-progress, protocol, process reuse, cancellation and environment tests remain intact.

Acknowledgements are one-byte synthetic markers in an owned temporary directory. That directory and marker alone are made readable by Linux's isolated native child; application permissions and native identity remain unchanged. The marker and directory are removed after native shutdown, including failure paths. Production runtime, output limits, worker processes, model inputs, database/data and application sources are unchanged.

## Qualification

- All six native tests pass on Windows and in an isolated container from the currently running cumulative app image, with networking disabled, read-only root/test sources, bounded CPU/memory and temporary marker storage only. The first Linux qualification returned `EXIT` because the newly created marker directory was private to root; the fixture was corrected to accommodate the existing dropped child identity. That failure is retained separately from the corrected six-test pass.
- Initial feature full core passed 859 tests, types and the production build. Final fixture unit/type, cumulative integration, unchanged app/native source and service/data conservation, and final-head CI gates are pending; their results must be recorded before review readiness.
- This is verification reliability. It does not change recognition accuracy, scanner acceptance, sampling/retention or Inventory behavior. No local web/native reload is needed when unchanged application build inputs match the running images. Cumulative local review still includes separately unapproved PR684 and PR687.

See WORK_CHECKPOINT.md for exact commits, images, runners and final results. Keep issue686 open until its individually approved resolving PR merges.
