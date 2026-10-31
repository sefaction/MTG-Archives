# Bound retained upload-body memory

Related to existing acquisition storage #305 and release tracker #310. Base: main `8deb01a7`.

`readBoundedPhotoBody` enforced its 10 MiB byte limit but retained every incoming typed-array view until concatenation. A 64-byte body supplied as 64 one-byte views over independent 64 KiB buffers retained 4 MiB. Empty views also retained buffers, and 65,539 one-byte fragments produced 65,539 retained list entries. This is a controlled stream experiment, not attribution of a historical memory incident.

The reader now copies incoming bytes into owned 64 KiB chunks, ignores empty fragments, and keeps at most 160 chunk entries for an accepted body. Retained staging storage is at most the payload rounded up to 64 KiB; final concatenation adds the returned payload buffer. An incoming chunk and transport/runtime allocations remain outside this staging bound. Existing 10 MiB refusal, byte order, content-length check, cancellation and lock release remain unchanged. No quota, schema, recognition, Inventory, authorization or retention change.

## Verification

- Complete production-function regression: unchanged source passes seven controls and fails three retained-storage/fragment controls. Fixed source passes those ten plus a real `Request`/`ReadableStream` mixed-fragment and lock-release case.
- Related real photo read/write/canonicalization and error checks pass with normal filesystem access: 36 passes, one existing Linux-only skip before the final real-stream control was added.
- Full Windows suite: 2,216 passes, zero failures, six existing platform skips (2,222 executions). Current-schema typecheck passes. Installed dependencies satisfy the current package manifest.
- Initial restricted-filesystem realpath/hard-link failures and a stale generated Prisma client typecheck failure are preserved in the work record. A private dependency copy and current-schema client resolved those environment limitations; no shared dependency client was regenerated.

Production build and all client-manifest checks pass. Exact-head hosted checks, independent review and actual local application/browser qualification remain pending in the PR/checkpoint. Docker startup was attempted but its Linux engine pipe remains unavailable; no running review environment was replaced. Unit/stream evidence is distinct from browser, installation and user acceptance. Existing #979 descriptor-read and correction-library durability authors remain separate; their code is untouched.

Keep #305/#310 open for their remaining acceptance criteria. No new issue, merge, production or hardware action is implied.
