# Durable candidate ordering (#901 / #304)

The actual scanner reconnect/final-completion replay assertion failed in hosted
39610000878/job119256088235: two unchanged candidate/observation identities swapped
array positions. `lib/acquisition-store.ts` was identical to main3ae13d0d (blob
f8ee9e137bc202914c6216895825a89d190a858c). A later pass cannot erase this failure.

Hydration now sorts a copy by acquisition order, spatial order, then physical ID.
It does not rewrite database rows, identities, evidence, reviews, counts or
allocation. Other array-order semantics are not changed by this repair.

The focused verifier extracts and executes the actual projection functions and
their real schemas/domain dependencies. All24 database candidate permutations,
including tied acquisition/spatial order, must produce one complete session.
Frozen input and full observation/review fields remain intact; counters agree.
The original source fails23 permutations and passes the separate preservation
control; the unchanged verifier passes both controls after the repair. CI pins
the original commit/blob and requires that exact negative result, separately
from the corrected controls and unchanged full PostgreSQL acquisition suite.

This is a stable representation/replay repair, not physical recognition accuracy,
native throughput, installed-helper binary provenance, every historical failure,
or named-installation acceptance. No test comparison or deadline is relaxed.
