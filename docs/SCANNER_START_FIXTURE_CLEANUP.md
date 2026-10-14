# Scanner setup/start fixture cleanup

Related #793/#692. Five actual teardown blocks in alignment, preflight, START replay and rejected-START protocol verifiers execute their first feedback sweep outside protected cleanup. Actual unchanged-source controls show early failure bypasses every later action; this is fixture infrastructure, not a diagnosed scanner runtime defect.

The fix validates exact ownership before mutation, independently attempts the existing early sweep, route drain where present, original legacy database/file action and final sweep, and preserves every primary/cleanup cause (including falsy thrown values). Existing closed-page route guards remain. All 152 original assertion calls, complete main bodies, legacy SQL/file statements and workflow deadlines are exact. Application retention, scanning/review/Inventory authority,64decimalGB/owner and2% controls remain.

Forty-four actual-source fault/cause/ownership controls and types pass. The first control harness omitted the rejected-START block's existing requests-array input; that failed run is retained and corrected without changing actual teardown. An initial baseline harness used top-level await in CommonJS and failed before fixture creation; its asynchronous wrapper was corrected.

Pending scoped qualification: actual disposable PostgreSQL baseline/candidate/neighbor recovery and all six original protocol browser cases on current cumulative local Docker. No physical helper/motor, extended TWAIN, native inference/throughput, independent accuracy or production acceptance is claimed. Test-only changes require no application/native rebuild. Historical failures remain unchanged.
