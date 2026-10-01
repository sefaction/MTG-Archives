# Durable printing evidence in scan review

Unchanged versioned native observations can now be reused from completed jobs.
See [printing observation reuse](ACQUISITION_PRINTING_REUSE.md) for exact-input
identity, invalidation, current-job/publication fences and measured local acceptance.

This local review batch depends on hybrid runtime PR #476. It adds printing
evidence after the existing OCR, image retrieval and Scryfall reconciliation.
It changes no model, retrieval threshold, photo geometry or Inventory rules.

## Processing order

1. Existing intake saves unchanged private originals and reserves physical slots.
2. Preparation/OCR and complete-catalog image retrieval produce observations.
3. Existing catalog reconciliation combines candidates and repairs missing
   metadata through its shared Scryfall cache.
4. `photo-printing-evidence-v1` takes that immutable result's actual candidates,
   original photo digest, candidate revision and reference descriptor.
5. A restricted native process receives at most12 public printing IDs and10MiB
   original photo bytes. It checks at most24 reference faces, with no database
   credentials or external network access. Public references are path/hash
   checked; image features are reused within a bounded48-reference cache.
6. Existing distributed SIFT registration and footer/stamp policy report
   PRESENT, ABSENT or UNREADABLE. Absence needs a verified unstamped reference
   and positive agreement with visible local printing. Failed detection,
   unknown references, clipped regions and conflicting observations cannot
   establish absence. Consistent observations transfer only across matching
   visible physical outlines.
7. A new immutable result retains source observations and proposals. Stamp
   contradictions demote suggestions while retaining them for correction.
   Owner-authorized review shows a bounded summary and separate job status.

This placement covers text-led candidates that image retrieval misses. The new
Timberland Ancient scan is one such case: OCR reads MOM210; the correct PLST
printing is absent from image retrieval's first12 suggestions.

Pending/failed printing checks preserve earlier suggestions and private photos.
Newer catalog pairs supersede obsolete printing work before pixel processing;
completion rechecks source identity. Existing lease, retry, human-review,
retake, ownership and Inventory receipt fences remain authoritative. The local
printing profile is **review-only**; it cannot automatically confirm a card.
Only explicit existing Inventory commit adds copies.

## Local configuration

Add `docker-compose.printing.local.yml` after the existing acquisition,
recognition and visual local layers. It uses the same runtime image with a
printing-only entrypoint, persistent original uploads and public references.
The printing process does not load an embedding model/matrix. The existing
index's hash-checked public reference manifest provides identities and paths.
No private images, model weights, reference images or database state are baked
into the image. Production Compose and Unraid are unchanged.

The index path, public reference root and annotation/policy hashes bind each
result. Unknown/unavailable public references remain explicit. Hash changes
require a new descriptor and new durable jobs; old evidence stays immutable.
Automatic generation refresh remains separate unfinished work under #463.

## New scanner evidence

All124 user-supplied JPEG originals were retained byte-for-byte. The corpus has
repeated printings; physical-copy grouping is unknown. It is development data,
not an independent held-out physical-card sample. One Puresteel Angel playtest
release remains unresolved and is separated from123 exact-identity labels.

The initial contact sheets missed three small stamps. Enlarged lower-left
corners were subsequently inspected for every original; label revision2 adds
Nature's Way, Invigorating Surge and Golgari Grave-Troll. Eight scans visibly
carry the stamp. Revised labels are bound to the original manifest/file hashes
and only used for scoring. They never select recognizer references or candidates.
The original labels and retrieval outputs remain available privately.

On unchanged full112,472-reference retrieval plus saved OCR, revised exact-first
is110/123 and all123 labelled printings are in the first12 suggestions; all124
names are offered. The first bounded printing run (178 public annotations)
reports seven of eight stamps present,18 of116 unstamped regions absent, and99
unreadable regions. There are zero wrong explicit stamp decisions in this
development set. Exact-first after conservative contradiction demotion is
111/123. This is an offline replay of actual retrieved candidates, not a live
throughput or automatic-confirmation claim. Raw observations remain private.

The final annotation set has181 independently inspected, hash-bound PUBLIC
reference faces, including the three newly identified stamped counterparts.
This is limited annotation coverage, not an assertion that the entire public
catalog has verified stamp labels. Two existing public stamp templates and all
decision thresholds remain unchanged. The final annotation-inclusive replay
completed with the same counts:111/123 first,all123 offered,7/8 positive and
18/116 negative stamp observations correct,99 unreadable and zero wrong
explicit observations. Sanitized per-file results are in
`tools/acquisition-eval/scan-batch-printing-results.json`. The measured8.185second
mean printing time overlapped local builds/workers; it is not isolated
throughput evidence. Automatic confirmations remain zero.

## Verification and limits

- Model-free Python guards check uncertainty, visibility, reference absence,
  shared-outline evidence and identical cached/uncached registration.
- TypeScript guards check stable identities, contradiction conservation,
  impossible certainty and preserved suggestions on failed/superseded jobs.
- Disposable PostgreSQL checks concurrent enqueue, the actual photo envelope,
  source immutability, owner-authorized review and no Inventory side effects.
  A33-row regression demonstrates that32 stale visual completions cannot
  starve the next eligible catalog row. Obsolete catalog jobs become terminal
  SUPERSEDED before native processing.
- The focused live browser check uses a text-led stamped scan, an image-led
  failed-outline scan and an ordinary scanner image, with phone/desktop review
  and a separate failed-printing state. It passed1/1 in2.7minutes, with original
  canvas pixels and downloaded printing pixels checked, no page-wide overflow
  at1366/320 CSS pixels, owned fixture cleanup and no Inventory writes.

No release-quality automatic precision claim follows from this batch. Most
absence checks remain unreadable. Set-symbol detection, broader printing-layout
verification, independent accuracy, persistent reference/index maintenance and
large-batch resource/restart acceptance remain unfinished under #463.
