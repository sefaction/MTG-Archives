# Offline scanner crash-event evidence

Related to [#558](https://github.com/sefaction/MTG-Archives/issues/558) and
scanner context [#313](https://github.com/sefaction/MTG-Archives/issues/313).
This delivers one software diagnostic from #558's October 13 next step. It does
not repair or reproduce the historical settings-window crash, qualify stable
settings access, or authorize another device/settings session.

The retained report identifies a fatal access violation and managed call stack,
but not the actual faulting native module. `DsmWinOld` in a stack and a requested
modern DSM setting do not prove which binary was loaded or caused the crash.
Microsoft's [application-crash guidance](https://learn.microsoft.com/en-us/troubleshoot/windows-server/performance/troubleshoot-application-service-crashing-behavior)
identifies Application Error event 1000 as crash evidence and cautions that a
reported system module can be the victim of corruption elsewhere. Its
[process-termination guidance](https://learn.microsoft.com/en-us/troubleshoot/developer/webapps/iis/site-behavior-performance/process-termination-crash)
also distinguishes .NET Runtime event 1026. Neither record alone proves root cause.

## Use existing private evidence

`tools/scanner-agent/crash-event-evidence.py` reads existing Event Viewer **XML**
exports with the Windows event namespace: a single `Event`, or an `Events`
collection. UTF-8 and BOM-marked UTF-16 are supported. Binary EVTX and rendered
message text are not accepted as structured crash evidence. It needs only Python
3.10 or later and its standard library. No installation, event-log access,
scanner discovery, service change, registry change, dump collection or network
request is part of the tool.

Supply the already-known crashed **worker** PID and crash time with an explicit
UTC offset. Do not substitute the helper/parent PID or event reporting-service
PID. Example values below are synthetic, not the historical incident:

```powershell
python tools/scanner-agent/crash-event-evidence.py .local-data/existing-worker-events.xml --pid 0x2a --at 2026-10-01T02:03:04.1234567Z
```

Keep the original XML private: it can contain user/computer names, paths, device
details and stack/message content. The JSON summary prints input byte counts and
SHA-256 receipts without filenames; event record IDs/times; fault PID; application
and module names/versions; exception code, fault offset and process creation time.
Only validated scalar fields are copied. Paths, computer names, message text,
report IDs and stack traces are omitted; unsupported field values become null.
Module filenames are technical evidence and should still be reviewed before sharing.

The default inclusive window is five seconds on either side of the specified
time, adjustable from zero to ten seconds. Comparisons preserve Windows' seven
fractional digits using integer 100 ns ticks. Event 1000 must name
`NAPS2.Worker.exe`, use the Application Error provider/Application channel, and
match `EventData/ProcessId`; `System/Execution/ProcessID` can identify the reporting
service instead. Event 1026 association requires the .NET Runtime provider,
Application channel, same computer, matching emitter PID and the selected window.
Missing/zero runtime emitter PIDs are counted as unusable, never inferred from
free-text messages. An event association still does not rule out PID reuse or
establish that the two records describe one process incarnation.

`one_matching_crash` means exactly one structured record passed these filters.
`no_matching_crash` leaves the module unknown. `ambiguous` retains all matching
records and makes no runtime association; even duplicate exports stay ambiguous.
No nearest-record heuristic, retry, inferred DSM selection, file-version lookup,
binary hash or root-cause diagnosis is supplied. Process creation time is retained
for a later comparison with the original worker identity, when available.

Inputs are bounded to 16 files, 4 MiB in aggregate and 256 events. DTD/entity
declarations, malformed/unsupported XML, duplicate named crash fields and missing
relevant event identity are refused with fixed error codes (exit 2); parser errors
never echo the private input. Exit 0 means a valid summary, including an explicit
no-match/ambiguous result, rather than a diagnosed or fixed crash.

## Qualification and remaining evidence

Run the hardware-free privacy/correlation controls:

```powershell
python -m unittest discover -s tools/scanner-agent -p test_crash_event_evidence.py -v
```

The required Core CI job runs these controls. Fixtures are synthetic XML using
the documented event shape; they are not the original event or an independent
scanner reproduction. They cover reporting/fault PID separation, cross-computer
and time refusals, ambiguity/duplicates, missing native evidence, unavailable
runtime PID, private malformed fields/errors, encodings, exact timestamp bounds,
hostile XML and aggregate limits. An initial Python 3.10 seven-digit timestamp
parse failure was corrected by integer-tick parsing; no historical event was
rewritten or reinterpreted as passing.

Next for #558: apply this diagnostic only to existing matching private exports
when available, compare process creation/worker identity, and record the exact
missing evidence otherwise. The original event is unavailable in this desktop
workspace, so no actual fault module, DSM identity, root cause or settings
workaround is established here. Do not schedule a new settings session, feed,
counter reread, dump policy or driver/runtime update to fill that gap. Keep #558
open for its existing acceptance and operator decisions.
