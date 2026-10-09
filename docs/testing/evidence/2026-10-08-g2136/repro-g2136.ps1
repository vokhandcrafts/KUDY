# G21.36 controlled reproduction of "Failed to clean up output files" (task-owned paths only).
param([string]$Checkout = 'D:\KUDY-592', [string]$BuildRoot = 'D:\KUDY-592-build',
      [string]$Sdk = 'D:\KUDY-Android\sdk', [string]$Jdk = 'D:\KUDY-Android\java\jdk-17.0.20.1+1')
$ErrorActionPreference = 'Continue'
$env:JAVA_HOME = $Jdk; $env:ANDROID_HOME = $Sdk; $env:ANDROID_SDK_ROOT = $Sdk
$env:GRADLE_USER_HOME = "$BuildRoot\gradle-home"; $env:GRADLE_RO_DEP_CACHE = 'D:\KUDY-Android\gradle\caches'
$env:TEMP = "$BuildRoot\tmp"; $env:TMP = "$BuildRoot\tmp"; $env:Path = "$Jdk\bin;$env:Path"
$task = ':expo-dev-launcher-gradle-plugin:compileKotlin'
$out = "$Checkout\node_modules\expo-dev-launcher\expo-dev-launcher-gradle-plugin\build"
function Run-Step([string]$Name, [string[]]$Extra) {
  $log = "$BuildRoot\logs\repro-$Name.log"
  $gargs = @($task, '--rerun-tasks', '--no-daemon', '--console=plain', '--gradle-user-home', "$BuildRoot\gradle-home") + $Extra
  Push-Location "$Checkout\android"
  $t0 = Get-Date
  & cmd.exe /d /c "gradlew.bat $($gargs -join ' ') > `"$log`" 2>&1"
  $code = $LASTEXITCODE
  Pop-Location
  $why = (Select-String -Path $log -Pattern 'Failed to clean up output files|Couldn.t delete|Unable to delete|BUILD (SUCCESSFUL|FAILED)' | ForEach-Object { $_.Line.Trim() }) -join ' | '
  "STEP $Name exit=$code sec=$([int]((Get-Date)-$t0).TotalSeconds) :: $why"
}
function Kotlin-Daemons {
  Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -match 'KotlinCompileDaemon' } |
    ForEach-Object { "kotlin-daemon pid=$($_.ProcessId) ownedMarker=$($_.CommandLine -match [regex]::Escape('D:/KUDY-592-build'))" }
}
function Open-Handles([string]$Dir) {
  # Which files under $Dir can be opened for delete right now (FileShare.Delete denied = held by another process)?
  $held = 0; $total = 0
  Get-ChildItem $Dir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $total++
    try { $s = [IO.File]::Open($_.FullName, 'Open', 'ReadWrite', 'None'); $s.Close() } catch { $held++; if ($held -le 5) { "  held: $($_.FullName.Replace($Dir,''))" } }
  }
  "  files=$total held=$held"
}

"== A. Kotlin compile daemon strategy (as in the 2026-10-04 retest), two runs"
$daemonProps = @('-Pkotlin.compiler.execution.strategy=daemon', '"-Pkotlin.daemon.jvmargs=-Xmx768m -Djava.io.tmpdir=D:/KUDY-592-build/tmp"')
Run-Step 'A1-daemon' $daemonProps
Kotlin-Daemons
"  handles in build output after A1 (no Gradle process alive):"
Open-Handles $out
Run-Step 'A2-daemon-rerun' $daemonProps
"== B. stop task-owned leftovers"
node "$Checkout\tools\android-build\android-build.mjs" stop-owned --build-root $BuildRoot --sdk $Sdk --jdk $Jdk 2>&1
Kotlin-Daemons
Open-Handles $out
"== C. in-process Kotlin (the fix), two runs"
Run-Step 'C1-inprocess' @()
Run-Step 'C2-inprocess-rerun' @()
Kotlin-Daemons
"== D. explicit lock on one output file, in-process"
$lockFile = Get-ChildItem "$out\classes" -Recurse -File | Select-Object -First 1
$lock = [IO.File]::Open($lockFile.FullName, 'Open', 'Read', 'None')
"  holding $($lockFile.FullName.Replace($Checkout,''))"
Run-Step 'D1-locked' @()
$lock.Close()
Run-Step 'D2-released' @()
"== done"
