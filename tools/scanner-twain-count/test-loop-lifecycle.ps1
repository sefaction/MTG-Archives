param([ValidateRange(1, 100)][int]$Runs = 30)
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$test = Join-Path $repository '.local-data\twain-count-probe\TwainLoopLifecycleTest.exe'
$evidence = Join-Path $repository ('.local-data\loop-lifecycle-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidence | Out-Null
for ($iteration = 1; $iteration -le $Runs; $iteration++) {
    $stdout = Join-Path $evidence "$iteration.log"
    $stderr = Join-Path $evidence "$iteration.err"
    $process = Start-Process -FilePath $test -ArgumentList 'owned-loop' -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if ($process.ExitCode -ne 0 -or (Get-Item -LiteralPath $stderr).Length -ne 0 -or
        !(Select-String -LiteralPath $stdout -SimpleMatch 'Owned loop joined; window destroyed; native image pixels retained; operation failures propagated; no DSM/source/motor' -Quiet)) {
        throw "Motor-free lifecycle iteration $iteration failed; evidence: $evidence"
    }
}
Write-Output "$Runs separate process exits passed with no scanner session/source/motor; evidence: $evidence"
