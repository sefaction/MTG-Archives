param(
  [string]$DotnetPath = 'dotnet',
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'MTGArchives\ScannerAgent\app')
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Windows is required' }
$project = Join-Path $PSScriptRoot 'ScannerAgent.csproj'
$lock = Join-Path $PSScriptRoot 'packages.lock.json'
if (-not (Test-Path -LiteralPath $project -PathType Leaf) -or
    -not (Test-Path -LiteralPath $lock -PathType Leaf)) { throw 'Scanner source is incomplete' }
$install = [IO.Path]::GetFullPath($InstallRoot)
if (-not [IO.Path]::IsPathRooted($install)) { throw 'Choose an absolute install root' }
$sdk = & $DotnetPath --list-sdks
if ($LASTEXITCODE -ne 0 -or -not ($sdk | Select-String '^8\.')) { throw '.NET 8 SDK is required to build the helper' }
$runtimes = & $DotnetPath --list-runtimes
if ($LASTEXITCODE -ne 0 -or -not ($runtimes | Select-String '^Microsoft\.WindowsDesktop\.App 8\.')) {
  throw '.NET 8 Windows Desktop runtime is required to run the helper'
}

# The source and exact NuGet lock identify this local build. No binary is
# published by this script or added to the repository.
$sources = @(Get-ChildItem -LiteralPath $PSScriptRoot -File |
  Where-Object { $_.Extension -in @('.cs','.ps1') -or $_.Name -in @('ScannerAgent.csproj','packages.lock.json') } |
  Sort-Object Name)
$text = ($sources | ForEach-Object { "$($_.Name) $((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }) -join "`n"
$text += "`nCountFeedPolicy.cs $((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot '..\scanner-twain-count\CountFeedPolicy.cs') -Algorithm SHA256).Hash)"
$bytes = [Text.Encoding]::UTF8.GetBytes($text)
$sha = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').Substring(0,16).ToLowerInvariant() }
finally { $sha.Dispose() }
$buildRoot = Join-Path $env:TEMP "mtg-scanner-source-$fingerprint-$([guid]::NewGuid().ToString('N'))"
$published = Join-Path $buildRoot 'publish'
New-Item -ItemType Directory -Path $published -Force | Out-Null
try {
  & $DotnetPath restore $project --locked-mode
  if ($LASTEXITCODE -ne 0) { throw 'Locked scanner restore failed' }
  & $DotnetPath publish $project --no-restore -c Release -f net8.0-windows -p:SelfContained=false -o $published
  if ($LASTEXITCODE -ne 0) { throw 'Scanner publish failed' }
  foreach ($name in @('Mtg.ScannerAgent.dll','Mtg.ScannerAgent.runtimeconfig.json','NAPS2.Worker.exe','counted-twain\Mtg.CountedTwain.exe','counted-twain\NTwain.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $published $name) -PathType Leaf)) {
      throw "Published helper is missing $name"
    }
  }
  & $DotnetPath (Join-Path $published 'Mtg.ScannerAgent.dll') connection-selftest
  if ($LASTEXITCODE -ne 0) { throw 'Scanner credential/origin self-check failed' }
  & $DotnetPath (Join-Path $published 'Mtg.ScannerAgent.dll') native-selftest *> (Join-Path $buildRoot 'native-selftest.log')
  if ($LASTEXITCODE -ne 0) { throw 'Scanner native self-check failed' }
  & $DotnetPath (Join-Path $published 'Mtg.ScannerAgent.dll') discovery-selftest *> (Join-Path $buildRoot 'discovery-selftest.log')
  if ($LASTEXITCODE -ne 0) { throw 'Scanner discovery self-check failed; no scanner used' }
  $canonicalPublish = (Get-Item -LiteralPath $published).FullName.TrimEnd('\','/')
  $files = @(Get-ChildItem -LiteralPath $published -File -Recurse | Sort-Object FullName | ForEach-Object {
    if (-not $_.FullName.StartsWith($canonicalPublish + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) { throw 'Published file escaped its output root' }
    $relative = $_.FullName.Substring($canonicalPublish.Length).TrimStart('\','/')
    [pscustomobject]@{ name = $relative; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  New-Item -ItemType Directory -Path $install -Force | Out-Null
  $edition = Join-Path $install "$fingerprint-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Path $edition | Out-Null
  foreach ($file in $files) {
    $target = Join-Path $edition $file.name
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $published $file.name) -Destination $target
  }
  $manifest = [pscustomobject]@{ version = 1; sourceFingerprint = $fingerprint;
    lockedPackagesSha256 = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash.ToLowerInvariant();
    files = $files }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $edition 'build-manifest.json') -Encoding utf8
  foreach ($file in $files) {
    if ((Get-FileHash -LiteralPath (Join-Path $edition $file.name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
      throw 'Installed helper copy differs from validated output'
    }
  }
  Write-Output "Validated source build installed at: $edition"
  Write-Output 'No scanner motor was started. Pairing, production login and autostart were not changed.'
  Write-Output "Run: & '$DotnetPath' '$(Join-Path $edition 'Mtg.ScannerAgent.dll')' connect https://YOUR-SITE/"
  Write-Output "Then: & '$DotnetPath' '$(Join-Path $edition 'Mtg.ScannerAgent.dll')' serve CONNECTION-ID"
} finally {
  # Temporary build contains only newly generated output under this unique root.
  $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
  if ([IO.Path]::GetFullPath($buildRoot).StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $buildRoot) -match '^mtg-scanner-source-[0-9a-f]{16}-[0-9a-f]{32}$') {
    Remove-Item -LiteralPath $buildRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
