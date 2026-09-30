param([Parameter(Mandatory=$true)][string]$PublishDir, [string]$PythonPath='python')

$ErrorActionPreference = 'Stop'
$publish = [IO.Path]::GetFullPath($PublishDir)
$cache = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path $env:USERPROFILE '.nuget\packages' }
$noticeRoot = Join-Path $publish 'third-party'
New-Item -ItemType Directory -Path $noticeRoot -Force | Out-Null
& $PythonPath (Join-Path $PSScriptRoot 'inspect-worker-bundle.py') (Join-Path $publish 'NAPS2.Worker.exe') (Join-Path $noticeRoot 'worker-inventory.json')
if ($LASTEXITCODE -ne 0) { throw 'Embedded worker inventory failed' }
$lock = Get-Content (Join-Path $PSScriptRoot 'packages.lock.json') -Raw | ConvertFrom-Json
$rows = foreach ($package in $lock.dependencies.'net8.0-windows7.0'.PSObject.Properties) {
  $id = $package.Name
  $version = $package.Value.resolved
  $folder = Join-Path $cache ($id.ToLowerInvariant() + '\' + $version)
  [xml]$nuspec = Get-Content -LiteralPath (Join-Path $folder ($id.ToLowerInvariant() + '.nuspec'))
  $metadata = $nuspec.package.metadata
  $destination = Join-Path $noticeRoot ($id + '-' + $version)
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $files = @(Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|NOTICE|THIRD-PARTY-NOTICES)(\..*)?$' })
  foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name) }
  [ordered]@{
    id=$id; version=$version; packageContentHash=$package.Value.contentHash
    declaredLicense=$metadata.license.InnerText; licenseType=$metadata.license.type
    repository=$metadata.repository.url; sourceCommit=$metadata.repository.commit
    copiedTexts=@($files.Name); primaryLicenseTextPresent=@($files | Where-Object Name -match '^LICEN[SC]E(\..*)?$').Count -gt 0
  }
}
# Runtime licenses are distinct from the SDK package notices. The bundled x86
# worker's own runtime version is recorded separately in worker-inventory.json.
$runtimeRows = foreach ($runtime in @('microsoft.netcore.app.runtime.win-x64','microsoft.windowsdesktop.app.runtime.win-x64')) {
  $deps = Get-Content (Join-Path $publish 'Mtg.ScannerAgent.deps.json') -Raw | ConvertFrom-Json
  $entry = $deps.libraries.PSObject.Properties | Where-Object { $_.Name -like "runtimepack.$runtime/*" }
  if (-not $entry) { throw "Missing self-contained runtime inventory: $runtime" }
  $version = $entry.Name.Split('/')[-1]
  $folder = Join-Path $cache ($runtime + '\' + $version)
  $destination = Join-Path $noticeRoot ($runtime + '-' + $version)
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  $files = @(Get-ChildItem -LiteralPath $folder -File | Where-Object { $_.Name -match '^(LICENSE|LICENCE|NOTICE|THIRD-PARTY-NOTICES)(\..*)?$' })
  foreach ($file in $files) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $destination $file.Name) }
  [ordered]@{ id=$runtime; version=$version; copiedTexts=@($files.Name) }
}
$report = [ordered]@{
  publicDistributionReady=$false
  scope='Local test installer; copied available NuGet texts, not a complete redistribution clearance'
  packages=@($rows); hostRuntimes=@($runtimeRows)
  remaining=@('Missing package copyright/license texts and upstream NOTICE review',
    'Embedded x86 runtime notices', 'Applicable corresponding source and rebuild/replacement material',
    'Clean-host installed manufacturer driver / TWAIN DSM prerequisite validation')
}
[IO.File]::WriteAllText((Join-Path $noticeRoot 'inventory.json'), ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $noticeRoot 'README.txt'), @'
MTG Archives Scanner Helper -- local test distribution

Available component license/copyright/third-party notice texts are copied into
versioned subdirectories. inventory.json records exact locked packages and
remaining distribution work. worker-inventory.json is read from the actual
bundled NAPS2.Worker.exe without running it. No credentials or scans are included.

This bundle is NOT cleared for public distribution. See the repository's
docs/SCANNER_NAPS2_LICENSES.md. LGPL NAPS2 components are unmodified separate
assemblies/worker; this helper imposes no prohibition on modifying or replacing
those libraries for your use or debugging their modifications. Keep pending
originals and credentials outside the program installation directory.
'@, [Text.UTF8Encoding]::new($false))
Write-Output "Local notice inventory: $($rows.Count) packages; public distribution remains gated"
