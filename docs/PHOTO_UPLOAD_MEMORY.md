# Bound retained upload-body memory

Related to existing acquisition storage #305 and release tracker #310. Base: main `8deb01a7`.

`readBoundedPhotoBody` enforced its 10 MiB byte limit but retained every incoming typed-array view until concatenation. A 64-byte body supplied as 64 one-byte views over independent 64 KiB buffers retained 4 MiB. Empty views also retained buffers, and 65,539 one-byte fragments produced 65,539 retained list entries. This is a controlled stream experiment, not attribution of a historical memory incident.

The reader now copies incoming bytes into owned 64 KiB chunks, ignores empty fragments, and keeps at most 160 chunk entries for an accepted body. Retained staging storage is at most the payload rounded up to 64 KiB; final concatenation adds the returned payload buffer. An incoming chunk and transport/runtime allocations remain outside this staging bound. Existing 10 MiB refusal, byte order, content-length check, cancellation and lock release remain unchanged. No quota, schema, recognition, Inventory, authorization or retention change.

## Verification

- Complete production-function regression: unchanged source passes seven controls and fails three retained-storage/fragment controls. Fixed source passes those ten plus a real `Request`/`ReadableStream` mixed-fragment and lock-release case.
- Related real photo read/write/canonicalization and error checks pass with normal filesystem access: 36 passes, one existing Linux-only skip before the final real-stream control was added.
- Full Windows suite: 2,216 passes, zero failures, six existing platform skips (2,222 executions). Current-schema typecheck passes. Installed dependencies satisfy the current package manifest.
- Initial restricted-filesystem realpath/hard-link failures and a stale generated Prisma client typecheck failure are preserved in the work record. A private dependency copy and current-schema client resolved those environment limitations; no shared dependency client was regenerated.

Production build and all client-manifest checks pass. All nine hosted checks pass at source head `c7fbf3e328021a7625752aeddbe86125a3daeecd` ([run 41168073543](https://github.com/sefaction/MTG-Archives/actions/runs/41168073543)). Independent review remains pending; the PR owns the latest evidence-only head and CI state. Existing #979 descriptor-read and correction-library durability authors remain separate; their code is untouched.

## Production workflow review

Starting Docker with the established `Use-TestTools.ps1` application-data paths recovered the local engine. The earlier Windows-default-path socket remained inaccessible; failed default-path startup, shutdown, exact-file rename/removal and read-only reparse-query attempts are preserved. This does not establish the underlying Windows cause or a general socket repair. No Docker settings or retained application data changed.

Canonical Dockerfile build of source `c7fbf3e3` passes. Running image `sha256:1680ca012eae744a5ddc20bfc8d77c25fc486fa053b497f318fd3dc7095e6959` matches all **1,322** declared build inputs and source digest `a0d43d356a55c1776db5ae4dd0dc3019266a061388953c5b0eb6e34e40480ec5`. The fresh temporary PostgreSQL and production web containers use a unique owner/project, no retained data mounts and only loopback web publication. Mail, scheduled pricing and live catalogue requests are disabled. No native recognition pipeline or physical scanner is used.

Actual **1366/320** workflows pass chunked HTTP PNG upload, same-identity acknowledgement replay, an over-10-MiB streamed refusal without a new photo, ordinary browser file upload, actual canonical worker preparation, exact original bytes, browser/sharp decoding of originals and previews, private/no-store headers, anonymous/other-owner denial and zero owner Inventory/commit writes. Each case restores complete row-count/content fingerprints for all **85** public tables and preserves populated synthetic peer records. The first complete pair passes; a second complete pair also passes after adding focused screenshots of the lazily rendered photo cards. Full-page and focused screenshots are inspected; neither width has horizontal page overflow. All owned photo files are removed.

Two initial harness failures remain: the synthetic card omitted its required rarity field (the exact incomplete seed was removed), and the first HTTP fixture assumed initial generation 1 rather than using the API-returned generation 0 (all 85 fingerprints restored). Neither was a product failure or an assertion relaxation. The first phone full-page screenshot showed legitimate offscreen lazy placeholders; the later focused images verify the visible card after scrolling.

The two owned containers and network are retired, with their exact runtime claim released after all operations become terminal. Four prior stopped container identities/images/states/restarts/mounts and every existing volume are conserved; the owned containers had zero restarts/OOM. The qualified image and compact source, screenshots, fingerprint and failure records remain private. Docker images grew from 31.56 to 32.95 GB and build cache from 50.11 to 51.93 GB; no broad pruning occurred. Author workflow evidence is distinct from independent review, installation/user acceptance, native accuracy and historical memory-incident attribution.

Keep #305/#310 open for their remaining acceptance criteria. No new issue, merge, production or hardware action is implied.
