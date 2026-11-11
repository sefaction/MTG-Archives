# One fi-7160 setup program

Brian requested one installer that prepares a new Windows computer for the
fi-7160, including the manufacturer driver, helper and Cards profiles. Work is
tracked in #1016. The existing helper installer does not yet complete that path.

The intended flow is one download and one setup entry point. Setup obtains the
supported driver directly from Ricoh when needed, includes the self-contained
helper and both Cards presets, applies the presets without replacing unrelated
profiles, and guides connection to the site. Normal Windows administrator and
vendor license prompts remain part of installation. A successful file copy or
vendor process exit alone must not produce a scanner-ready result.

## Driver download component

`Fi7160SetupPackages` pins the 32-bit PaperStream IP (TWAIN) package required by
the x86 counted companion, including on 64-bit Windows:

- Version: 3.40.2.1815; download filename `PSIPTWAIN-3_40_2.exe`.
- Direct vendor URL: `https://origin.pfultd.com/downloads/IMAGE/fi/psip-twain32/3402/PSIPTWAIN-3_40_2.exe`.
- Size: 257,447,688 bytes.
- SHA-256: `90fd4101dce351e5f5fccdd4409c385817adf9c995be39126a8f8066f05ae833`.
- Source: [Ricoh's fi-7160 download page](https://www.pfu.ricoh.com/global/scanners/fisp/dl/fi-7160.html)
  and [version instructions](https://www.pfu.ricoh.com/global/scanners/fisp/dl/win/psip-twain32-3402.html).

The publisher's original package is downloaded rather than republished inside
our release. The component rejects redirects, different origins, wrong sizes,
incomplete transfers and mismatched hashes before publishing a cache entry.
Existing unexpected files are retained and refused. It never starts an installer
or scanner itself. A later launch step must check the installed driver version
and handle cancellation, failure and a required restart explicitly.

`setup7160-selftest` exercises the actual download/cache component with synthetic
HTTP streams and no network, installation or hardware. `setup7160-verify-driver
<absolute-package-path>` verifies the pinned vendor bytes without running them.
Both source and packaged helper checks include the new self-test.

## Profile payload and application work

The native vendor exporter has produced a separate bundle containing only
`004: Cards` (600 DPI) and `005: Cards 300 DPI`. The original profiles and full
pre-edit backup are preserved. The two-profile file is still private pending
payload inspection; PaperStream exports can also contain document information
and thumbnails. Do not publish the full personal profile archive as a shortcut.

The installed vendor file association opens a PAV with `pfimport.exe -c`.
Inspection of this version's importer shows **Replace all profiles** selected by
default and a separate **Add profiles** option. Do not automatically invoke that
default or assume an undocumented silent/add switch. The implementation must
establish the supported add/preserve path and confirm its outcome.

The saved Cards profile must be applied under the actual counted companion's
TWAIN identity. Current preparation checks an existing frame and observed vendor
invariant; exporting/importing a named preset does not establish that application's
current settings. Keep readiness incomplete until the appropriate effective
configuration is verified. Preserve pairing, pending originals, journals and
pre-existing driver/profile configuration through retry and upgrade.

## Remaining integration

The following are unfinished parts of this same installer batch:

1. Driver presence/version detection and the normal vendor installation handoff.
2. Inspected 600/300 DPI profile packaging and supported additive application.
3. Companion-identity configuration and no-feed readiness checks.
4. Installer wizard, retry/restart/upgrade behavior and site connection handoff.
5. Clean-host package/installation checks, source/notices and release integration.

The scanner is currently unavailable. Do not reinstate a physical 300 DPI trial:
Brian accepts equivalent operation to 600 DPI apart from speed. Software and
configuration verification remain separate from a measured physical result.
