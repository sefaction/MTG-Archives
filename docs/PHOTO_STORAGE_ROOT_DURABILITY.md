# Original-photo storage-root durability

Related to existing #305 and #310. Both remain open.

A first photo creates `acquisition-v1` inside the configured private storage
root. The writer synced the photo file and `acquisition-v1`, but never synced
that directory's entry in the containing root. The same gap remained on an
existing-file retry. A successful child-directory sync alone does not confirm
its own parent entry: see the Linux [fsync(2) directory requirement](https://man7.org/linux/man-pages/man2/fsync.2.html).

The configured upload root is the provisioned storage mount in the supported
Compose configuration. This correction concerns the photo directory's entry
inside that root; host/mount provisioning and physical power-loss acceptance
remain separate. The finding is a code-level missing barrier, not an observed
lost photo or a diagnosis of a historical incident.

The writer now attempts both child and containing-root open/sync/close barriers
before acknowledging either a new or an existing original/preview. A failed
barrier still leaves complete immutable bytes available for a deliberate retry,
but cannot acknowledge success. All independent closes and temporary cleanup
remain attempted. Multiple causes keep operation order, the first safe storage
code, and single/falsy failure identity. Read paths, byte/pixel limits, quotas,
Windows behavior and explicit Inventory authority are unchanged.

## Evidence

- On unchanged main6d53e8a1/module487185cf, actual complete writer/read/path
  functions acknowledge both raw/preview initial writes and existing retries
  while never opening or syncing the configured root. Owned real bytes and an
  unrelated neighbor are preserved. This Windows probe models Linux directory
  descriptors; it does not reproduce power loss.
- Thirteen new real-file controls: old1pass/11expected failures/1Linux-descriptor
  skip; corrected related suite148Windows passes/4platform skips and152Linux
  passes/zero skips. Repeated focused runs are not summed. Root open/sync/close
  refusal persists across first publication and immutable retry; recovery does
  not rewrite bytes. Combined child/root/close/unlink and falsy causes remain
  ordered. Real Linux descriptors and unchanged Windows behavior are covered.
- All original writer-test assertions remain. Only its directory-descriptor
  adapter gains a successful independent root handle while continuing to target
  its original child failures. The original80 browser assertion nodes and
  180-second case deadline are byte-identical by an AST comparison. The existing
  two child-directory cases are retained; two root cases are added.
- Local application/test source6517f563375af056a9ee9fa7f304feb4b1fb42ff builds imagesha256:d41dc9f1f6d79c3ad08637aa181eea84b8d1df12704c9aac325f9169c037a106. All1,336 declared
  canonical LF Git/archive/build inputs match, digest1b1ae05346fdaaa24c5fe22361e78ce33eaea3803cda37028e51a59358200278. Full compilation,
  the same pinned Next15.5.25 complete type/lint gate in a separate process,
  generation, client-manifest checks and Linux controls pass. This is a manually
  phased local production snapshot, not a canonical Dockerfile build; no type or
  lint error is ignored. One build worker uses pinned default CIRCLE_NODE_TOTAL2.
- The full actual acquisition PostgreSQL suite passes on that image; all85
  table fingerprints restore exactly. This is ordinary shared-workflow
  compatibility, separate from the controlled browser failure below.

The actual production raw-upload matrix passes all four cases in49.8seconds at
1366px/320px, covering both the original child failure and new root failure.
Persistent refusal returns sanitized409 feedback, retains one non-READY photo
with zero artifact/candidate/job/commit effects, and preserves source bytes and
existing stock. Removing only the controlled fault recovers the same
photo/slot/upload identity and creates the original one artifact/candidate/job.
READY receipt replay remains effect-free even with the fault enabled again.
Every case independently restores all85table fingerprints; the final review and
SQL baselines are read back exact, uploads are empty, and the root desktop/phone
pending/recovered screenshots were inspected. No horizontal overflow appears.

## Failure evidence and resource limits

Initial fixture startup accepted PostgreSQL's temporary bootstrap socket as
ready, then reached the final-server restart gap before creating the SQL
client or running any migration/product verifier. The failed setup/log and
exact resource identity are retained. The same owned database was inspected
final-ready without an OOM kill, resumed using TCP readiness, and used without
reset or duplicate fixture creation. No failed setup is counted as a product
pass. Private draft-controller corrections before execution supply no test
coverage.

The sole build, SQL client, production web and PostgreSQL containers are
terminal and retired. All three sole-owned synthetic volumes and two empty
networks are removed after identity/reference checks and conservation. All13
pre-existing service IDs, images, configuration, mounts, start times and restart
counts match the baseline. Exact runtime reservations are released; the review
image, source archive and compact manifests/logs/screenshots remain.

Controlled Linux directory-sync refusal tests application pending/READY and
retry behavior; it is not a physical power-loss, host-filesystem or new natural
ENOSPC experiment. Browser cases cover raw upload, authentication, sanitized
feedback, receipt replay and table/stock/source conservation. Preview behavior
is covered at the real-file API boundary; no new native OCR/canonical-worker,
recognition accuracy, installed deployment or user-acceptance pass is claimed.
Existing child-directory retry #977, inode/process-loss #983 and separately
owned byte-write #989 and correction-library #984 keep their own scopes.
