# Count-profile blank-page retention gate

Actual worker-identity settings snapshots recorded `0x1134` as Int32 `-1` before
configuration, after configuration, after settings UI, and after restoration.
The [official TWAIN header](https://github.com/twain/twain-dsm/blob/master/TWAIN_DSM/src/twain.h)
defines this as `ICAP_AUTODISCARDBLANKPAGES`, with `-1` = `TWBP_AUTO` and `-2` =
`TWBP_DISABLE`. Neither prior counted profile explicitly disabled this capability.
[Issue 610](https://github.com/sefaction/MTG-Archives/issues/610) tracks that gap.

Transfer budgets count images. Driver suppression could break the relationship
between image count and physical cards. These snapshots do not establish that any
card was actually suppressed or that suppression caused the ten-card prefeed
failure. The generic adapter's application-side `ExcludeBlankPages=false` is
separate from the driver capability.

The guarded diagnostic and suspended native count companion now set the standard
capability to `BlankPage.Disable`, require exact readback after configuration and
immediately before Enable, and restore the previous value during normal closure.
The diagnostic also rechecks after settings UI. Unsupported, unreadable, changed
or mismatched values refuse before acquisition. This adds a twelfth reversible
standard setting; no vendor capability is SET.

Guarded readiness tokens now include `blank-discard=disabled`; missing/automatic
blank-discard tokens are rejected even with the current session/target. The
companion's prepared response must contain boolean `blankDiscard=false`. The
backend refuses automatic, missing or malformed proof before prepared/Start state,
including stale companion responses. Motor-free channel fixtures cover all three
refusals and retain the existing normal, early-empty, overtransfer and restore-error
cases. The ordinary helper and direct native count route remain suspended before
any source access; this preparation does not enable them.

Diagnostic build/readiness tests and native build/refusal/retention/recovery
fixtures passed without hardware. Actual-source empty settings checks then found
that Cancel restores blank removal to its original Auto while the other settings
remain exact. The narrow diagnostic repair and its passing actual-source empty
SET/readback/restoration/clean-closure check are documented in
[post-UI blank control](FI7160_POST_UI_BLANK_CONTROL.md). Further physical tests
still require fresh specific supervised loading/readiness, visible Pre-Pick Off
and the newly verified blank-retention setting. Larger and integrated hardware
acceptance remains incomplete.

The cumulative local Docker review includes PRs 601/603/604/605/607/609/611.
All five PR611 checks passed at `ac597e7`. The complete installer from that
source has SHA256
`f36dc5badede4ee1cf0841d1dac4c888fb9319fa859bc620096b740b7c721c39`.
The healthy local web image is
`18e32da565c0969787bdad170b9afe46b97a5cf1c0933eeec344f10447cba8a3`;
all 532 source inputs matched digest
`46823d52eaa4b2369a3fbedf8ce0afc5b5cf0f690b72f1eb4f7f510570d5e405`.
Authenticated browser download/hash verification passed (1 test, 8.3 seconds),
with its temporary user removed. The Inventory full-row hash remains
`742d2fa870de453d80f151c6368e4f82` (10,280 rows / 12,482 copies), and all five
background acquisition worker generations remain unchanged. Only the local web
service was reloaded. The installed laptop helper remains unchanged and stopped;
this review build does not qualify hardware or authorize a feed, merge, or
production deployment.
