# NAPS2 spike package and distribution review

Reviewed September28,2026 from restored package `.nuspec`/license files and exact source links. This is a source-only local spike, **not an approved binary distribution**. `tools/scanner-agent/packages.lock.json` is the exact resolved inventory and content hashes; the table includes every restored package. No optional OCR/Tesseract, PDFium, SANE or ImageSharp image backend was added. Some PDF/network/font dependencies are transitive SDK dependencies even though this agent does not use those features.

## Restored packages

| Package | Version | Finding |
|---|---|---|
| NAPS2.Sdk |1.3.0|Package LICENSE: LGPL-2.1-or-later|
| NAPS2.Images.Gdi |1.3.0|Package LICENSE: LGPL-2.1-or-later|
| NAPS2.Sdk.Worker.Win32 |1.3.0|Package LICENSE: LGPL-2.1-or-later; embeds prebuilt worker|
| NAPS2.Escl |1.3.0|Package LICENSE: LGPL-2.1-or-later|
| NAPS2.Images |1.3.0|Package LICENSE: LGPL-2.1-or-later|
| NAPS2.Internals |1.3.0|Package LICENSE: LGPL-2.1-or-later|
| NAPS2.NTwain |1.0.1|MIT expression; source commit216c8c614d1514638cace41e5aa7e7ce48448d78|
| NAPS2.Wia |2.0.3|MIT expression|
| NAPS2.Mdns |1.0.1|MIT expression|
| NAPS2.PdfSharp |1.0.1|Package LICENCE.md: MIT|
| Google.Protobuf |3.29.3|BSD-3-Clause expression|
| Grpc.Core.Api |2.67.0|Apache-2.0 expression|
| GrpcDotNetNamedPipes |3.1.0|Package LICENSE: Apache-2.0|
| Makaretu.Dns |2.0.1|No package license declaration; exact repository commit701463d2091e6d98d4cc4490abb0e0ead8ae2985 LICENSE is MIT|
| SimpleBase |1.3.1|The package's 1.3.1 nuspec matches the upstream [July 27, 2017 source nuspec](https://github.com/ssg/SimpleBase/blob/72ecb1de90918faade31351ece771e67f52d4d4a/SimpleBase.nuspec), which points to Apache; that same exact source tree contains [Apache-2.0 LICENSE.txt](https://github.com/ssg/SimpleBase/blob/72ecb1de90918faade31351ece771e67f52d4d4a/LICENSE.txt). The [1.3.1 NuGet listing](https://www.nuget.org/packages/SimpleBase/1.3.1) dates the release to the same day. This establishes version-era source/license provenance, without asserting binary identity to that commit.|
| SharpZipLib |1.4.2|MIT expression|
| SixLabors.Fonts |1.0.1|Apache-2.0 expression at this version; do not assume licensing of newer versions|
| StandardSocketsHttpHandler |2.2.0.10|MIT expression|
| ZXing.Net |0.16.11|Apache-2.0 expression|
| Microsoft.Bcl.AsyncInterfaces |10.0.10|MIT expression|
| Microsoft.Extensions.DependencyInjection.Abstractions |10.0.10|MIT expression|
| Microsoft.Extensions.Logging.Abstractions |10.0.10|MIT expression|
| Microsoft.Win32.SystemEvents |9.0.3|MIT expression|
| System.Collections.Immutable |10.0.10|MIT expression|
| System.Diagnostics.DiagnosticSource |10.0.10|MIT expression|
| System.Drawing.Common |9.0.3|MIT expression; Windows-only imaging backend|
| System.Formats.Nrbf |10.0.10|MIT expression|
| System.Memory |4.6.0|MIT expression|
| System.Reflection.Metadata |10.0.10|MIT expression|
| System.Resources.Extensions |10.0.10|MIT expression|
| System.Threading.Tasks.Dataflow |10.0.10|MIT expression|

NAPS2 package repository commit is [8ae3e82203115754e804fe9c14f00f6bd86ee192](https://github.com/cyanfish/naps2/tree/8ae3e82203115754e804fe9c14f00f6bd86ee192). Component licenses differ from the overall application's license: [SDK LICENSE](https://github.com/cyanfish/naps2/blob/8ae3e82203115754e804fe9c14f00f6bd86ee192/NAPS2.Sdk/LICENSE), [worker LICENSE](https://github.com/cyanfish/naps2/blob/8ae3e82203115754e804fe9c14f00f6bd86ee192/NAPS2.Sdk.Worker.Win32/LICENSE). [Makaretu exact-source license](https://github.com/richardschneider/net-dns/blob/701463d2091e6d98d4cc4490abb0e0ead8ae2985/LICENSE) fills its missing NuGet metadata.

## Native/runtime packaging findings

- The host project targets `net8.0-windows` and uses Windows Forms/GDI. A compatible Windows Desktop runtime is required for this framework-dependent build. Local isolated SDK8.0.425 installed runtime8.0.31 in ignored `.local-data`; no global runtime upgrade was needed.
- `NAPS2.Sdk.Worker.Win32` copies `NAPS2.Worker.exe` to output. Its exact source project targets net10.0/win-x86 with `SelfContained`, `PublishSingleFile`, `PublishTrimmed`. Thus the parent package dependency list is **not a full inventory of the embedded worker's runtime/native content**. Build scripts/source, notices and replacement/rebuild procedure must accompany any eventual redistributable bundle as applicable. No installer was made.
- SDK source loads a `twaindsm.dll` using its native search path. This restored application output has no standalone DSM DLL. An installed Windows32-bit DSM file version2.3.0.0 was observed, SHA256 `96a87aabdf2af814785965de82f25d30f2cd1c1c6755835782aed8000d36e56e`; that observation alone is not proof of which DLL the worker loaded. Exact loaded-path/version and a clean-host install requirement remain unqualified.
- The TWAIN Working Group [DSM project](https://github.com/twain/twain-dsm) identifies LGPL licensing; its [license file](https://github.com/twain/twain-dsm/blob/master/TWAIN_DSM/license.txt) is LGPL2.1. Pin the exact native binary/source provenance before redistribution instead of assigning the managed NTwain MIT license to the DSM.
- The manufacturer's TWAIN/WIA driver is preinstalled, not copied into this repository or proposed distribution. Driver redistribution terms have not been qualified. Windows WIA/GDI are OS facilities, not bundled manufacturer code.
- Microsoft's .NET runtime is separately licensed with third-party notices; a self-contained distribution needs its runtime notices too. [Official .NET license information](https://github.com/dotnet/core/blob/main/license-information.md).

## Installed helper inventory update, September 29, 2026

The local 0.3.2 installer now copies available restored-package license and
notice files, the host runtime texts, and an explicit incomplete-distribution
inventory into `third-party/`. Build-time Python is used only for reading the
worker bundle; end users do not need Python. `inspect-worker-bundle.py` reads
bounded JSON from the actual executable without executing it or extracting code.

The actual Worker.Win32 1.3.0 executable contains 147 bundle entries and 25
declared libraries, including **Microsoft.NETCore.App.Runtime.win-x86 10.0.10**.
Its runtime configuration independently agrees on 10.0.10. This differs from
the host's .NET 8.0.31 x64 runtime. The embedded project identity is
NAPS2.Worker 8.3.0; the SDK components are 1.3.0. The full runtime configuration,
library content hashes and executable digest are retained in
`third-party/worker-inventory.json`, without credentials or local absolute paths.

Reproduce against a restored or installed worker:

```powershell
python tools/scanner-agent/inspect-worker-bundle.py NAPS2.Worker.exe worker-inventory.json
```

The corresponding worker rebuild project is **NAPS2.Sdk.Worker.Build**, not
the application's differently configured NAPS2.App.Worker project. The
[pinned SDK worker project](https://github.com/cyanfish/naps2/blob/8ae3e82203115754e804fe9c14f00f6bd86ee192/NAPS2.Sdk.Worker.Build/NAPS2.Sdk.Worker.Build.csproj)
targets net10.0/win-x86 and references SDK, Images.Gdi and the build-time
LargeAddressAware 1.0.6 package. That build-time package does not appear in the
worker's declared runtime libraries. These findings identify the needed source
and runtime notices; they do not close the remaining distribution gate below.

## Distribution gate

Before publishing an installer/binary: inventory the actual embedded worker/native dependencies, verify DSM prerequisites in a clean environment, assemble component copyright/license/NOTICE texts, and provide applicable corresponding source and library replacement/relink/rebuild mechanisms. Keep any LGPL component modifications documented and available under its applicable license. A dependency license name or project URL alone is not a complete compliance bundle. SimpleBase1.3.1's source-era license gap was resolved September29; the remaining distribution gates still apply.

These obligations follow the component licenses, including [LGPL2.1 distribution provisions](https://github.com/twain/twain-dsm/blob/master/TWAIN_DSM/license.txt). The bounded local experiment may continue while this distribution gate remains open; it does not justify labeling a production package ready.
