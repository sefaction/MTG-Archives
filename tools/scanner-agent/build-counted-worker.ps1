param([Parameter(Mandatory=$true)][string]$OutputPath, [string]$PackageRoot = (Join-Path $env:USERPROFILE '.nuget\packages'))
$ErrorActionPreference = 'Stop'
$reference = Join-Path $PackageRoot 'naps2.ntwain\1.0.1\lib\net462\NTwain.dll'
if (-not (Test-Path -LiteralPath $reference)) { throw 'Locked x86 TWAIN dependency missing' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($reference))).Replace('-','') }
finally { $sha.Dispose() }
if ($hash -ne '53334754C5980F26A3CE845E749394023CF3F32F43B3B70B5CD3E86857D7A916') { throw 'Locked x86 TWAIN dependency differs' }
$destination = Join-Path $OutputPath 'counted-twain'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$arguments = @('/nologo','/target:exe','/platform:x86','/optimize+',"/out:$destination\Mtg.CountedTwain.exe","/reference:$reference",'/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:System.Windows.Forms.dll',
  (Join-Path $PSScriptRoot 'CountedTwainWorker.cs'), (Join-Path $PSScriptRoot '..\scanner-twain-count\CountFeedPolicy.cs'), (Join-Path $PSScriptRoot '..\scanner-twain-count\OwnedTwainLoop.cs'))
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'Counted TWAIN companion build failed' }
Copy-Item -LiteralPath $reference -Destination (Join-Path $destination 'NTwain.dll') -Force
