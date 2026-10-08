# G21.36 (issue #592): install a freshly built debug APK on a real Android emulator, load the bundle
# from Metro started in the same checkout, and run the published native navigation / locale /
# large-font / background scenarios of the 2026-10-04 retest. Writes UI dumps, screenshots,
# the crash buffer and results.json into <BuildRoot>\evidence\android.
# Every root is a parameter; environment changes stay in this process. Busy emulator/Metro ports
# are refused before anything starts, and the serial and the Metro port are acted on only while
# their listener belongs to a process this script started; only those processes are stopped.
# Every build-root path it writes (evidence\android, logs, tmp) is checked with the own-paths.mjs rules of
# android-build before the first write and again before the results are written; a junction, symlink or hard link
# there is refused instead of followed.
# Exit code: 0 only when all checks ran and passed with an empty crash buffer, 73 when a build-root output path is
# refused, otherwise 1.
param(
  [Parameter(Mandatory)][string]$BuildRoot,
  [Parameter(Mandatory)][string]$Sdk,
  [Parameter(Mandatory)][string]$AvdHome,
  [Parameter(Mandatory)][string]$AndroidUserHome,
  [Parameter(Mandatory)][string]$Avd,
  [Parameter(Mandatory)][string]$Apk,
  [string]$Checkout = '',
  [int]$EmuPort = 5558, [int]$MetroPort = 8083)
$ErrorActionPreference = 'Continue'
# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside param defaults, so the checkout default is set here.
if (-not $Checkout) { $Checkout = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
. (Join-Path $PSScriptRoot 'emulator-guards.ps1')
$ExpectedChecks = 26
$serial = "emulator-$EmuPort"
$ev = "$BuildRoot\evidence\android"
$logNames = 'emulator.out.log', 'emulator.err.log', 'metro.out.log', 'metro.err.log'
$ownPaths = @('--dir', 'tmp', '--entries', 'evidence/android') + @($logNames | ForEach-Object { '--file', "logs/$_" })
$pathRefused = Test-OwnBuildPaths $BuildRoot $Checkout $ownPaths
if ($pathRefused) { "REFUSED build output path: $pathRefused"; 'EXIT 73'; exit 73 }
$adb = "$Sdk\platform-tools\adb.exe"
$env:ANDROID_HOME = $Sdk; $env:ANDROID_SDK_ROOT = $Sdk; $env:ANDROID_AVD_HOME = $AvdHome
$env:ANDROID_USER_HOME = $AndroidUserHome; $env:ANDROID_EMULATOR_HOME = $AndroidUserHome
$env:TEMP = "$BuildRoot\tmp"; $env:TMP = "$BuildRoot\tmp"
$checks = [Collections.Generic.List[object]]::new()
$emuProc = $null; $metroProc = $null; $emuOwned = $false; $crashLines = $null; $verdict = $null

function Adb { $out = & $adb -s $serial @args 2>&1; if ($LASTEXITCODE -ne 0) { throw "adb $($args -join ' '): $($out -join ' ')" }; $out }
# A failed dump throws (after retries) instead of leaving an older screen to evaluate.
function Dump([string]$Name) { Get-UiDump $adb $serial "$ev\$Name.xml" }
function Shot([string]$Name) { [IO.File]::Delete("$ev\$Name.png"); cmd /c "`"$adb`" -s $serial exec-out screencap -p > `"$ev\$Name.png`"" }
# While waiting, a failed dump only means "not there yet"; if the last dump before the deadline
# failed, the wait throws rather than return a screen it did not see.
function WaitFor([string]$Name, [scriptblock]$Pred, [int]$Seconds = 30) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try { $n = Dump $Name; $failure = $null } catch { $n = $null; $failure = $_ }
    if (-not $failure -and (& $Pred $n)) { return $n }
    Start-Sleep 2
  } while ((Get-Date) -lt $deadline)
  if ($failure) { throw $failure }
  return $n
}
function Check([string]$Name, [string]$File, [bool]$Passed, [string]$Detail = '') {
  $checks.Add([pscustomobject]@{ name = $Name; status = $(if ($Passed) { 'passed' } else { 'failed' }); evidence = "$File.xml"; detail = $Detail })
  "$(if ($Passed) {'PASS'} else {'FAIL'}) $Name $Detail"
}
function Node([object[]]$n, [string]$Id) { $n | Where-Object { $_.'resource-id' -eq $Id } | Select-Object -First 1 }
function HasId($n, [string]$Id) { [bool](Node $n $Id) }
function HasText($n, [string]$Text) { [bool]($n | Where-Object { $_.text -like "*$Text*" }) }
function Tap($node) {
  if ($node.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$') { throw "bad bounds $($node.bounds)" }
  Adb shell input tap ([int](([int]$Matches[1] + [int]$Matches[3]) / 2)) ([int](([int]$Matches[2] + [int]$Matches[4]) / 2)) | Out-Null
}
function TapId([string]$Id, [string]$Name) { $n = Dump "$Name-before"; $x = Node $n $Id; if (-not $x) { throw "no $Id on $Name" }; Tap $x }
function Back { Adb shell input keyevent 4 | Out-Null; Start-Sleep 2 }
function Selected($n, [string]$Code) { [bool]($n | Where-Object { $_.'resource-id' -eq "btn-ui-locale-$Code" -and $_.selected -eq 'true' }) }
function Open([string]$Uri) { Adb shell am start -W -a android.intent.action.VIEW -d "`"$Uri`"" by.kudy.app | Out-Null; Start-Sleep 3 }
function Height($node) { if ($node.bounds -match '^\[\d+,(\d+)\]\[\d+,(\d+)\]$') { [int]$Matches[2] - [int]$Matches[1] } else { 0 } }
function DismissDevMenu {
  $n = Dump 'devmenu-probe'
  $c = $n | Where-Object { $_.text -eq 'Continue' -or $_.'content-desc' -eq 'Continue' } | Select-Object -First 1
  if ($c) { Tap $c; Start-Sleep 2; Back }
}
$isExplore = { param($n) HasId $n 'screen-Explore' }
# A device that is not proven ours is never read, changed or stopped.
function Assert-OwnEmulator {
  if (-not ($emuProc -and (Test-PortOwnedBy $EmuPort $emuProc.Id))) { throw "$serial is not served by the emulator this script started (pid $($emuProc.Id)); refusing to act on it" }
}
function Write-Results {
  # The paths are checked again: the run takes minutes, and nothing is written through a link that appeared meanwhile.
  $script:pathRefused = Test-OwnBuildPaths $BuildRoot $Checkout $ownPaths
  if ($script:pathRefused) { "REFUSED build output path: $($script:pathRefused)"; return }
  if ($script:emuOwned) {
    $crash = @(& $adb -s $serial logcat -b crash -d 2>&1)
    Write-NewFile "$ev\android-crash.log" $crash
    $script:crashLines = $crash.Count
  }
  $script:verdict = Get-ScenarioVerdict $script:fatal $checks.ToArray() $ExpectedChecks $script:crashLines
  $apkFile = if (Test-Path -LiteralPath $Apk) { Get-Item -LiteralPath $Apk } else { $null }
  $summary = [ordered]@{
    date = (Get-Date).ToString('s'); head = (git -C $Checkout rev-parse HEAD); device = $device
    apk = [ordered]@{ path = $Apk; bytes = $apkFile.Length; sha256 = $(if ($apkFile) { (Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash }); installed = ($script:pkg -join '; ') }
    metro = [ordered]@{ port = $MetroPort; maxWorkers = 2 }
    totals = [ordered]@{ checks = $checks.Count; expected = $ExpectedChecks; passed = @($checks | Where-Object status -eq 'passed').Count; failed = @($checks | Where-Object status -eq 'failed').Count }
    checks = $checks.ToArray(); fatal = $script:fatal; crashBufferLines = $script:crashLines; restoredFontScale = "$fontAfter"
    exitCode = $script:verdict.exitCode; failureReasons = $script:verdict.reasons
  }
  Write-NewFile "$ev\results.json" @($summary | ConvertTo-Json -Depth 6)
  "TOTALS $($summary.totals | ConvertTo-Json -Compress)"
}
$fatal = $null; $pkg = @(); $device = $null; $fontAfter = $null

try {
  "== ports"
  $busy = Get-BusyPorts @($EmuPort, ($EmuPort + 1), $MetroPort)
  if ($busy.Count -gt 0) { throw "port(s) already in use: $($busy -join ', '); another emulator or Metro may run there, refusing to start or touch it" }
  # A shared adb server started from this console would inherit the redirected output and keep a caller that waits for
  # the output to close hanging; Start-Process starts it without inherited handles (no-op if one already runs). Only the
  # client is awaited: Start-Process -Wait would also wait for the server it forks, which never exits.
  $adbStart = Start-Process -FilePath $adb -ArgumentList 'start-server' -PassThru -WindowStyle Hidden
  if (-not $adbStart.WaitForExit(60000)) { throw 'adb start-server did not finish within 60 s' }
  if (@(& $adb devices 2>$null) -match "^$serial\s") { throw "$serial is already listed by adb; refusing to act on a device this script did not start" }

  "== emulator"
  foreach ($name in $logNames[0..1]) { [IO.File]::Delete("$BuildRoot\logs\$name") }
  $emuProc = Start-Process "$Sdk\emulator\emulator.exe" -ArgumentList @('-avd', $Avd, '-port', $EmuPort, '-read-only', '-no-snapshot', '-no-boot-anim', '-no-audio', '-memory', '2048', '-cores', '2', '-gpu', 'swiftshader_indirect') -PassThru -RedirectStandardOutput "$BuildRoot\logs\emulator.out.log" -RedirectStandardError "$BuildRoot\logs\emulator.err.log"
  $null = $emuProc.Handle  # keeps the exit code readable in Windows PowerShell 5.1
  "emulator pid=$($emuProc.Id)"
  $deadline = (Get-Date).AddMinutes(6)
  while ($true) {
    if ($emuProc.HasExited) { throw "own emulator process $($emuProc.Id) exited with code $($emuProc.ExitCode) while booting; see $BuildRoot\logs\emulator.err.log" }
    if ((Test-PortOwnedBy $EmuPort $emuProc.Id) -and ((& $adb -s $serial shell getprop sys.boot_completed 2>$null) -eq '1')) { break }
    if ((Get-Date) -gt $deadline) { throw 'emulator boot timeout' }
    Start-Sleep 5
  }
  $emuOwned = $true
  $device = [ordered]@{ serial = $serial; avd = $Avd; android = (Adb shell getprop ro.build.version.release); api = (Adb shell getprop ro.build.version.sdk); abi = (Adb shell getprop ro.product.cpu.abi); screen = ((Adb shell wm size) -replace 'Physical size: ', ''); density = ((Adb shell wm density) -replace 'Physical density: ', '') }
  "device: $($device | ConvertTo-Json -Compress)"
  Assert-OwnEmulator
  Adb shell settings put system font_scale 1.0 | Out-Null
  Adb install -r $Apk | Out-Null
  $pkg = (Adb shell dumpsys package by.kudy.app) | Select-String -Pattern 'versionName|lastUpdateTime' | ForEach-Object { $_.Line.Trim() }
  "installed: $($pkg -join '; ')"

  "== metro"
  $env:CI = '1'; $env:EXPO_NO_TELEMETRY = '1'
  if ((Get-BusyPorts @($MetroPort)).Count -gt 0) { throw "Metro port $MetroPort became busy; refusing to use a server this script did not start" }
  foreach ($name in $logNames[2..3]) { [IO.File]::Delete("$BuildRoot\logs\$name") }
  $metroProc = Start-Process node -ArgumentList @("$Checkout\node_modules\expo\bin\cli", 'start', '--dev-client', '--port', $MetroPort, '--max-workers', '2') -WorkingDirectory $Checkout -PassThru -RedirectStandardOutput "$BuildRoot\logs\metro.out.log" -RedirectStandardError "$BuildRoot\logs\metro.err.log" -WindowStyle Hidden
  $null = $metroProc.Handle
  "metro pid=$($metroProc.Id)"
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep 3
    if ($metroProc.HasExited) { throw "own Metro process $($metroProc.Id) exited with code $($metroProc.ExitCode); see $BuildRoot\logs\metro.err.log" }
    try { $c = (Invoke-WebRequest "http://localhost:$MetroPort/status" -UseBasicParsing -TimeoutSec 5).Content; $st = if ($c -is [byte[]]) { [Text.Encoding]::UTF8.GetString($c) } else { "$c" } } catch { $st = '' }
  } while ($st -notmatch 'running' -and (Get-Date) -lt $deadline)
  "metro status: $st"
  if ($st -notmatch 'running') { throw "Metro on port $MetroPort did not report running within 3 minutes" }
  if (-not (Test-PortOwnedBy $MetroPort $metroProc.Id)) { throw "Metro port $MetroPort is not served by the Metro this script started (pid $($metroProc.Id))" }
  Assert-OwnEmulator
  Adb reverse "tcp:$MetroPort" "tcp:$MetroPort" | Out-Null

  "== scenarios"
  Open "kudy://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$MetroPort"
  $n = WaitFor 'cold-start-normal' $isExplore 300
  if (-not (& $isExplore $n)) { DismissDevMenu; $n = WaitFor 'cold-start-normal' $isExplore 60 }
  Shot 'cold-start-normal'
  Check 'Cold launch reaches Explore' 'cold-start-normal' (& $isExplore $n)
  $n = Dump 'explore-be'
  Check 'Catalog has a visible unavailable message' 'explore-be' (HasText $n 'Каталог недаступны')

  TapId 'link-nearby' 'explore-be'; $n = WaitFor 'nearby-be' { param($n) HasId $n 'screen-Map' }
  Check 'Explore tap opens Nearby' 'nearby-be' (HasId $n 'screen-Map')
  Back; $n = WaitFor 'before-discovery' $isExplore
  Check 'Nearby Back returns to Explore' 'before-discovery' (& $isExplore $n)
  TapId 'link-discovery' 'before-discovery'; $n = WaitFor 'discovery-be' { param($n) HasText $n 'Чым заняцца' }
  Check 'Explore tap opens Discovery' 'discovery-be' (HasText $n 'Чым заняцца')
  Back; $n = WaitFor 'before-kudy' $isExplore
  Check 'Discovery Back returns to Explore' 'before-kudy' (& $isExplore $n)
  TapId 'link-kudy' 'before-kudy'; $n = WaitFor 'kudy-be' { param($n) HasId $n 'screen-KUDY' }
  Check 'Explore tap opens KUDY' 'kudy-be' (HasId $n 'screen-KUDY')
  $chips = @($n | Where-Object { $_.'resource-id' -like 'btn-ui-locale-*' }).Count

  TapId 'btn-ui-locale-en' 'kudy-be'; $n = WaitFor 'kudy-en' { param($n) (Selected $n 'en') -and (HasText $n 'History unavailable.') }
  Check 'English applies without restart and is selected' 'kudy-en' ((Selected $n 'en') -and (HasText $n 'History unavailable.'))
  Back; $n = WaitFor 'explore-en' { param($n) HasText $n 'Nearby' }
  Shot 'explore-en'
  Check 'Explore uses English after switch' 'explore-en' ((& $isExplore $n) -and (HasText $n 'Nearby'))
  TapId 'link-nearby' 'explore-en'; $n = WaitFor 'nearby-after-en' { param($n) HasId $n 'screen-Map' }
  Shot 'nearby-after-en'
  Check 'Nearby uses English after switch' 'nearby-after-en' ((HasId $n 'screen-Map') -and (HasText $n 'Nearby'))
  Back; $n = WaitFor 'before-discovery-en' $isExplore
  Check 'Android Back returns to Explore' 'before-discovery-en' (& $isExplore $n)
  TapId 'link-discovery' 'before-discovery-en'; $n = WaitFor 'discovery-en' { param($n) HasText $n 'Discovery unavailable' }
  Check 'Discovery uses English after switch' 'discovery-en' (HasText $n 'Discovery unavailable')
  Back; TapId 'link-kudy' 'explore-en-2'; Start-Sleep 2
  TapId 'btn-ui-locale-uk' 'kudy-en-2'; $n = WaitFor 'kudy-uk' { param($n) (Selected $n 'uk') -and (HasText $n 'Історія недоступна.') }
  Check 'Ukrainian applies without restart and is selected' 'kudy-uk' ((Selected $n 'uk') -and (HasText $n 'Історія недоступна.'))
  Back; $n = WaitFor 'explore-uk' { param($n) HasText $n 'Поруч' }
  Check 'Explore uses Ukrainian after switch' 'explore-uk' ((& $isExplore $n) -and (HasText $n 'Поруч'))
  TapId 'link-nearby' 'explore-uk'; $n = WaitFor 'nearby-after-uk' { param($n) HasId $n 'screen-Map' }
  Shot 'nearby-after-uk'
  Check 'Nearby uses Ukrainian after switch' 'nearby-after-uk' ((HasId $n 'screen-Map') -and (HasText $n 'Поруч'))
  Back

  Open 'kudy://does-not-exist'; $n = WaitFor 'unknown-route-uk' { param($n) HasText $n 'Такого екрана немає' }
  Check 'Unknown link shows localized explanation' 'unknown-route-uk' (HasText $n 'Такого екрана немає')
  Back; $n = WaitFor 'unknown-back-explore' $isExplore
  Check 'Unknown link Back returns to Explore' 'unknown-back-explore' (& $isExplore $n)
  Open 'kudy://route/g2136-missing'; $n = WaitFor 'guide-unavailable-uk' { param($n) HasText $n 'Каталог недоступний' }
  Check 'Unavailable guide uses Ukrainian' 'guide-unavailable-uk' ((HasId $n 'screen-Route preview') -and (HasText $n 'Каталог недоступний'))
  Back
  Open 'kudy://run/g2136-missing'; $n = WaitFor 'run-unavailable-uk' { param($n) HasText $n 'Сесія недоступна' }
  Check 'Unavailable run uses Ukrainian' 'run-unavailable-uk' (HasText $n 'Сесія недоступна')
  Back
  Open 'kudy://place/g2136-missing'; $n = WaitFor 'place-unavailable' { param($n) HasId $n 'screen-Place detail' } 
  Check 'Place link shows an unavailable state' 'place-unavailable' ((HasId $n 'screen-Place detail') -and ((HasText $n 'недаступн') -or (HasText $n 'недоступн') -or (HasText $n 'unavailable')))
  Back
  Open 'kudy://collection/g2136-missing'; $n = WaitFor 'collection-unavailable' { param($n) (HasText $n 'недаступн') -or (HasText $n 'недоступн') }
  Check 'Collection link shows an unavailable state' 'collection-unavailable' ((HasText $n 'недаступн') -or (HasText $n 'недоступн'))
  Back
  Open 'kudy://city/g2136-missing/guides'; $n = WaitFor 'city-guides-unavailable' { param($n) HasId $n 'screen-Guides' }
  Check 'City guides link shows an unavailable state' 'city-guides-unavailable' ((HasId $n 'screen-Guides') -and ((HasText $n 'Каталог недоступний') -or (HasText $n 'Каталог недаступны')))
  Back

  "== large font"
  TapId 'link-kudy' 'explore-before-font'; Start-Sleep 2
  TapId 'btn-ui-locale-be' 'kudy-before-font'; $n = WaitFor 'kudy-font-100' { param($n) Selected $n 'be' }
  $label100 = Height ($n | Where-Object { $_.text -eq 'Мова' } | Select-Object -First 1)
  Adb shell am force-stop by.kudy.app | Out-Null
  Adb shell settings put system font_scale 1.5 | Out-Null
  Open "kudy://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$MetroPort"
  $n = WaitFor 'explore-font-150-clean' $isExplore 180
  Shot 'explore-font-150-clean'
  $links = @($n | Where-Object { $_.'resource-id' -like 'link-*' -and $_.clickable -eq 'true' }).Count
  TapId 'link-kudy' 'explore-font-150-clean'; $n = WaitFor 'kudy-font-150-clean' { param($n) HasId $n 'screen-KUDY' }
  Shot 'kudy-font-150-clean'
  $chips150 = @($n | Where-Object { $_.'resource-id' -like 'btn-ui-locale-*' -and $_.clickable -eq 'true' }).Count
  $label150 = Height ($n | Where-Object { $_.text -eq 'Мова' } | Select-Object -First 1)
  Check 'Large font keeps all language buttons visible' 'kudy-font-150-clean' (($chips150 -eq $chips) -and ($chips -ge 3)) "chips=$chips150/$chips"
  Check 'Large font grows the language label' 'kudy-font-150-clean' ($label150 -gt $label100) "height100=$label100 height150=$label150"
  Check 'Large font keeps all Explore links visible' 'explore-font-150-clean' ($links -eq 3) "links=$links"
  Adb shell settings put system font_scale 1.0 | Out-Null
  $fontAfter = Adb shell settings get system font_scale

  "== background"
  Adb shell am force-stop by.kudy.app | Out-Null
  Open "kudy://expo-development-client/?url=http%3A%2F%2Flocalhost%3A$MetroPort"
  $n = WaitFor 'explore-before-background' $isExplore 180
  TapId 'link-kudy' 'explore-before-background'; Start-Sleep 2
  TapId 'btn-ui-locale-en' 'kudy-before-background'; $n = WaitFor 'kudy-en-before-background' { param($n) Selected $n 'en' }
  Adb shell input keyevent 3 | Out-Null; Start-Sleep 8
  Adb shell monkey -p by.kudy.app -c android.intent.category.LAUNCHER 1 | Out-Null; Start-Sleep 4
  $n = WaitFor 'after-background-en' { param($n) HasId $n 'screen-KUDY' }
  Shot 'after-background-en'
  Check 'Background return preserves KUDY screen and English' 'after-background-en' ((HasId $n 'screen-KUDY') -and (HasText $n 'History unavailable.') -and (Selected $n 'en'))
  TapId 'btn-ui-locale-be' 'kudy-restore-be'; Start-Sleep 1

  Write-Results
} catch {
  $fatal = "$_ @ line $($_.InvocationInfo.ScriptLineNumber)"; "FATAL $fatal"
  Write-Results
} finally {
  # adb commands go to the serial only while its console port is still served by our emulator.
  $stillOurs = $emuProc -and -not $emuProc.HasExited -and (Test-PortOwnedBy $EmuPort $emuProc.Id)
  if ($stillOurs) {
    & $adb -s $serial shell settings put system font_scale 1.0 2>&1 | Out-Null
    & $adb -s $serial reverse --remove "tcp:$MetroPort" 2>&1 | Out-Null
  }
  if ($metroProc -and -not $metroProc.HasExited) { & taskkill.exe /T /F /PID $metroProc.Id 2>&1 | Out-Null; "metro stopped (own pid $($metroProc.Id))" }
  if ($emuProc) {
    if ($stillOurs) { & $adb -s $serial emu kill 2>&1 | Out-Null; Start-Sleep 5 }
    if (-not $emuProc.HasExited) { & taskkill.exe /T /F /PID $emuProc.Id 2>&1 | Out-Null }
    "emulator stopped (own pid $($emuProc.Id))"
  }
}
if (-not $verdict) { $verdict = Get-ScenarioVerdict $fatal $checks.ToArray() $ExpectedChecks $crashLines }
foreach ($reason in $verdict.reasons) { "NOT OK $reason" }
if ($pathRefused) { "NOT OK build output path refused: $pathRefused"; 'EXIT 73'; exit 73 }
"EXIT $($verdict.exitCode)"
exit $verdict.exitCode
