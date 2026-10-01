# Website-first Windows scanner setup

## Intended user path

On the Windows computer attached to the scanner, sign in to MTG Archives and open **Imports â†’ Scan cards â†’ Connect a scanner**. Install the scanner manufacturer's Windows driver if needed. Choose **Download Windows scanner helper**, open the downloaded installer, and approve Windows' normal installation/open prompts. This is a per-user, self-contained Windows x64 application; no PowerShell or separate .NET installation is needed. Then choose **Connect this computer** on the same website page and allow the browser to open the helper. The helper confirms the site's origin, claims a ten-minute one-use code without copy/paste, starts its outbound connection, and reports scanner sources to the existing Scan cards controls. The user chooses the scanner there and starts a batch through the existing flow. Nothing in installation or pairing starts a scanner motor.

The installer adds a Start menu entry and a `mtg-archive-scanner:` URL handler for this Windows user. Its optional sign-in task resumes saved connections without creating a scan. Executable files live under LocalAppData Programs; private credentials, event journals and scan originals remain under LocalAppData MTGArchives ScannerAgent. Uninstalling the program does not silently erase pending originals or connection evidence. The site can revoke a connection.

The website serves `MTGArchivesScannerSetup.exe` only to a signed-in acquisition user from `IMPORTS_DATA_PATH/scanner-installer/`. A missing file displays an unavailable state; no broken external release URL is embedded. Local Docker already mounts `IMPORTS_DATA_PATH` from `.local-data/imports`, so copy the validated local installer into `.local-data/imports/scanner-installer/` in the primary review checkout. The production site would need the separately approved package copied under its own imports appdata path; this document does not authorize publishing or production copying. The installer is not stored in Git or a container image.

## Local build and distribution gate

`tools/scanner-agent/build-local-installer.ps1` performs a locked win-x64 restore, untrimmed self-contained publish, credential/transport selftests, and an Inno Setup 6 compile. It writes the local-only artifact to `.local-data/imports/scanner-installer/`. The source installer script is `ScannerAgent.iss`. Self-contained output keeps NAPS2 assemblies and its worker as separate files; it is not a single-file or trimmed executable. The Inno build is per-user and registers the custom protocol in HKCU. The default task starts saved connections at Windows sign-in; no scanner feed starts without a site-issued START.

This is a **local test artifact**, not approved public binary distribution. Complete the package/embedded-worker/native DSM inventory, required notices and corresponding source/rebuild/replacement material, and clean-host driver/DSM check in [NAPS2 license qualification](SCANNER_NAPS2_LICENSES.md) before publishing an installer. Inno Setup 6.7.3's current non-commercial terms also need review if MTG Archives distribution becomes commercial. Keep the checksum and exact package/source revision with any reviewed release.

## Updated helper and local acceptance, September 29

The connected page also exposes an update download and the staged 0.3.2
version. The installer supports replacing program files while retaining private
connections and originals. Revoked credentials end the helper and dispose its
discovery worker; temporary network errors keep the recoverable retry behavior.
An actual installed-helper check ran across three discovery refresh intervals
without accumulating workers, then website revocation stopped the helper and
its worker. The fixture scan flow reached ordinary recognition, bulk match
review, reload and explicit Inventory commit, with owned test cleanup. This
does not replace fresh physical scanner observation.

Local installer builds require Python in addition to Inno Setup and .NET SDK;
the installed helper remains self-contained. The build records the actual
embedded worker dependencies and copies available NuGet/runtime texts into
`third-party/`. Its report explicitly leaves public distribution unapproved
until missing notices, source/replacement and clean-host checks are complete.

New feeder runs use 600 DPI and scan until natural completion, with saved-front
image count as an explicitly labeled assumption on clean runs. Errors and
interruptions still require reconciliation; the app cannot detect silent doubles.

## Reopening saved connections (0.3.3)

When a previously paired computer is offline, **Open scanner helper** sends a
site-only Windows link. The helper confirms that origin and resumes only saved,
fully paired, enabled connections for that site. It creates no new pairing and
never issues a scanner START. Opening the installed Start menu application also
resumes enabled saved connections, as sign-in startup already does. A running
connection is reused rather than spawning a second service.

After a known server authorization rejection, the connection is marked disabled
atomically in private appdata. Credentials, journals and originals remain intact;
future sign-in/reopen does not repeatedly recreate its worker. Reconnection after
revocation needs a new website pairing. Temporary service errors are not treated
as revocation; deploy with the separate #516 error-classification fix.

Build, credential/origin/lock selftests and native ACK/recovery selftests pass
without hardware. Windows protocol prompts, site-scoped installed-process
restart, and local browser recovery checks remain pending for this slice.

## Verification boundaries

- A protocol link contains only a short-lived one-use pairing code and website origin; it does not contain the ongoing helper credential. The helper displays the origin before claiming it. The one-use link can appear transiently in local process arguments, so never include it in diagnostics, screenshots or logs.
- Pairing is scoped to the signed-in user and can be revoked. HTTP links work only for loopback local review; non-loopback sites require HTTPS.
- The helper's process lock prevents duplicate background `serve` processes for one saved connection. Sign-in resume starts only saved, valid connections.
- Scanner choice, operator-loaded count, physical reconciliation, capacity, review and Inventory commit remain in the existing site flow. Pairing does not imply a device is qualified or physically safe to feed.
- A browser cannot install native software silently. A user must open/approve the downloaded installer once and allow the browser's external-app prompt.

## New-computer installation and missing downloads (#549)

Connect this computer opens the already-installed Windows protocol handler; it
cannot install the helper. A website update does not supply the separate installer
file. On a new PC, download and open MTGArchivesScannerSetup.exe first, then
connect from that same PC. Install the manufacturer's driver separately.

The setup page distinguishes checking, a missing staged installer, a failed
availability request, and an available download. New-computer Connect is disabled
until the download is available. Users with an existing installation can explicitly
choose Connect installed helper, even if this site's download is unavailable.
Add another computer offers Download rather than Update for the new computer.

If the installer is unavailable, the site administrator must stage the qualified
EXE and its matching JSON manifest under that site's existing
IMPORTS_DATA_PATH/scanner-installer directory. Keep the pair from the same build;
verify the EXE's SHA-256 against the manifest before copying it. Retry the download
check on the page after staging. A web-container restart is not required for this
file lookup. Download the same authenticated route and verify the returned bytes.
Do not paste pairing codes into issue reports or logs.

This batch prepares a local test installer for a second-PC acceptance check.
It does not stage a package on production or clear the existing public-distribution
gates above. Installing the helper and its manufacturer driver, seeing the helper
connect, and observing an actual physical scan are separate acceptance steps.
