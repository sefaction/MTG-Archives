# PaperStream Cancel and guarded blank retention

[Issue 614](https://github.com/sefaction/MTG-Archives/issues/614) records an actual
settings-only failure on PaperStream IP fi-7160 3.40.2.1815, protocol 2.4. With the
hopper and transport freshly confirmed empty, all twelve standard capture settings
initially read back exactly. Cancelling the unchanged settings window restored
`ICAP_AUTODISCARDBLANKPAGES` from `Disable` to the original `Auto`. The other eleven
settings, frame and typed observed invariant remained correct. A second inspection
cancelled directly from Simple view and reproduced the same reset; switching to
Advanced was not required. Both diagnostics refused before acquisition, restored
all twelve original settings and closed cleanly with controlled exit 1 and empty
stderr. This does not establish suppression of any physical card.

The guarded diagnostic now checks the other eleven settings, frame and invariant
before handling the documented reset. If blank removal is already disabled, it
does nothing. If the readable value exactly matches the original captured before
configuration, it reapplies Disabled once in state 4 and requires exact readback.
An unreadable or unexpected value, failed SET, clamped result or any other setting
drift still refuses. It then verifies the complete profile again before issuing
the readiness challenge, and retains the full check immediately before acquisition.
The original blank setting has exactly one restoration entry; reapplication does
not capture a replacement original. No vendor SET or acquisition retry is added.

## Qualification on October 3, 2026

Diagnostic compilation and motor-free policy tests passed, including configured,
restored-original, unreadable and unexpected-value cases. A fresh actual-source
empty settings check visibly confirmed `004: Cards` / Pre-Pick Off, cancelled
unchanged, observed the original Auto reset, reapplied Disabled once, and passed
all twelve readbacks plus frame/invariant. It then received only cancel-before-feed:

- zero acquisition Enable calls, retained images or feed authorization;
- twelve successful original-setting restorations, including Auto;
- source and DSM closure Success, state 2, owned window disposal/thread join;
- actual supervised process exit 0, empty stderr and no remaining scanner owner.

The tested diagnostic SHA256 is
`21016C019480CF47E940A3279CDBF3ED540A341F350A7E177C2470201F7041A3`.
Private evidence directories retain both refusal baselines and the repaired
`empty-post-ui-blank-cancel-20261003-205717` journal and actual exit record.

A separate fresh one-of-three session has the same-session visible Off and exact
disabled blank readback, and waits for new supervised loading/readiness. No feed
was authorized by the empty check. Further one/two, staged larger counts and
integrated capacity/refill/section-series acceptance remain unfinished. Ordinary
helper and direct native counted feeding remain suspended; the installed helpers
remain unchanged and stopped. The diagnostic-only repair does not change the local
website or require restarting acquisition workers. Current cumulative local Docker
review remains PR613 with the qualified PR611 installer. No merge or production
deployment follows from these results.
