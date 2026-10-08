# G21.36 (#592): ownership and verdict helpers for emulator-scenarios.ps1, kept separate so the
# tests can dot-source them without starting an emulator.

# Ports that already have a TCP listener (any address, IPv4 or IPv6).
function Get-BusyPorts([int[]]$Ports) {
  @($Ports | Where-Object { @(Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue).Count -gt 0 })
}

# True when process $ProcessId is $RootPid or one of its descendants.
function Test-ProcessDescendant([int]$ProcessId, [int]$RootPid) {
  $current = $ProcessId
  for ($depth = 0; $depth -lt 10 -and $current -gt 0; $depth++) {
    if ($current -eq $RootPid) { return $true }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction SilentlyContinue
    if (-not $proc) { return $false }
    $current = [int]$proc.ParentProcessId
  }
  return $false
}

# True only when the port has a listener and every listener belongs to $RootPid's process tree.
# The emulator console port proves which process answers for serial emulator-<port>; the Metro
# port proves the bundle server is the one this script started in this checkout.
function Test-PortOwnedBy([int]$Port, [int]$RootPid) {
  $owners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -eq 0) { return $false }
  foreach ($owner in $owners) { if (-not (Test-ProcessDescendant ([int]$owner) $RootPid)) { return $false } }
  return $true
}

# Exit code of a scenario run: 0 only with no fatal error, the full set of checks, every check
# passed and an empty crash buffer that was actually read ($CrashLines = $null means unread).
function Get-ScenarioVerdict($Fatal, [object[]]$Checks, [int]$Expected, $CrashLines) {
  $reasons = [Collections.Generic.List[string]]::new()
  if ($Fatal) { $reasons.Add("fatal: $Fatal") }
  $count = @($Checks).Count
  if ($count -ne $Expected) { $reasons.Add("incomplete scenario set: $count of $Expected checks ran") }
  $failed = @($Checks | Where-Object { $_.status -ne 'passed' })
  if ($failed.Count -gt 0) { $reasons.Add("failed checks: $(($failed | ForEach-Object { $_.name }) -join '; ')") }
  if ($null -eq $CrashLines) { $reasons.Add('crash buffer was not read') }
  elseif ([int]$CrashLines -gt 0) { $reasons.Add("crash buffer has $CrashLines line(s)") }
  [pscustomobject]@{ exitCode = $(if ($reasons.Count -eq 0) { 0 } else { 1 }); reasons = $reasons.ToArray() }
}

# One UI dump of $Serial into $Destination; returns the <node> elements. A failed dump must never
# yield an older screen: the local copy is removed first, every attempt dumps to a new device file,
# the file is pulled only after uiautomator reported the dump, and it is deleted again afterwards.
# Throws when all $Attempts failed.
function Get-UiDump([string]$Adb, [string]$Serial, [string]$Destination, [int]$Attempts = 3, [int]$DelaySeconds = 2) {
  $ErrorActionPreference = 'Continue'
  $failures = [Collections.Generic.List[string]]::new()
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Destination) { throw "cannot remove the previous dump $Destination" }
    $remote = "/sdcard/kudy-ui-$([guid]::NewGuid().ToString('N')).xml"
    try {
      $out = (@(& $Adb -s $Serial shell uiautomator dump $remote 2>&1) -join ' ').Trim()
      $code = $LASTEXITCODE
      if ($code -ne 0 -or $out -notmatch 'dumped to') { $failures.Add("attempt ${attempt}: dump exit $code '$out'"); continue }
      $out = (@(& $Adb -s $Serial pull $remote $Destination 2>&1) -join ' ').Trim()
      $code = $LASTEXITCODE
      if ($code -ne 0 -or -not (Test-Path -LiteralPath $Destination)) { $failures.Add("attempt ${attempt}: pull exit $code '$out'"); continue }
      try { [xml]$xml = Get-Content -LiteralPath $Destination -Raw -Encoding utf8 } catch { $failures.Add("attempt ${attempt}: unreadable XML: $_"); continue }
      if (-not $xml.hierarchy) { $failures.Add("attempt ${attempt}: no UI hierarchy in the dump"); continue }
      return @($xml.SelectNodes('//node'))
    } finally {
      & $Adb -s $Serial shell rm -f $remote 2>&1 | Out-Null
      if ($failures.Count -ge $attempt) {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
        if ($attempt -lt $Attempts) { Start-Sleep -Seconds $DelaySeconds }
      }
    }
  }
  throw "UI dump $Destination failed after $Attempts attempts: $($failures -join '; ')"
}
