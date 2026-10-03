# fi-7160 diagnostic shutdown repair

The guarded one-card diagnostic retained one image, restored all eleven standard
settings, and logged successful source/DSM closure. The operator confirmed one
undamaged exit, both remaining cards wholly in the hopper, and clear transport.
Process shutdown then failed with `Invalid window handle` in WindowsBase's
`ManagedWndProcTracker`. That result remains an abnormal diagnostic exit, tracked
by [issue 606](https://github.com/sefaction/MTG-Archives/issues/606).

## Motor-free reproduction

The lifecycle test starts only the pinned NTwain internal message loop and passes
a synthetic native DIB through the actual image-retention API. It never creates
a TWAIN session, opens the DSM/source, discovers devices, or operates the motor.
The default-loop baseline reproduced the same shutdown stack in **3 of 20 separate
processes** on this laptop. Original physical evidence and baseline stderr remain
in private local evidence directories.

Pinned upstream [InternalMessageLoopHook](https://github.com/cyanfish/ntwain/blob/216c8c614d1514638cace41e5aa7e7ce48448d78/src/NTwain/Internals/InternalMessageLoopHook.cs)
requests WPF dispatcher shutdown without joining its background thread. This
reproduction supports a window/process-shutdown lifetime race; it does not prove
that every driver or WPF shutdown error has that cause.

## Repair and qualification

`CountFeed` now supplies NTwain's Windows Forms message-loop hook, created on an
owned STA thread with an unshown native window. DSM opening and filter startup
run on that thread. After successful source and DSM closure to state 2, it exits
the loop, disposes the window on its owning thread, and joins the thread before
returning. If closure remains uncertain, it retains the loop and reports that
state; it does not force shutdown, retry, or feed again.

The motor-free regression verifies STA/thread affinity, native DIB-to-PNG pixel
preservation, propagation of operation exceptions, window destruction and thread
termination. **30 separate process exits passed** with empty stderr on this laptop.
Windows CI runs the same regression. The baseline mode is for explicit local
reproduction only; CI requires the repaired mode to pass.

```powershell
& tools/scanner-twain-count/build-probe.ps1
& tools/scanner-twain-count/test-loop-lifecycle.ps1
```

The actual fi-7160 settings-and-cancel check with this repaired loop remains
pending a fresh operator confirmation that the two remaining cards have been
removed and hopper/transport are empty and clear. No additional feed has occurred.
Further physical counts require the existing same-session visible-Off and fresh
loaded-count/readiness gates in [guarded requalification](FI7160_GUARDED_REQUALIFICATION.md).
Integrated capacity/refill/section progression remains unfinished.

The native count companion also compiles the same owned-loop implementation and
uses it in its currently unreachable physical route. Direct `helper-channel-v1`
still refuses before reading input or creating any loop/session. Its locked build
and motor-free suspension, transfer/refill/retention, denial, and recovery fixtures
passed after this build change;
this does not qualify or enable that physical route.

Release source review also found [issue 608](https://github.com/sefaction/MTG-Archives/issues/608):
the archive omitted the shared native build inputs. Extracting the old archive
reproduced missing-source compiler errors. Packaging now explicitly includes both
shared sources, and source-install fingerprints include them. The fixed archive
was extracted into a clean private directory and rebuilt successfully, including
connection, native and discovery selftests without hardware. Installer CI repeats
that rebuild using the actual installed source archive.

## Cumulative local review

The installer from source `dc5cd1d` includes the shared-loop repair and corrected
source archive. All five exact-head CI checks passed, including the installed
source-archive rebuild. Local Docker now contains PR603's section-series app plus
PR601/604/605/607 safety/diagnostic source and the updated helper download. Only the
web service was reloaded; the installed laptop helper and all five acquisition
worker processes/images/start times/restart/OOM states stayed unchanged.

The installer-required Docker build passed, and all 532 image inputs matched the
review checkout. An authenticated browser download test passed and matched the
installer's SHA256. The temporary test user was removed. Inventory's full-row
hash remained unchanged at 10,280 rows / 12,482 copies.

The helper's counted route and native `helper-channel-v1` remain suspended.
Actual-source qualification with the repaired loop is still pending. No production
deployment or merge is authorized by these results.
