# Local native batch acceptance — October 4, 2026

The fresh **100-input, one-owner** qualification passed at test commit
`d8c00eeba589b8a5aa9408bb2cacfb8167051969` in [draft635](https://github.com/sefaction/MTG-Archives/pull/635).
It addresses the qualification defect in [issue634](https://github.com/sefaction/MTG-Archives/issues/634)
and provides bounded evidence for [P8 / issue310](https://github.com/sefaction/MTG-Archives/issues/310).
No scanner feeding, helper operation, service restart, Inventory addition,
production deployment or merge occurred. Individual merge approval is required.

## Inputs and loaded revisions

The ordinary local native queues processed 67 preserved development scans repeated
to make 100 inputs. Every source original was hash-checked before and after the
run. Manifest SHA256:
`6cf83fcc9f79fd78b24bd4091c80fb98c4d89b4e63d6dc9c041388b46d88fe82`.
These repeated images are throughput/review fixtures, not an independent exact
printing accuracy benchmark or physical scanner count evidence.

The cumulative application was qualified draft633, application source7286062
(17bf26f changes its browser fixture only). Loaded web image:
`sha256:301d89a4a4b6f407b94e8a1190b534943825a25ce2b27f700449d541bee91c5d`.
All545 runtime inputs matched source digest:
`000e7bdcd4e40f4ea3fdd7e7f6a93cad734998524757cf39ff0df6af527e7b53`.
Draft635 changes tests only, so no runtime rebuild was needed.

Native images remained unchanged:

| Worker | Image SHA256 |
| --- | --- |
| OCR | `35993b1ceeeeda5732139e204834592a6e42d0e42903a68a4424bacdc331a32b` |
| Visual | `d050ef89bb8d8d6cdba978f411a93161cca4f0a641edd14c26c676b025a16749` |
| Printing | `c82c066048be5a9466623ac5e5a62c94b25ae72c5659e74cf94c17176903c9ca` |

Printing descriptor:
`d23663249ad6a966fb13c1bf8a29ca9579884399a873b5c72cf80460de26a3f2`.
Queue priority/fairness, CPU/memory limits, ordinary evidence routing, conservative
acceptance policy and the20-minute printing deadline were unchanged. There was
no pending/running native backlog before this run. This differs from the older
shared-workload gate as well as its application revision and cache state; it does
not prove that sharing alone explains the earlier failure.

## Completed 100-input gate

Run started08:11:42.380UTC and finished08:23:53.111UTC. Actual Playwright exit0;
one test passed, no skips. All100 uploads were ready in44.898seconds. All100
printing checks finished in721.986seconds from start (about12minutes), within the
unchanged deadline after upload readiness. No fixture job failed.

Checks passed for all100 original photos, artifacts, capture slots and candidates;
every ordered original digest matched its native printing input digest.
Automatic acceptance remained false for every candidate, and fixture Inventory
remained zero. All100 paged review rows loaded. The first card's LP correction
saved and survived page reload with the same review/revision. Desktop1366px and
phone390px screenshots were inspected, with no page-wide horizontal overflow.
Two authenticated Inventory requests returned200 in148ms and104ms; these are
individual measurements, not a percentile or a large-Inventory response gate.

Before/after worker evidence showed identical container identity, image and
StartedAt, running state, restart count and OOM counters. New restarts, replacement
or OOM events: zero. The printing worker had three **historical** lifetime restarts
before the run; OCR and visual had zero. Snapshot evidence separates those values
from events during this qualification.25 sampled Docker readings do not prove
exhaustive peak memory or production headroom.

Owned cleanup passed: fixture users0, sessions0, Inventory0, and all temporary
original spool directories removed. The67 corpus originals and30 actual physical
qualification originals retained their hashes. Existing user Inventory retained
10,292 rows /12,495 copies and its ordered full-row digest. User Batch545 retained
32 photos, one commit and revision100. Actual scanner Batch546 remained paused
at30/83 with zero commits and all physical segments DRAINED; its helper stayed idle.

Private report/log: `.local-data/native100-continuity-report.json` and
`.local-data/native100-continuity-browser.log`. Originals, private paths and full
reports are excluded from Git.

## Preserved failures and checker repair

The first unmodified October4 run remains **FAILED**, despite completing100
printing checks in706.647seconds and all ordered digest/paged-review/LP checks.
Its final harness assertion required lifetime RestartCount0, but the printing
container already had three earlier restarts. StartedAt was October3 16:01:14UTC;
bounded Docker lifecycle events during the October4 run were zero. Its report/log
remain preserved as `.local-data/native100-historical-counter-*`.

The checker now compares before/after identity, image, start time, running state,
restart and OOM counters. Unchanged historical counters are allowed; a new manual
or automatic restart, replacement, OOM, stopped worker or missing evidence still
fails. Four focused regressions, full application checks and all three d8c00ee
GitHub checks passed. This is a qualification repair, not a native performance fix.

The [October2 shared-workload gate](ACQUISITION_BATCH_GATE_2026-10-02.md) remains
FAILED at50/100 within20minutes. Its subsequent100-row review was not reached;
this new bounded pass does not retrospectively change its result.

## Remaining acceptance

The first300-input/four-uneven-owner attempt **FAILED during upload**, before the
native printing deadline or full review checks. It ran08:27:37–08:32:46UTC using
160/80/40/20-card batches. All300 photo records were admitted, but only291 became
ready (157/77/38/19); nine showed a generic request error with Retry upload. The
unchanged five-minute upload gate failed20expected/19ready. The database recorded
1,879 serialization conflicts during this interval; these include internally
retried operations and do not individually prove the cause of each failed HTTP
request. The web log emitted no detailed upload error. Further diagnosis is needed.

Actual Playwright exit1; owned cleanup users0/sessions0/Inventory0 passed.
The ordinary native300 completion, four-owner paged reviews and their correction
reloads were **not reached**. This does not change the passing100-input result.
Private failed report/log are `.local-data/native300-continuity-report.json` and
`.local-data/native300-continuity-browser.log`; bounded database diagnostics and
failure screenshots are retained privately. No timeout or retry gate was relaxed.

The300-input/four-uneven-owner native stress gate and150,000-copy review gate
remain incomplete. The dashboard's150,000-card metadata/query fixture is already
qualified, but it is not native recognition throughput. Independent exact-printing
accuracy, broad recovery/release gates and the supervised83-card physical refill
sequence remain unfinished. Clean counted runs use assumed saved-front counts;
they do not convert these software fixtures into observed physical exit counts.
