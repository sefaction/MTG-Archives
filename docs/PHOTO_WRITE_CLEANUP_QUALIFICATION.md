# Original photo write cleanup qualification

Related issue: #826. Parent: #305; roadmap: #302.

The original-photo writer attempted handle close and partial unlink in one sequential finally block. A real bounded partial file with controlled ENOSPC and close EIO skipped unlink; link ENOSPC followed by unlink EACCES discarded the original failure. Three unchanged-main controls fail at 18c7a94af30b8c9e455f85855ac2254a6efa412f, with eight other controls passing. The complete actual functions are extracted without statement changes. Failure adapters retain real open/partial-write/close/link/unlink behavior wherever not deliberately faulted. Every case checks independent neighbor bytes and exact complete published bytes, then removes only its owned fixture root.

The repair collects the original operation failure and independently attempts both cleanup actions. Lone errors retain identity, including falsy thrown values. Multiple failures remain ordered with original cause and string code. No partial original is published on failed preparation; failed unlink explicitly leaves a temporary. A complete original already published before cleanup failure stays immutable and readable on retry. Existing raw/preview, same-digest concurrent publication, integrity/path/format/size/decode/stream controls remain required. The free-space reserve, file limits, correction quota/sampling, human review and Inventory policy are unchanged.

Local Linux candidate-image, cumulative runtime/data conservation and final exact-head CI qualification are pending. This PR remains draft; no production or natural disk-exhaustion, independent recognition or broad storage acceptance is claimed.

Private retained evidence: .local-data/photo-write-qualification/ (original failed log, host controls, types, source manifests, candidate/runtime data checks and CI). Failed attempts remain part of qualification. Separate reviewer owns readiness, individual user approval, merge and issue closure.
