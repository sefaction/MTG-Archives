# Private native failure diagnosis

Recognition, visual retrieval and printing emit a bounded `native-attempt-failed`
record when a native child fails. Descriptor checks and warm inference use the
same projection. It contains only the fixed stage, reason, exit code, allowlisted
OS signal and allowlisted system code. No photo, owner, job ID, executable path,
arguments, message, stack, stdin, stdout or stderr is logged. Stderr remains drained
and discarded. Ordinary job retry, lease, publication and review rules remain in
force; this does not enable automatic confirmation.

| Reason | Observed boundary |
| --- | --- |
| `SPAWN` | The child could not start; a known system code can distinguish a missing executable or denied access. |
| `EXIT` | The child closed unexpectedly or returned a nonzero status. A signal does not establish why it was sent. |
| `TIMEOUT` | A timeout signal retired the child. |
| `ABORTED` | Another cancellation signal retired the child. |
| `OUTPUT_LIMIT` | Output exceeded the existing 65,536-byte bound. |
| `INPUT_PIPE` | The input pipe failed. |
| `INVALID_JSON` | The child returned invalid JSON. |
| `PROTOCOL` | Warm output violated terminal/progress frame rules. |
| `PROGRESS_CALLBACK` | The application progress callback threw. |
| `UNSOLICITED_OUTPUT` | A warm child produced output without an active request. |

Intentional shutdown does not emit an inference-failure log. Errors still use the
existing generic messages. The first retirement reason survives later pipe/close
events; a failed-spawn event takes precedence over its pipe-close consequence.
Observers cannot replace the failure or prevent child retirement. Rejection still
waits for the child to close before a replacement is admitted. An idle child's
unexpected output cannot revise a result already delivered.

Use these facts with container lifecycle/OOM metadata, database availability and
the existing job status/attempt history. `SIGKILL` alone is not evidence of OOM,
`EXIT` is not a model diagnosis, and a successful retry is not a root-cause fix.
Never enable private native output in ordinary worker logs to investigate a failure.

## Qualification and limits

Real Node child fixtures exercise nonzero exit, malformed JSON, output overflow,
timeout, explicit cancellation, missing executable, excess progress, callback
failure, unsolicited idle output, observer failure, retirement and successful
subsequent requests. Privacy checks include large private stderr and hostile or
fabricated exceptions. Existing credential isolation and output/progress bounds
remain tested. Linux qualification runs without network access in a read-only,
memory/CPU/PID-limited container; Windows uses the same fixtures.

The earlier local visual smoke failure remains unexplained. An additional isolated
synthetic-photo diagnostic on the unchanged runtime succeeded with 6,788 stdout
bytes, below the bound. Its stderr contained only optional xFormers warnings. That
observation does not establish the cause of the failed attempt. No photo-accuracy,
physical scanner, production or historical worker-exit resolution is claimed.
Issues [579](https://github.com/sefaction/MTG-Archives/issues/579) and
[463](https://github.com/sefaction/MTG-Archives/issues/463) remain open.

Local qualification on October 6: full core passed 831 tests, type checking,
production build and client manifests; the isolated Linux child suite passed
11 tests. Full disposable PostgreSQL acquisition/import checks passed for both
the independent main-based branch (297.582 seconds, source `f42d4355…`) and its
cumulative integration with the correction library (320.344 seconds, source
`99d4cd4d…`). Owned databases and volumes were removed.

Official OCR/visual/printing images processed the synthetic manual-boundary
input with the existing descriptors and automatic acceptance disabled. A real
visual stream rejected a deliberately invalid photo with `EXIT`, code 1, then
processed a valid input on its replacement child; intentional shutdown emitted
no additional failure. The owned container exited 0 with OOMKilled false and
the unchanged 3 GiB limit. This tests actual native failure/recovery mechanics.

The first warm real-process qualification also failed on its valid input. That
private probe initially discarded the failure projection; its cause remains
unknown. After correcting the probe to retain bounded facts, the same limits
and application source passed. Failed evidence is retained separately. This is
not a fix or retrospective explanation of that attempt, the earlier one-shot
failure, or the historical worker stops.

After the approved policy/correction-library merges on October 7, the
main-synchronized branch passed 841 core checks, type checking, production build
and all 13 declared client manifests. Its 584 application inputs exactly match
the loaded cumulative web image; each native worker matches 301 shared inputs.
The corrected fixture-only browser check passed draft recovery, lost-save retry,
keyboard focus, private originals and removal at desktop/320px sizes. All seven
original row projections, 13 service images/mounts/limits and all 1,092 retained
SHA256s (2,832,075,218 bytes) were conserved after restart and owned fixture cleanup.
Shutdown/start timestamps are recorded separately from the earlier lifecycle
baseline. Failed intermediate fixture evidence remains separate; no original
photo was missing or altered.
