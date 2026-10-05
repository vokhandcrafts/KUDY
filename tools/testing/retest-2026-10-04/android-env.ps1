# Parameterized Android/JDK environment bootstrap for the 2026-10-04 retest
# entry points (successor: G21.36, issue #592). Adapted from the historical
# .scratch/ui-2026-10-02/android-env.ps1: every root comes from the caller's
# environment, no machine-specific drive letters are baked in. Changes are
# scoped to this process and its children; nothing global is mutated.

$ErrorActionPreference = 'Stop'

$AndroidHome = $env:KUDY_ANDROID_HOME
$JavaHome = $env:KUDY_JAVA_HOME
$GradleUserHome = $env:KUDY_GRADLE_USER_HOME
$AndroidUserHome = $env:KUDY_ANDROID_USER_HOME

if (-not $AndroidHome) {
    throw 'Set KUDY_ANDROID_HOME to an existing task-owned root that contains the Android SDK.'
}
if (-not (Test-Path $AndroidHome)) { throw "KUDY_ANDROID_HOME does not exist: $AndroidHome" }
if (-not $JavaHome) {
    throw 'Set KUDY_JAVA_HOME to an existing JDK 17+ installation under the task-owned root.'
}
if (-not (Test-Path $JavaHome)) { throw "KUDY_JAVA_HOME does not exist: $JavaHome" }

$env:ANDROID_HOME = $AndroidHome
$env:ANDROID_SDK_ROOT = $AndroidHome
$env:ANDROID_USER_HOME = if ($AndroidUserHome) { $AndroidUserHome } else { Join-Path $AndroidHome 'android-user' }
$env:ANDROID_EMULATOR_HOME = $env:ANDROID_USER_HOME
$env:ANDROID_AVD_HOME = $env:ANDROID_USER_HOME
$env:JAVA_HOME = $JavaHome
$env:GRADLE_USER_HOME = if ($GradleUserHome) { $GradleUserHome } else { Join-Path $AndroidHome 'gradle' }
$env:TEMP = Join-Path $AndroidHome 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$env:npm_config_cache = Join-Path $AndroidHome 'npm-cache'
$env:EXPO_NO_TELEMETRY = '1'
$env:EXPO_NO_DOTENV = '1'
$env:CI = '1'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"

Write-Host "android-env: ANDROID_HOME=$env:ANDROID_HOME JAVA_HOME=$env:JAVA_HOME GRADLE_USER_HOME=$env:GRADLE_USER_HOME"
