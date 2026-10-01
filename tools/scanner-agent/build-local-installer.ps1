param(
  [string]$DotnetPath = 'dotnet',
  [switch]$ReleaseMaterials,
  [string]$OutputDir,
  [string]$PythonPath = 'python',
  [string]$IsccPath = (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'ScannerAgent.csproj'
$script = Join-Path $PSScriptRoot 'ScannerAgent.iss'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = if ($OutputDir) { [IO.Path]::GetFullPath($OutputDir) } else { Join-Path $repository '.local-data\imports\scanner-installer' }
$build = Join-Path $repository ('.local-data\scanner-installer-build-' + [guid]::NewGuid().ToString('N'))
$published = Join-Path $build 'publish'
if (-not (Test-Path -LiteralPath $IsccPath -PathType Leaf)) { throw 'Inno Setup 6 compiler is required for the local installer build' }
New-Item -ItemType Directory -Path $published,$output -Force | Out-Null
Push-Location $PSScriptRoot
try {
  & $DotnetPath restore $project --locked-mode -r win-x64
  if ($LASTEXITCODE -ne 0) { throw 'Locked scanner restore failed' }
  & $DotnetPath publish $project --no-restore -c Release -r win-x64 --self-contained true `
    -p:OutputType=WinExe -p:PublishSingleFile=false -p:PublishTrimmed=false -o $published
  if ($LASTEXITCODE -ne 0) { throw 'Self-contained scanner publish failed' }
  foreach ($name in @('Mtg.ScannerAgent.exe','NAPS2.Worker.exe','NAPS2.Sdk.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $published $name) -PathType Leaf)) { throw "Missing $name" }
  }
  $helper = Join-Path $published 'Mtg.ScannerAgent.exe'
  $connectionCheck = Start-Process -FilePath $helper -ArgumentList 'connection-selftest' -Wait -PassThru -WindowStyle Hidden
  if ($connectionCheck.ExitCode -ne 0) { throw 'Scanner connection self-check failed' }
  $transportCheck = Start-Process -FilePath $helper -ArgumentList 'native-selftest' -Wait -PassThru -WindowStyle Hidden
  if ($transportCheck.ExitCode -ne 0) { throw 'Scanner transport self-check failed' }
  $discoveryCheck = Start-Process -FilePath $helper -ArgumentList 'discovery-selftest' -Wait -PassThru -WindowStyle Hidden
  if ($discoveryCheck.ExitCode -ne 0) { throw 'Scanner discovery self-check failed' }
  & (Join-Path $PSScriptRoot 'prepare-local-notices.ps1') -PublishDir $published -PythonPath $PythonPath
  if ($ReleaseMaterials) {
    & $PythonPath (Join-Path $PSScriptRoot 'prepare-release-materials.py') --publish $published
    if ($LASTEXITCODE -ne 0) { throw 'Release source/notice material verification failed' }
  }
  & $IsccPath "/DPublishDir=$published" "/O$output" $script
  if ($LASTEXITCODE -ne 0) { throw 'Scanner installer compile failed' }
  $installer = Join-Path $output 'MTGArchivesScannerSetup.exe'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Scanner installer is missing' }
  Write-Output "Local scanner installer: $installer"
  Write-Output "SHA256: $((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant())"
  $helperVersion = ([xml](Get-Content -LiteralPath $project)).Project.PropertyGroup.Version
  $manifest = [ordered]@{ version = [string]$helperVersion; sha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant(); sourceCommit = (& git -C $repository rev-parse HEAD); builtAt = [DateTime]::UtcNow.ToString('o'); distributionMaterialsComplete = [bool]$ReleaseMaterials }
  [IO.File]::WriteAllText((Join-Path $output 'MTGArchivesScannerSetup.json'), ($manifest | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  if ($ReleaseMaterials) { Write-Output 'Release notice/source materials included; hardware qualification remains separate.' }
  else { Write-Output 'This local test artifact is not approved for public distribution.' }
} finally {
  Pop-Location
  if ($build.StartsWith((Join-Path $repository '.local-data\scanner-installer-build-'),[StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $build -Recurse -Force -ErrorAction SilentlyContinue
  }
}
