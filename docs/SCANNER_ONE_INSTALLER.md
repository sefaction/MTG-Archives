# One fi-7160 setup program

Helper 0.4.6 adds one setup entry point for the manufacturer driver,
self-contained helper and both Cards profiles. Work is tracked in #1016.
The installer finish page opens the wizard; **fi-7160 Scanner Setup** in the
Windows Start menu reopens it. Silent package checks do not open the wizard or
download/install a manufacturer driver.

## User flow

1. Download and open `MTGArchivesScannerSetup.exe` from Scan cards. The per-user
   helper includes its runtime, NAPS2 components and x86 counted companion.
2. Install the 32-bit PaperStream driver in the wizard if absent. Follow normal
   Windows administrator and manufacturer license prompts. An incompatible
   existing driver is preserved with guidance, not downgraded silently. A
   detected restart request stays pending until Windows restarts.
3. Choose **Add Cards profiles**. In the manufacturer's importer choose **Add
   profiles**, then **Import**. Leave **Replace all profiles** unselected. Setup
   supplies the file, backs up existing profile files locally and verifies their
   preservation after the native importer closes. Both matching presets must be
   present; a success exit, matching names or operator checkbox is insufficient.
   Repeat setup skips this step when the matching presets already exist.
4. When the fi-7160 is available, leave the hopper/transport empty, confirm that
   condition and choose **Apply and check settings**. In PaperStream choose
   **MTG Cards 600 DPI**, confirm **Pre-Pick Off** and save with OK. This window
   belongs to the actual counted companion's identity. Setup verifies the
   effective frame/invariant, closes it normally, and runs empty preparation at
   both resolutions, checking all twelve reversible capture settings and native
   closure. It never sends START or enables acquisition. There is no fallback
   when settings-only UI or the supported driver is unavailable.
5. Enter your site's origin and choose **Open Scan cards**, then **Connect this
   computer** on the website. Saved sites can be suggested; no production origin
   is hardcoded. Pairing and scan Start remain separate website actions.

Driver/profile installation can finish without a scanner. The effective-settings
step stays visibly pending until a scanner is connected. Closing/reopening or
rechecking setup does not reuse stale readiness. Before every actual Start the
existing capture path still negotiates its settings and server authority.

The wizard does not stop other scanner workers or an active connection. Finish
their work and close them before setup mutates shared configuration. Cancelling
can interrupt a download; manufacturer/settings windows must finish or cancel
normally. Setup never kills them. The installer does not force-close running
applications to upgrade locked files. Pairing, originals and journals are not
reset. Local profile backups stay in the helper's private
`setup7160/profile-backups` directory for recovery; they are never uploaded.

## Driver source and integrity

Setup pins the 32-bit TWAIN package used by the x86 companion on Windows x64:

- Version `3.40.2.1815`, filename `PSIPTWAIN-3_40_2.exe`.
- Official URL `https://origin.pfultd.com/downloads/IMAGE/fi/psip-twain32/3402/PSIPTWAIN-3_40_2.exe`.
- Exact size 257,447,688 bytes; SHA-256
  `90fd4101dce351e5f5fccdd4409c385817adf9c995be39126a8f8066f05ae833`.
- Sources: [Ricoh's fi-7160 page](https://www.pfu.ricoh.com/global/scanners/fisp/dl/fi-7160.html)
  and [version instructions](https://www.pfu.ricoh.com/global/scanners/fisp/dl/win/psip-twain32-3402.html).

The manufacturer's binary is obtained directly from Ricoh, not republished in
our release. Redirects, wrong origins/sizes/hashes and incomplete transfers are
refused. Unexpected cache files are retained/refused. Installed version readback,
rather than file copy or installer exit alone, gates later steps. If the vendor
self-extractor exits while installation continues, finish those windows and
choose Recheck. No undocumented silent installation flags are assumed.

## Curated presets and importer boundary

The [profile provenance](../tools/scanner-agent/Profiles/README.md) records the
inspected payload and native additive import evidence. Both presets derive from
the accepted fi-7160 baseline; the fast preset changes only resolution. The
personal output-directory value is cleared and the offline editor's different
model is not carried into this bundle. The complete payload is hash-pinned.

The installed file association is `pfimport.exe -c <file>`. Its native GUI
defaults to Replace all and offers Add. The wizard supplies the file; choosing
Add remains an explicit manufacturer-dialog step. It does not invent an
undocumented additive flag or automate the destructive default. Post-import
checks stop on changed pre-existing files/names and give the retained backup's
location. They do not silently overwrite the live store to repair a wrong import.
The PAV parser verifies only the pinned asset; the native importer owns all live
profile writes.

Observed vendor capability 0x80FD remains a correlation, not an official Pre-Pick
API. Setup never writes it. The visible Pre-Pick Off selection and invariant check
remain distinct evidence. Existing capture, quantity, ownership, restoration,
retained-original and no-refeed protections remain.

## Software checks and acceptance limits

`setup7160-selftest` tests pinned downloads/cache and portable presets, remapped
IDs, wrong-setting refusal, repeat preparation, site origins, driver/restart gates,
missing closure proof and the real companion's refusal of START/empty-unconfirmed
settings commands before DSM construction. It uses no network or scanner.
`setup7160-status` reads software/profile status without opening a scanner and
always reports effective settings unverified. `setup7160-verify-driver <absolute
path>` verifies the real package without executing it.

`setup7160-preview [fresh|installed|disconnected|incompatible|restart]` runs the
actual form with a fake adapter. It never instantiates the real installer,
profile importer, website opener or scanner. Preview results are UI evidence,
not manufacturer installation or hardware verification.

The existing driver's native importer accepted the exact public presets with a
disconnected scanner and preserved every prior profile XML byte for byte. Local
compile and hardware-free regressions pass. Source/published/installed package
checks include setup tests; corresponding source includes the embedded PAV.
New Windows installation, real driver install/restart behavior and settings-only
verification with a connected fi-7160 still need direct observation. #1016 stays
open for broader acceptance; its original fresh-PC incident remains undiagnosed.
Brian does not require a physical 300 DPI trial or comparison.
