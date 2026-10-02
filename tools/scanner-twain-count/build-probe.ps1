param([string]$NtwainPackageRoot = (Join-Path $env:USERPROFILE '.nuget\packages\naps2.ntwain\1.0.1'))
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = Join-Path $repository '.local-data\twain-count-probe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
$library = Join-Path $NtwainPackageRoot 'lib\net462\NTwain.dll'
if (!(Test-Path -LiteralPath $compiler) -or !(Test-Path -LiteralPath $library)) { throw 'Existing .NET Framework compiler and pinned NAPS2.NTwain 1.0.1 cache are required' }
New-Item -ItemType Directory -Force -Path $output | Out-Null
Copy-Item -LiteralPath $library -Destination (Join-Path $output 'NTwain.dll')
& $compiler /nologo /target:exe /platform:x86 ('/out:' + (Join-Path $output 'CountProbe.exe')) ('/reference:' + $library) (Join-Path $PSScriptRoot 'CountProbe.cs')
if ($LASTEXITCODE -ne 0) { throw 'Count probe compilation failed' }
& $compiler /nologo /target:exe /platform:x86 ('/out:' + (Join-Path $output 'CountFeed.exe')) ('/reference:' + $library) /reference:System.Drawing.dll (Join-Path $PSScriptRoot 'CountFeed.cs') (Join-Path $PSScriptRoot 'CountFeedPolicy.cs')
if ($LASTEXITCODE -ne 0) { throw 'Count feed compilation failed' }
Write-Output (Join-Path $output 'CountProbe.exe')
