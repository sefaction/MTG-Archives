param(
  [Parameter(Mandatory=$true)][ValidateSet('Inspect','Acquire','Release')][string]$Action,
  [Parameter(Mandatory=$true)][string]$RepoRoot,
  [string]$RunId,
  [string]$ThreadId,
  [string]$Operation,
  [double]$MemoryBudgetMiB,
  [double]$HostMemoryReserveMiB,
  [double]$HostDiskBudgetGiB,
  [double]$DockerDiskBudgetGiB,
  [string]$DatabaseContainerId,
  [switch]$HostOnly,
  [switch]$ChildrenTerminal
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($RepoRoot)
if (-not (Test-Path -LiteralPath (Join-Path $root 'AGENTS.md'))) { throw 'Expected repository root missing.' }
$folder=Join-Path $root '.local-data/issue-worker'
$claim=Join-Path $folder 'run.lock.json'
if ($Action -eq 'Inspect') {
  if (Test-Path -LiteralPath $claim) { Get-Content -LiteralPath $claim -Raw } else { 'No active laptop runtime claim.' }
  return
}
if ([string]::IsNullOrWhiteSpace($RunId) -or [string]::IsNullOrWhiteSpace($ThreadId)) { throw 'Actual run/thread identities required.' }
if ($Action -eq 'Release') {
  if (-not $ChildrenTerminal) { throw 'Confirm all owned operations/children are terminal before release.' }
  $handle=[IO.File]::Open($claim,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Delete)
  try {
    $bytes=[byte[]]::new($handle.Length); $handle.ReadExactly($bytes)
    $owner=[Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    if ($owner.runId -ne $RunId -or $owner.threadId -ne $ThreadId) { throw 'Runtime owner changed; claim untouched.' }
    $archive=Join-Path $folder ('completed-runtime-'+[guid]::NewGuid().ToString()+'.json')
    [IO.File]::Move($claim,$archive)
    "Released exact runtime owner; retained $archive"
  } finally { $handle.Dispose() }
  return
}
if ([string]::IsNullOrWhiteSpace($Operation) -or $MemoryBudgetMiB -le 0 -or $HostDiskBudgetGiB -le 0 -or $DockerDiskBudgetGiB -lt 0 -or (-not $HostOnly -and $DockerDiskBudgetGiB -le 0)) { throw 'Provide the operation and positive task-specific budgets including operating headroom; HostOnly may omit Docker storage.' }
foreach ($budget in @($MemoryBudgetMiB,$HostMemoryReserveMiB,$HostDiskBudgetGiB,$DockerDiskBudgetGiB)) { if (-not [double]::IsFinite($budget)) { throw 'Budgets must be finite.' } }
if ($HostMemoryReserveMiB -lt 0 -or (-not $HostOnly -and $HostMemoryReserveMiB -le 0)) { throw 'Docker work needs a positive task-specific Windows memory reserve in addition to its VM memory budget.' }
if ($HostOnly -and ($DockerDiskBudgetGiB -ne 0 -or $DatabaseContainerId)) { throw 'HostOnly must not claim Docker capacity or consume Docker resources.' }
if (-not $HostOnly -and $DatabaseContainerId -notmatch '^[a-f0-9]{64}$') { throw 'Provide the verified immutable local database container ID.' }
$hold=Get-Content -LiteralPath (Join-Path $root '.local-data/laptop-worker-setup-20261022/heavy-work-hold.json') -Raw | ConvertFrom-Json
if ($hold.status -ne 'RELEASED') { throw 'Reconcile current explicit runtime authority.' }
[IO.Directory]::CreateDirectory($folder) | Out-Null
if (Test-Path -LiteralPath $claim) { throw 'Laptop runtime is already claimed; defer overlapping work.' }
  $dockerGiB=$null
  $dockerMemoryMiB=$null
  if (-not $HostOnly) {
  $info=@(docker inspect $DatabaseContainerId | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or $info.Count -ne 1) { throw 'Cannot inspect expected local database.' }
  $db=$info[0]
  if ($db.Id -ne $DatabaseContainerId -or $db.Config.Labels.'com.docker.compose.project' -notin @('mtg-archives','mtg-anchor-qualification') -or $db.Config.Labels.'com.docker.compose.service' -ne 'postgres' -or -not $db.State.Running) { throw 'Unexpected local database identity/state.' }
  $diskRows=@(docker exec $DatabaseContainerId df -Pk /)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Docker filesystem capacity.' }
  $fields=($diskRows[-1].Trim() -split '\s+')
  if ($fields.Count -lt 6 -or $fields[3] -notmatch '^\d+$') { throw 'Unrecognized Docker filesystem capacity.' }
  $dockerGiB=[double]$fields[3]*1024/1GB
  $memRows=@(docker exec $DatabaseContainerId cat /proc/meminfo)
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Docker VM memory.' }
  $availableLine=@($memRows | Where-Object { $_ -match '^MemAvailable:\s+(\d+)\s+kB$' })
  if ($availableLine.Count -ne 1 -or $availableLine[0] -notmatch '^MemAvailable:\s+(\d+)\s+kB$') { throw 'Unrecognized Docker VM memory availability.' }
  $dockerMemoryMiB=[double]$Matches[1]/1024
  }
  $osState=Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
  $memoryMiB=$osState.FreePhysicalMemory/1024
  $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($root))
  $hostGiB=$drive.AvailableFreeSpace/1GB
  $memoryFits=if ($HostOnly) {$memoryMiB -ge ($MemoryBudgetMiB+$HostMemoryReserveMiB)} else {$memoryMiB -ge $HostMemoryReserveMiB -and $dockerMemoryMiB -ge $MemoryBudgetMiB}
  if (-not $memoryFits -or $hostGiB -lt $HostDiskBudgetGiB -or (-not $HostOnly -and $dockerGiB -lt $DockerDiskBudgetGiB)) { throw "Operation exceeds available headroom: Windows $([math]::Round($memoryMiB)) MiB, Docker VM $dockerMemoryMiB MiB, host $([math]::Round($hostGiB,1)) GiB, Docker $dockerGiB GiB. Defer this operation and reconcile resources." }
  $record=@{runId=$RunId;threadId=$ThreadId;machine=$env:COMPUTERNAME;scope='laptop-runtime';operation=$Operation;hostOnly=[bool]$HostOnly;startedAtUtc=[DateTime]::UtcNow.ToString('o');databaseId=$DatabaseContainerId;memoryBudgetMiB=$MemoryBudgetMiB;hostMemoryReserveMiB=$HostMemoryReserveMiB;availableDockerMemoryMiB=$dockerMemoryMiB;hostDiskBudgetGiB=$HostDiskBudgetGiB;dockerDiskBudgetGiB=$DockerDiskBudgetGiB;availableMemoryMiB=$memoryMiB;hostFreeGiB=$hostGiB;dockerFreeGiB=$dockerGiB}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json))
  # Capacity inspection does not mutate runtime; atomic creation resolves competing admissions.
  $handle=[IO.File]::Open($claim,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Delete)
  try { $handle.Write($bytes,0,$bytes.Length); $handle.Flush($true) }
  catch {
    [IO.File]::Move($claim,(Join-Path $folder ('failed-runtime-admission-'+[guid]::NewGuid().ToString()+'.json')))
    throw
  } finally { $handle.Dispose() }
  $record | ConvertTo-Json
