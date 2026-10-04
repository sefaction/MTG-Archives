# Local100-input native gate — October2,2026

A separate [October4 local qualification](ACQUISITION_BATCH_GATE_2026-10-04.md) passed100inputs on a later application revision with no starting native backlog. This historical shared-workload failure remains failed.

The corrected full run FAILED its unchanged20-minute printing-completion gate:
expected100, received50. Total test duration21.3minutes. Two earlier setup failures
(hidden batch defaults and an immediate optional Advanced lookup before rendering)
are separate retained failures; neither reached native throughput. Corrected setup
waits for Advanced and bounds ordinary UI actions to15seconds.

The full run used67 preserved development originals with repetition, one owned
fixture player and the ordinary local library/native pipeline. It operated no
physical scanner and made no Inventory commit. The cumulative application was
#569/#571 (web45de76d, verified509source digest63e1925e150ff1447e06295b191a343e20214b661654bf9c939cf6bac2733a49),
with exact LF/index native images and unchanged printing reuse. Test source was
#572 head39bd01b. Existing owners' normal native work shared the workers; queue
priority, fairness, CPU/memory limits, leases and gate deadlines were unchanged.
These are repeated development inputs, not independent printing accuracy.

All100 photos were ready in74.308seconds. Input checks passed100 original photos,
artifacts, physical slots and candidates, with exact ordered source digests and
zero fixture Inventory. Authenticated Inventory fetch succeeded. At the final
sample: OCR100COMPLETE; visual52COMPLETE/1RUNNING/47PENDING; catalog52COMPLETE;
printing50COMPLETE/1RUNNING. No FAILED stage was observed. This is a throughput
failure, not proof that the outstanding jobs would never complete.

The visual dependency and sharing are measurable: by05:17UTC,54 visual results
had completed since test startup,26fixture and28existing-owner. Catalog admission
in this configuration requires current completed visual evidence. This supports
investigating visual work and bounded evidence routing; it does not justify
changing fairness or promoting an unqualified recognition policy.

The final container-lifetime counters (including earlier/background work) recorded
zero OOM kills and zero restarts. OCR peak1,947,467,776bytes; visual1,788,702,720bytes;
printing1,073,741,824bytes, at its1GiB cap with4,043max events. Sample snapshots are
not exhaustive peaks of the browser/host or a memory-headroom pass.

Owned cleanup passed: zero fixture users, sessions or Inventory; original-input
spool copies removed. Existing services stayed running. Private full report/log
and failure artifacts remain ignored under.local-data/night-large-batch-*.
The pre-existing57-result failed gate remains failed; this new50-result failure
is not replaced by later isolated passes. Full100-card paged-review/draft checks
were after the failed gate and were NOTREACHED.300-input/four-owner throughput,
150,000-copy review scale and independent accuracy remain separate acceptance.
