# Choose one scanner connection

Helper 0.4.3 addresses [issue620](https://github.com/sefaction/MTG-Archives/issues/620).
Opening every saved helper conflicted with the counted source's sole-owner check.
The operator chose one remembered website/account connection for everyday use.

Opening the helper presents the saved connections and remembers the selected
identity. Sign-in resumes only that identity. A sole connection can resume before
a preference exists; multiple connections without a choice stay idle. A missing,
disabled, revoked, malformed or unreadable preference never selects another
account automatically. Reconnect links offer only connections for their website.

An authenticated pairing or pulse may supply its own account username as an
optional display label. Older sites and saved configurations remain compatible;
unlabelled connections show their existing name, website and connection number.
No new authentication privilege, listener or schema is introduced.

A global exclusive service lease and older per-connection locks prevent opening
another helper alongside an existing one. Native counted ownership checks remain
unchanged. Saved connections, credentials, originals, receipts and run journals
are retained. Choosing a connection does not create a scan command; existing
authenticated website requests and durable recovery continue to apply.

**Close chosen connection** writes a graceful close request to a supporting
helper. The service waits for its current accepted run, including native closure
and saved-image delivery, then drains discovery and releases its lease. It does
not cancel an active count or start another connection. Reopening the chooser
after closure allows a different selection. Older helpers lack this capability;
the chooser reports that they must finish before updating instead of claiming
they were stopped. Normal opening clears a previous completed close marker;
direct diagnostic `serve` retains that marker and remains closed.

## Validation and remaining acceptance

The Windows connection selftest exercises real scoped saved fixture identities
and Windows credential bindings: two connections on one website start neither
without a choice, and exactly one with a choice. It checks preference persistence,
malformed/stale selection, cancellation, global lease exclusion, legacy locks,
account labels and capability-gated close without releasing an active ownership
lock or removing credentials. Fixtures never connect to a scanner or website.

Local acquisition integrity checks passed against disposable PostgreSQL, including
pair/replay/pulse bound-account assertions. Core verification passed all 801 tests,
typecheck, production build and client manifests. Native fixture/recovery and
discovery checks passed separately; installer checks provide packaging validation.

The earlier fake-preview window could not be bound through Windows Computer Use;
the verified preview was stopped without changing saved connections. This did not
recur after updating the existing owned installation to0.4.3. Its actual chooser
was bound and visually inspected: readable site/account selection, Open/Cancel
and enabled Close only for the open connection. The same authenticated local
Brian connection was remembered, labelled from its heartbeat and preselected.

Actual idle Close drained discovery and the held service process exited0 without
stderr. Ordinary reopening remembered Brian, showed Close disabled while offline,
then Open created exactly one service and one owned discovery worker. The empty
installed native preparation passed all profile readbacks, twelve restorations,
source/DSM closure and owned-loop join with actual helper/native exit0, zero Enable
calls and zero images. No scan was authorized by opening or closing the chooser.

The installer completed without restart. Previous installed code and non-secret
connection metadata were backed up locally; credentials, original scans and the
operator's saved32-image batch/reviews/commit remained intact. The operator's own
Inventory additions are a new conservation baseline, separate from qualification.
Connection switching and Close during an active supervised run remain acceptance
gates, along with the larger logical83 hardware batch. No merge or production
deployment is implied. See [programmatic qualification](FI7160_PROGRAMMATIC_COUNT_CONTROL.md).

A Close attempted during a later refill arrived after the scan had already
finished, so it provides another idle-close result rather than active-run
acceptance. The operator chose to continue scanning without repeating that test.
