# Windows scanner helper: local source build

This is a reproducible local setup for the Windows PC connected to the scanner.
It does not publish a binary, install a manufacturer driver, pair an account
or touch the production server by itself. The separate NAPS2 distribution
review in [SCANNER_NAPS2_LICENSES.md](SCANNER_NAPS2_LICENSES.md) still applies
before distributing a prebuilt installer or helper archive.

## Prerequisites

- Windows with the scanner's manufacturer driver already installed.
- .NET 8 SDK **and** .NET 8 Windows Desktop runtime on this PC. The script checks
  both. An explicit `-DotnetPath` can select an isolated SDK for a local test;
  the resulting helper still needs that runtime path whenever it runs.
- A checkout of the reviewed MTG Archives source and outbound HTTPS access to
  the chosen website. The exact NAPS2 packages are pinned in
  `tools/scanner-agent/packages.lock.json`.

## Build on the scanner PC

From the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/scanner-agent/install-from-source.ps1
```

The script restores only the locked packages, publishes a framework-dependent
Windows helper, verifies its pairing and native transport self-checks without
starting a scanner, and copies all validated output under the current user's
`LocalAppData\MTGArchives\ScannerAgent\app`. A manifest records source/package
and file digests. Credentials, spool originals and connection settings live in
sibling appdata paths, never in the copied executable directory. Repeating the
script creates a distinct versioned folder; it does not remove older builds or
scanner evidence. A private destination may be passed with `-InstallRoot` for
a local pilot. A normal installation adds **MTG Archives Scanner** to the
current user's Start menu. Its setup window can optionally start the helper
at Windows sign-in; that choice is off until selected.

## Pair and test after the site update

The existing flat Unraid Compose file already mounts `UPLOADS_DATA_PATH` into
the web service. Scanner runs store originals and control markers there; this
slice adds no scanner-specific `.env` or YAML setting. Wait for the main web
image publication to pass, then use the user's normal Unraid Compose Manager
Update for the MTG Archives stack. The Windows helper runs on the scanner PC,
outside Unraid and outside the Docker image.

On Scan cards, create a connection code. Open **MTG Archives Scanner** from the
Windows Start menu, enter the site's HTTPS address, paste the code, and click
**Connect and start**. The code goes to the helper through standard input and
is cleared from the window; it is not passed on the command line or saved in
the active-connection file. The helper stores its secret in Windows Credential
Manager and sends outbound requests only. It does not expose a browser
localhost service. The window can restart a saved connection without a new
code and open Scan cards in the browser. **Keep the scanner online when I sign
in to Windows** is optional and creates a current-user Startup shortcut.
The source installer refreshes that shortcut to the newest installed edition
only if the user previously enabled it.

For the **local Docker app** at `http://127.0.0.1:13001`, create a connection
code on its Scan cards page, enter that exact loopback address in the setup
window, paste the code, and click **Connect and start**. The window adds the
helper's explicit `--local` guard only for `localhost` or loopback IP addresses;
ordinary HTTP hosts are rejected. The local test connection has a separate
nonsecret saved identity from the production connection. The sign-in startup
choice applies only to the production connection, so a local test does not
replace the production startup target. Scan from only one website at a time
when both connections are online on the same scanner PC.

When using `-InstallRoot` for a private pilot, the installer prints a command
to open the same setup window; no Start menu or Startup shortcut is changed.
The command-line `connect` and `serve` operations remain available for
diagnostics. The setup window does not start a scan motor. Actual scanner
operation still starts from the website after loading expendable cards.

For the first production Plustek test, use one expendable card and the observed
WIA source with RGB, 300 DPI and simplex. Verify the physical exit/count and
review before any Inventory commit. The PS286's stop and duplex behavior remain
unqualified. The fi-7160 needs its own driver and physical acceptance after it
arrives. Do not use this script as evidence that an arbitrary TWAIN scanner is
safe to feed or that recognition is perfectly accurate.

If the site cannot start or complete a scan, leave the helper's private run
directory intact and inspect the website batch status before retrying. An old
run must never start the feeder twice. Stopping the helper stops polling; it
does not cancel an active PS286 feeder safely. Do not commit an unverified
physical count to Inventory.
