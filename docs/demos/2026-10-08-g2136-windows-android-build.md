# G21.36 — паўторная debug-зборка Android на Windows

*2026-10-08T00:24:05Z by Showboat 0.6.1*
<!-- showboat-id: 0f0b5a3f-5db4-4edf-8915-c3de44d3d773 -->

G21.36 (issue #592): `tools/android-build/` збірае debug-APK з апублікаванага checkout з уласнай хатняй тэчкай Gradle, без Gradle-дэмана, з Kotlin унутры працэсу зборкі і абмежаванымі воркерамі; чыстка разгортвае junction і не выдаляе нічога па-за checkout і тэчкай зборкі задачы. Каманды ніжэй выкананыя на Windows-хасце ўладальніка ў клоне `D:\KUDY-592`.

Каманда 1: стан хоста, на якім зроблены доказы (implementation-rules 9).

```powershell
& { Set-Location D:\KUDY-592; "os: " + [Environment]::OSVersion.VersionString; "node: " + (node -v); cmd /c "D:\KUDY-Android\java\jdk-17.0.20.1+1\bin\java.exe -version 2>&1" | Select-Object -First 1; "core.autocrlf: " + (git config core.autocrlf) } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
os: Microsoft Windows NT 10.0.26200.0
node: v24.13.0
openjdk version "17.0.20.1" 2026-08-18
core.autocrlf: true
```

Каманда 2: тэсты інструмента. На Windows яны ствараюць сапраўдныя junction: чужы і ўкладзены junction адхіляюцца, junction у тэчку зборкі выдаляецца як спасылка, а спыняюцца толькі JVM гэтай тэчкі зборкі. Адкат любой праверкі робіць адпаведны радок `not ok`.

```powershell
& { Set-Location D:\KUDY-592; node --test --test-reporter=tap tools/android-build/scoped-clean.test.mjs tools/android-build/build-config.test.mjs 2>$null | Select-String -Pattern "^(ok|not ok|1\.\.)" | ForEach-Object { $_.Line } } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
ok 1 - resolveOptions: defaults are bounded
ok 2 - resolveOptions: each invalid input is reported with a reason
ok 3 - resolveOptions: the system JAVA_HOME is never used implicitly
ok 4 - gradleUserProperties: no daemon, bounded workers and heap, in-process Kotlin, task-owned tmp, ABI
ok 5 - gradleArgs: no daemon and the task-owned Gradle home on the command line
ok 6 - buildEnv: JDK/SDK/Gradle home/temp are per-process and point at the given paths
ok 7 - classifyProcesses: only processes naming the build root are owned; other builds in the checkout are foreign
ok 8 - classifyProcesses: Windows paths match case-insensitively and with either separator
ok 9 - isInside: whole path segments only, case-folded on Windows
ok 10 - validateBuildRoot: rejects relative, filesystem root, checkout ancestor and checkout child
ok 11 - findCandidates: generated dirs of Gradle projects only, never src/ or non-Gradle dirs
ok 12 - planCleanup + applyCleanup: removes owned generated outputs
ok 13 - planCleanup: a build dir that is a junction into a foreign build root is refused and its target survives
ok 14 - planCleanup: a nested junction leaving the roots refuses the whole directory
ok 15 - applyCleanup: a junction into the build root is removed as a link, its target is kept
ok 16 - planCleanup: a dangling link is refused, not guessed
ok 17 - planCleanup: a candidate that is not git-ignored or holds tracked files is refused
ok 18 - planCleanup: an invalid build root fails before anything is planned
1..18
```

Каманда 3: кантраляванае ўзнаўленне з запісаных журналаў. Пакуль адзін файл выніку `compileKotlin` адкрыты (D1), Gradle не можа выдаліць вынікі і зборка падае; без гэтага (A, C, D2) задача праходзіць.

```powershell
& { Set-Location D:\KUDY-592; Select-String -Path docs\testing\evidence\2026-10-08-g2136\repro-summary.log -Pattern "^STEP" | ForEach-Object { ($_.Line -replace " sec=\d+", "") -replace "in \d+m \d+s", "in <???>" } } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
STEP A1-daemon exit=0 :: BUILD SUCCESSFUL in <???>
STEP A2-daemon-rerun exit=0 :: BUILD SUCCESSFUL in <???>
STEP C1-inprocess exit=0 :: BUILD SUCCESSFUL in <???>
STEP C2-inprocess-rerun exit=0 :: BUILD SUCCESSFUL in <???>
STEP D1-locked exit=1 :: FAILURE: Build failed with an exception. | > java.io.IOException: Unable to delete directory 'D:\KUDY-592\node_modules\expo-dev-launcher\expo-dev-launcher-gradle-plugin\build\classes\kotlin\main' | BUILD FAILED in <???>
STEP D2-released exit=0 :: BUILD SUCCESSFUL in <???>
```

Каманда 4: запісы дзвюх свежых зборак `assembleDebug` (другая з `--rerun-tasks`): код выхаду, памер і SHA-256 APK.

```powershell
& { Set-Location D:\KUDY-592; Get-ChildItem docs\testing\evidence\2026-10-08-g2136\build*-record.json | ForEach-Object { $r = Get-Content $_.FullName -Raw | ConvertFrom-Json; "$($_.Name): exit=$($r.exitCode) apk=$($r.apk.bytes) sha256=$($r.apk.sha256)" } } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
build1-record.json: exit=0 apk=97922851 sha256=184DAACD074EC089B620CFBA4BC4751E5FAD3A2CB77E34D7BBA1FBB2CCE046FA
build2-record.json: exit=0 apk=97922851 sha256=184DAACD074EC089B620CFBA4BC4751E5FAD3A2CB77E34D7BBA1FBB2CCE046FA
```

Каманда 5: вынік сцэнарыяў на эмулятары для APK другой зборкі.

```powershell
& { Set-Location D:\KUDY-592; $r = Get-Content docs\testing\evidence\2026-10-08-g2136\android\results.json -Raw -Encoding UTF8 | ConvertFrom-Json; "checks=$($r.totals.checks) passed=$($r.totals.passed) failed=$($r.totals.failed)"; $r.checks | ForEach-Object { "$($_.status) $($_.name)" } } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
checks=26 passed=26 failed=0
passed Cold launch reaches Explore
passed Catalog has a visible unavailable message
passed Explore tap opens Nearby
passed Nearby Back returns to Explore
passed Explore tap opens Discovery
passed Discovery Back returns to Explore
passed Explore tap opens KUDY
passed English applies without restart and is selected
passed Explore uses English after switch
passed Nearby uses English after switch
passed Android Back returns to Explore
passed Discovery uses English after switch
passed Ukrainian applies without restart and is selected
passed Explore uses Ukrainian after switch
passed Nearby uses Ukrainian after switch
passed Unknown link shows localized explanation
passed Unknown link Back returns to Explore
passed Unavailable guide uses Ukrainian
passed Unavailable run uses Ukrainian
passed Place link shows an unavailable state
passed Collection link shows an unavailable state
passed City guides link shows an unavailable state
passed Large font keeps all language buttons visible
passed Large font grows the language label
passed Large font keeps all Explore links visible
passed Background return preserves KUDY screen and English
```
