# Paged review fixture correction cleanup

Issue691: https://github.com/sefaction/MTG-Archives/issues/691

The paged-review verifier predates the independent correction library. Its acquisition/user/file teardown did not remove the correction account, evidence, examples, pins and private originals created by its actual review saves. The library deliberately survives acquisition cleanup; production retention is working as designed.

An unchanged cumulative 14-card desktop run passed all UI assertions in22.1seconds, then left1correction account,1blob,13examples,13review events,27evidence records and1retention pin while its user/player were absent. The namespace was empty before the test. Recovery used the shared guarded helper only for the single newly created UUID owner after its acquisition sessions/jobs were retired. All owned records are absent and original source/service projections are conserved. Post-fixture aggregate counts are retained separately from the post-recovery zero observation; no historical worker stop is attributed to this evidence.

The verifier now uses the existing exact-owner correction cleanup after draining routes and cancelling its acquisition sessions. It asserts absence of correction models, its private file namespace and acquisition/account records. Existing actual upload/review, paged navigation, saved revisions, original digest, dirty draft and zero-Inventory assertions remain. Production sampling, retention, queue behavior, application code and verification roles are unchanged.

Qualification is pending for14-card desktop/phone plus100-desktop/300-phone presentation cases, final types/core, unchanged runtime/source/service and original-integrity checks. This is not a native throughput, physical scanner or independent recognition accuracy result. The28 other legacy teardown candidates are tracked separately in issue692; source inspection does not prove failures or qualify their cleanup.
