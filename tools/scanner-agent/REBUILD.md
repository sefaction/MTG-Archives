# Rebuilding and replacing scanner libraries

The installed `third-party/sources/` directory accompanies the binary and holds:

- Exact unmodified NAPS2 source at commit `8ae3e82203115754e804fe9c14f00f6bd86ee192`, including the LGPL SDK, image libraries, worker and build projects.
- The MTG scanner helper sources and locked NuGet dependencies used for this installer.
- This document. Component license and copyright texts remain in the adjacent versioned directories.

Extract the NAPS2 source archive into your own working directory. On Windows,
install the .NET 10 SDK to rebuild the upstream worker and libraries. The worker
project is `NAPS2.Sdk.Worker.Build`, distinct from `NAPS2.App.Worker`:

```powershell
dotnet publish NAPS2.Sdk.Worker.Build/NAPS2.Sdk.Worker.Build.csproj -c Release -r win-x86
```

This project references the SDK and GDI projects and declares its build-time
LargeAddressAware dependency. It builds an x86 self-contained worker. Preserve
upstream project files, notices and any library modifications you make. Restore
uses the package versions in those project files. This procedure rebuilds from
source; it does not promise a byte-identical Microsoft/runtime/compiler build.

Close the helper and wait for its worker to finish before replacing program
files. Back up the installation directory. Replace `NAPS2.Worker.exe` with your
rebuilt worker, and replace the separate `NAPS2.*.dll` files with compatible
rebuilt library output if you modify those libraries. Keep assembly identities
and the SDK/worker communication interface compatible. These files are neither
merged into the helper nor protected by signature/hash enforcement. The next
helper update can overwrite changes, so retain your modified source/output.

To rebuild the helper itself, extract its source archive, install the .NET 8
SDK, then from `tools/scanner-agent` run:

```powershell
dotnet restore ScannerAgent.csproj --locked-mode -r win-x64
dotnet publish ScannerAgent.csproj --no-restore -c Release -r win-x64 --self-contained true -p:OutputType=WinExe -p:PublishSingleFile=false -p:PublishTrimmed=false -o publish
```

To use modified local SDK projects, replace the corresponding PackageReference
entries with ProjectReference entries to your extracted compatible projects,
and remove/regenerate the NuGet lock for your modified build. You may modify or
replace LGPL components and debug those modifications for your use; the helper
imposes no additional prohibition. Redistribute modifications under the
applicable component license and include their corresponding source/notices.

Credentials, journals and pending original images are separate private appdata.
Do not include them in source archives or overwrite them when replacing program
files. Rebuilding, installing or pairing never authorizes a scanner feed.
The manufacturer's driver and system TWAIN DSM are not in this source/binary
bundle; install the manufacturer's Windows driver separately.