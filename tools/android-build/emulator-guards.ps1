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
