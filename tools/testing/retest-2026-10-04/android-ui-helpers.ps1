# Parameterized adb/UI-dump helpers for the 2026-10-04 retest scenarios
# (successor: G21.36, issue #592). Adapted from the historical
# .scratch/ui-2026-10-04/android-ui-helpers.ps1: adb path, device serial and
# evidence directory are parameters, device readiness is bounded, and every
# adb failure is raised as an exception so error output survives. Dot-source
# this file, then call Save-KudyScreen / Get-KudyUi / Tap-KudyNode.

param(
    [Parameter(Mandatory = $true)]
    [string]$EvidenceDir,
    [string]$AdbPath = $(if ($env:KUDY_ADB) { $env:KUDY_ADB } else { Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe' }),
    [string]$DeviceSerial = $(if ($env:KUDY_DEVICE_SERIAL) { $env:KUDY_DEVICE_SERIAL } else { 'emulator-5554' }),
    [int]$ReadyTimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $AdbPath)) { throw "adb not found: $AdbPath" }
New-Item -ItemType Directory -Path $EvidenceDir -Force | Out-Null

# Bounded device readiness: poll instead of an unbounded wait-for-device block.
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
while ($true) {
    $state = & $AdbPath -s $DeviceSerial get-state 2>&1
    if ($LASTEXITCODE -eq 0 -and $state -eq 'device') { break }
    if ((Get-Date) -gt $deadline) {
        throw "Device $DeviceSerial not ready after ${ReadyTimeoutSeconds}s (last state: $($state -join ' '))"
    }
    Start-Sleep -Seconds 2
}

function Invoke-KudyAdb {
    $Arguments = @($args)
    $output = & $AdbPath -s $DeviceSerial @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($output -join "`n") }
    return $output
}

function Get-KudyUi {
    param([string]$Name)
    Invoke-KudyAdb shell timeout 30 uiautomator dump /sdcard/kudy-ui.xml | Out-Null
    Invoke-KudyAdb pull /sdcard/kudy-ui.xml "$EvidenceDir/$Name.xml" | Out-Null
    [xml]$tree = Get-Content "$EvidenceDir/$Name.xml" -Raw
    $tree.SelectNodes('//node') | ForEach-Object {
        [pscustomobject]@{
            text = $_.GetAttribute('text')
            description = $_.GetAttribute('content-desc')
            id = $_.GetAttribute('resource-id')
            bounds = $_.GetAttribute('bounds')
            clickable = $_.GetAttribute('clickable')
            selected = $_.GetAttribute('selected')
            package = $_.GetAttribute('package')
        }
    }
}

function Save-KudyScreen {
    param([string]$Name)
    $nodes = Get-KudyUi $Name
    Invoke-KudyAdb shell screencap -p /sdcard/kudy-screen.png | Out-Null
    Invoke-KudyAdb pull /sdcard/kudy-screen.png "$EvidenceDir/$Name.png" | Out-Null
    return $nodes
}

function Tap-KudyNode {
    param($Node)
    if ($Node.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw 'Invalid observed bounds' }
    $x = [int](([int]$Matches[1] + [int]$Matches[3]) / 2)
    $y = [int](([int]$Matches[2] + [int]$Matches[4]) / 2)
    Invoke-KudyAdb shell input tap $x $y | Out-Null
}
