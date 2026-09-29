param(
  [string]$DotnetPath = 'dotnet',
  [switch]$Background,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$agentPath = Join-Path $PSScriptRoot 'Mtg.ScannerAgent.dll'
$root = Join-Path $env:LOCALAPPDATA 'MTGArchives\ScannerAgent'
$activePath = Join-Path $root 'active-connection.json'
$logDir = Join-Path $root 'logs'
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'MTG Archives Scanner.lnk'

if (-not (Test-Path -LiteralPath $agentPath -PathType Leaf)) { throw 'The installed scanner helper is missing' }
$dotnetCommand = Get-Command $DotnetPath -ErrorAction Stop
$resolvedDotnet = $dotnetCommand.Source

function Assert-Site([string]$value) {
  $site = $null
  if (-not [uri]::TryCreate($value, [UriKind]::Absolute, [ref]$site) -or
      $site.Scheme -ne 'https' -or $site.UserInfo -or $site.AbsolutePath -ne '/' -or
      $site.Query -or $site.Fragment) {
    throw 'Enter the HTTPS address of your MTG Archives site, without a path or code.'
  }
  return $site.AbsoluteUri
}

function Read-Active {
  if (-not (Test-Path -LiteralPath $activePath -PathType Leaf)) { return $null }
  $saved = Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
  $identity = [guid]$saved.agentId
  if ($identity -eq [guid]::Empty) { throw 'Saved scanner connection identity is invalid' }
  return [pscustomobject]@{ agentId = $identity.ToString(); site = (Assert-Site ([string]$saved.site)) }
}

function Save-Active([string]$identity, [string]$site) {
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $temporary = Join-Path $root ("active-connection.$([guid]::NewGuid().ToString('N')).tmp")
  try {
    @{ version = 1; agentId = ([guid]$identity).ToString(); site = (Assert-Site $site) } |
      ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding utf8
    Move-Item -LiteralPath $temporary -Destination $activePath -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Find-RunningService([string]$identity) {
  $escaped = [regex]::Escape($identity)
  return @(Get-CimInstance Win32_Process -Filter "Name = 'dotnet.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'Mtg\.ScannerAgent\.dll' -and
      $_.CommandLine -match "\bserve\s+$escaped\b" })
}

function Start-ScannerService([string]$identity) {
  if ((Find-RunningService $identity).Count -gt 0) { return 'Scanner helper is already running.' }
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $output = Join-Path $logDir "${identity}.stdout.log"
  $errors = Join-Path $logDir "${identity}.stderr.log"
  $process = Start-Process -FilePath $resolvedDotnet -ArgumentList @("`"$agentPath`"", 'serve', $identity) -WindowStyle Hidden `
    -RedirectStandardOutput $output -RedirectStandardError $errors -PassThru
  Start-Sleep -Milliseconds 800
  $process.Refresh()
  if ($process.HasExited) { throw 'Scanner helper could not start. Check the scanner helper logs.' }
  return 'Scanner helper started. Check Scan cards for its online status and sources.'
}

function Connect-Scanner([string]$site, [string]$code) {
  $site = Assert-Site $site
  $code = $code.Trim()
  if ($code.Length -lt 70 -or $code.Length -gt 100) { throw 'Paste the complete one-use connection code from Scan cards.' }
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $resolvedDotnet
  $start.Arguments = "`"$agentPath`" connect `"$site`""
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = [Diagnostics.Process]::Start($start)
  try {
    $process.StandardInput.WriteLine($code)
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $process.StandardError.ReadToEnd() | Out-Null
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Scanner connection failed. Check the website address and one-use code.' }
    $match = [regex]::Match($output, 'Connection identity: ([0-9a-fA-F-]{36})')
    if (-not $match.Success -or $output -notmatch 'Connected\.') { throw 'Scanner helper did not confirm the connection.' }
    $identity = ([guid]$match.Groups[1].Value).ToString()
    Save-Active $identity $site
    return $identity
  } finally { $process.Dispose() }
}

function Test-OwnedStartupShortcut {
  if (-not (Test-Path -LiteralPath $startupPath)) { return $false }
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($startupPath)
  if ($shortcut.Description -ne 'Start the MTG Archives scanner helper after sign-in') {
    throw 'The existing Startup shortcut belongs to another app.'
  }
  return $true
}

function Set-StartAtLogin([bool]$enabled) {
  if (-not $enabled) {
    if (Test-OwnedStartupShortcut) {
      Remove-Item -LiteralPath $startupPath -Force
    }
    return
  }
  $shell = New-Object -ComObject WScript.Shell
  Test-OwnedStartupShortcut | Out-Null
  $shortcut = $shell.CreateShortcut($startupPath)
  $shortcut.TargetPath = (Get-Command powershell.exe).Source
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$PSCommandPath`" -DotnetPath `"$resolvedDotnet`" -Background"
  $shortcut.WorkingDirectory = $PSScriptRoot
  $shortcut.Description = 'Start the MTG Archives scanner helper after sign-in'
  $shortcut.Save()
}

if ($SelfTest) {
  Assert-Site 'https://example.com/' | Out-Null
  foreach ($bad in @('http://example.com/', 'https://example.com/path', 'https://user@example.com/')) {
    try { Assert-Site $bad | Out-Null; throw 'Unsafe website accepted' }
    catch [System.Management.Automation.RuntimeException] {
      if ($_.Exception.Message -eq 'Unsafe website accepted') { throw }
    }
  }
  Write-Output 'PASS scanner setup origin and installed-file checks; no connection or device used'
  return
}

if ($Background) {
  $saved = Read-Active
  if ($saved) { Start-ScannerService $saved.agentId | Out-Null }
  return
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = 'MTG Archives Scanner'
$form.ClientSize = New-Object Drawing.Size(560, 330)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false

function Add-Label([string]$text, [int]$x, [int]$y, [int]$width) {
  $label = New-Object Windows.Forms.Label
  $label.Text = $text; $label.Location = New-Object Drawing.Point($x, $y)
  $label.Size = New-Object Drawing.Size($width, 23)
  $form.Controls.Add($label)
  return $label
}

Add-Label 'Website address' 20 18 200 | Out-Null
$siteBox = New-Object Windows.Forms.TextBox
$siteBox.Location = New-Object Drawing.Point(20, 43)
$siteBox.Size = New-Object Drawing.Size(515, 25)
$form.Controls.Add($siteBox)
Add-Label 'One-use connection code from Scan cards' 20 79 420 | Out-Null
$codeBox = New-Object Windows.Forms.TextBox
$codeBox.Location = New-Object Drawing.Point(20, 104)
$codeBox.Size = New-Object Drawing.Size(515, 25)
$codeBox.UseSystemPasswordChar = $true
$form.Controls.Add($codeBox)

$connectButton = New-Object Windows.Forms.Button
$connectButton.Text = 'Connect and start'
$connectButton.Location = New-Object Drawing.Point(20, 143)
$connectButton.Size = New-Object Drawing.Size(145, 33)
$form.Controls.Add($connectButton)
$startButton = New-Object Windows.Forms.Button
$startButton.Text = 'Start saved connection'
$startButton.Location = New-Object Drawing.Point(175, 143)
$startButton.Size = New-Object Drawing.Size(170, 33)
$form.Controls.Add($startButton)
$openButton = New-Object Windows.Forms.Button
$openButton.Text = 'Open Scan cards'
$openButton.Location = New-Object Drawing.Point(355, 143)
$openButton.Size = New-Object Drawing.Size(180, 33)
$form.Controls.Add($openButton)

$startupBox = New-Object Windows.Forms.CheckBox
$startupBox.Text = 'Keep the scanner online when I sign in to Windows'
$startupBox.Location = New-Object Drawing.Point(20, 190)
$startupBox.Size = New-Object Drawing.Size(500, 25)
$script:updatingStartup = $false
try { $startupBox.Checked = Test-OwnedStartupShortcut }
catch { $startupBox.Checked = $false }
$form.Controls.Add($startupBox)
$status = Add-Label 'Paste a code to connect, or start an existing connection.' 20 228 515
$status.Size = New-Object Drawing.Size(515, 70)

try {
  $saved = Read-Active
  if ($saved) { $siteBox.Text = $saved.site; $status.Text = "Saved connection: $($saved.site)" }
  else { $startButton.Enabled = $false }
} catch { $status.Text = 'Saved connection could not be read. Create a new connection code.'; $startButton.Enabled = $false }

$connectButton.Add_Click({
  $connectButton.Enabled = $false
  try {
    $identity = Connect-Scanner $siteBox.Text $codeBox.Text
    $codeBox.Clear()
    $startButton.Enabled = $true
    $status.Text = Start-ScannerService $identity
  } catch { $status.Text = $_.Exception.Message }
  finally { $codeBox.Clear(); $connectButton.Enabled = $true }
})
$startButton.Add_Click({
  try {
    $saved = Read-Active
    if (-not $saved) { throw 'No saved connection is available.' }
    $status.Text = Start-ScannerService $saved.agentId
  } catch { $status.Text = $_.Exception.Message }
})
$openButton.Add_Click({
  try { [Diagnostics.Process]::Start((Assert-Site $siteBox.Text) + 'imports/scan') | Out-Null }
  catch { $status.Text = $_.Exception.Message }
})
$startupBox.Add_CheckedChanged({
  if ($script:updatingStartup) { return }
  try { Set-StartAtLogin $startupBox.Checked; $status.Text = if ($startupBox.Checked) { 'The helper will start when you sign in.' } else { 'Start at sign-in is off.' } }
  catch {
    $status.Text = $_.Exception.Message
    $script:updatingStartup = $true
    try { $startupBox.Checked = -not $startupBox.Checked }
    finally { $script:updatingStartup = $false }
  }
})
[void]$form.ShowDialog()
