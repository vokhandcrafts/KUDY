# G21.36 — паўторная debug-зборка Android на Windows

*2026-10-08T13:57:17Z by Showboat 0.6.1*
<!-- showboat-id: a287b140-39f1-4dae-810f-2c84d3649615 -->

G21.36 (issue #592): `tools/android-build/` збірае debug-APK з апублікаванага checkout з уласнай хатняй тэчкай Gradle, без Gradle-дэмана, з Kotlin унутры працэсу зборкі і абмежаванымі воркерамі; чыстка разгортвае junction, правярае карані па рэальных шляхах і не выдаляе нічога па-за checkout і тэчкай зборкі задачы, а таксама падчас іншай зборкі гэтага checkout. Каманды ніжэй выкананыя на Windows-хасце ўладальніка ў клоне `D:\KUDY-592`.

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

Каманда 2: тэсты інструмента. На Windows яны ствараюць сапраўдныя junction: чужы і ўкладзены junction, alias тэчкі зборкі і junction у бацькоўскім шляху мэты адхіляюцца, junction у тэчку зборкі выдаляецца як спасылка, а спыняюцца толькі JVM гэтай тэчкі зборкі. CLI-тэсты запускаюць `build` і `clean --apply` адначасова, правяраюць, што `build` з junction на месцы `gradle-home`, `tmp`, `logs` або `records` (або з жорсткай спасылкай на месцы `gradle.properties`) спыняецца з кодам 73 і не мяняе чужы файл, а блакіроўку мёртвага працэсу абодва адначасовыя выклікі толькі паказваюць (код 75) і не забіраюць; скрыпт эмулятара з junction на месцы `tmp`, `logs`, `evidence` або `evidence\android` (або з жорсткай спасылкай на `results.json` ці журнал) спыняецца з кодам 73 да першага запісу; сцэнарны скрыпт правяраецца праз `powershell -File` з занятым портам, UI-дамп — з падробленым `adb`, у якога `uiautomator dump` падае. Запускі Metro, `adb`, эмулятара і здымка экрана, узятыя з самога скрыпта, ідуць з тэчак з прабелам (checkout, SDK, тэчка зборкі) да заглушак, якія друкуюць атрыманыя аргументы: кожны аргумент даходзіць цэлым. Апошні тэст запускае сапраўдны Gradle 8.14.3 з JDK 17 для тэчкі зборкі з прабелам (`build root`) і з кірыліцай. Адкат любой праверкі робіць адпаведны радок `not ok`.

```powershell
& { Set-Location D:\KUDY-592; $env:KUDY_JDK17 = 'D:\KUDY-Android\java\jdk-17.0.20.1+1'; $env:KUDY_TEST_GRADLE_DIST = 'D:\KUDY-592-build\gradle-home\wrapper\dists\gradle-8.14.3-bin\cv11ve7ro1n3o1j4so8xd9n66\gradle-8.14.3'; node --test --test-reporter=tap tools/android-build/scoped-clean.test.mjs tools/android-build/build-config.test.mjs tools/android-build/cli.test.mjs tools/android-build/emulator-scenarios.test.mjs tools/android-build/gradle-jvmargs.test.mjs tools/android-build/own-paths.test.mjs 2>$null | Select-String -Pattern "^(ok|not ok|1\.\.)" | ForEach-Object { $_.Line } } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
ok 1 - resolveOptions: defaults are bounded
ok 2 - resolveOptions: each invalid input is reported with a reason
ok 3 - resolveOptions: the system JAVA_HOME is never used implicitly
ok 4 - gradleUserProperties: no daemon, bounded workers and heap, in-process Kotlin, task-owned tmp, ABI
ok 5 - gradleUserProperties: a build root with a space or non-ASCII letters stays one quoted tmpdir argument
ok 6 - gradleArgs: no daemon and the task-owned Gradle home on the command line
ok 7 - buildEnv: JDK/SDK/Gradle home/temp are per-process and point at the given paths
ok 8 - classifyProcesses: only processes naming the build root are owned; other builds in the checkout are foreign
ok 9 - classifyProcesses: Windows paths match case-insensitively and with either separator
ok 10 - cli: clean --apply is refused while a build of the same checkout holds the lock, and runs after it
ok 11 - cli: clean --apply is refused while a build JVM of this checkout runs, even without a lock
ok 12 - cli: a build root that aliases the checkout through a junction is refused before any command runs
ok 13 - cli: build refuses a gradle-home that is a junction out of the build root and writes nothing there
ok 14 - cli: build refuses a tmp that is a junction out of the build root and writes nothing there
ok 15 - cli: build refuses a logs that is a junction out of the build root and writes nothing there
ok 16 - cli: build refuses a records that is a junction out of the build root and writes nothing there
ok 17 - cli: build refuses a gradle.properties that is a symlink to a foreign file # SKIP creating a file symlink needs the symlink privilege on this host
ok 18 - cli: build refuses a gradle.properties that is a hard link to a foreign file
ok 19 - cli: two concurrent claimants after a dead owner both refuse the stale lock and leave it untouched
ok 20 - acquireLock: a live holder blocks; a dead holder of this host is reported as stale and kept
ok 21 - emulator-scenarios: a busy Metro port is refused before anything starts, exit code 1
ok 22 - emulator-scenarios: a busy emulator console or adb port is refused
ok 23 - emulator-scenarios: tmp as a junction out of the build root is refused before the first write, exit 73
ok 24 - emulator-scenarios: logs as a junction out of the build root is refused before the first write, exit 73
ok 25 - emulator-scenarios: evidence as a junction out of the build root is refused before the first write, exit 73
ok 26 - emulator-scenarios: evidence\\android as a junction out of the build root is refused before the first write, exit 73
ok 27 - emulator-scenarios: evidence\\android\\results.json as a hard link to a foreign file is refused before the first write
ok 28 - emulator-scenarios: logs\\emulator.out.log as a hard link to a foreign file is refused before the first write
ok 29 - emulator-scenarios: evidence\\android\\results.json as a symlink to a foreign file is refused before the first write # SKIP creating a file symlink needs the symlink privilege on this host
ok 30 - Write-NewFile: replaces a hard-linked name without changing the other name, and refuses a directory
ok 31 - Test-PortOwnedBy: a listener counts as ours only inside the given process tree
ok 32 - Get-ScenarioVerdict: exit 0 only for a complete, all-passed run with an empty crash buffer
ok 33 - Get-UiDump: a failed dump (dump-fails) is retried, never pulled, and throws instead of returning the old screen
ok 34 - Get-UiDump: a failed dump (dump-error-exit-0) is retried, never pulled, and throws instead of returning the old screen
ok 35 - Get-UiDump: after one failed attempt the next dump is pulled from its own device file and cleaned up
ok 36 - emulator-scenarios: Dump and WaitFor throw on a failed dump instead of evaluating the old screen
ok 37 - emulator-scenarios: Metro starts from a checkout path with spaces with every argument intact
ok 38 - emulator-scenarios: the adb and emulator launches, Shot and Adb keep SDK and build-root paths with spaces intact
ok 39 - Test-OwnBuildPaths: a build root and checkout with spaces reach own-paths-cli intact
ok 40 - real Gradle: the generated jvmargs start the build JVM for a build root with a space
ok 41 - own-paths-cli: creates the scenario directories below a fresh build root
ok 42 - own-paths-cli: tmp as a junction out of the build root is refused and the target stays unchanged
ok 43 - own-paths-cli: logs as a junction out of the build root is refused and the target stays unchanged
ok 44 - own-paths-cli: evidence as a junction out of the build root is refused and the target stays unchanged
ok 45 - own-paths-cli: evidence/android as a junction out of the build root is refused and the target stays unchanged
ok 46 - own-paths-cli: evidence/android/results.json as a hard link to a foreign file is refused
ok 47 - own-paths-cli: logs/emulator.out.log as a hard link to a foreign file is refused
ok 48 - own-paths-cli: evidence/android/results.json as a symlink to a foreign file is refused # SKIP creating a file symlink needs the symlink privilege on this host
ok 49 - own-paths-cli: logs/emulator.out.log as a symlink to a foreign file is refused # SKIP creating a file symlink needs the symlink privilege on this host
ok 50 - own-paths-cli: a path leaving the build root by .. and a missing build root are refused
ok 51 - isInside: whole path segments only, case-folded on Windows
ok 52 - validateBuildRoot: rejects relative, filesystem root, checkout ancestor and checkout child
ok 53 - findCandidates: generated dirs of Gradle projects only, never src/ or non-Gradle dirs
ok 54 - planCleanup + applyCleanup: removes owned generated outputs
ok 55 - planCleanup: a build dir that is a junction into a foreign build root is refused and its target survives
ok 56 - planCleanup: a nested junction leaving the roots refuses the whole directory
ok 57 - applyCleanup: a junction into the build root is removed as a link, its target is kept
ok 58 - planCleanup: a dangling link is refused, not guessed
ok 59 - planCleanup: a candidate that is not git-ignored or holds tracked files is refused
ok 60 - planCleanup: an invalid build root fails before anything is planned
ok 61 - resolveRoots: a build root that is a junction to the checkout, its parent, a dir inside it or a drive root is refused
ok 62 - planCleanup: a junction in a candidate parent path is refused even when the build root aliases the foreign dir
1..62
```

Каманда 3: кантраляванае ўзнаўленне з запісаных журналаў. Пакуль адзін файл выніку `compileKotlin` адкрыты (D1), Gradle не можа выдаліць вынікі і зборка падае; без гэтага (A, C, D2) задача праходзіць.

```powershell
& { Set-Location D:\KUDY-592; Select-String -Path docs\testing\evidence\2026-10-08-g2136\repro-summary.log -Pattern "^STEP" | ForEach-Object { ($_.Line -replace " sec=\d+", "") -replace "in \d+m \d+s", "in <time>" } } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
STEP A1-daemon exit=0 :: BUILD SUCCESSFUL in <time>
STEP A2-daemon-rerun exit=0 :: BUILD SUCCESSFUL in <time>
STEP C1-inprocess exit=0 :: BUILD SUCCESSFUL in <time>
STEP C2-inprocess-rerun exit=0 :: BUILD SUCCESSFUL in <time>
STEP D1-locked exit=1 :: FAILURE: Build failed with an exception. | > java.io.IOException: Unable to delete directory 'D:\KUDY-592\node_modules\expo-dev-launcher\expo-dev-launcher-gradle-plugin\build\classes\kotlin\main' | BUILD FAILED in <time>
STEP D2-released exit=0 :: BUILD SUCCESSFUL in <time>
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

Каманда 6: паўторны прагон таго самага APK пасля правак па рэвью PR #689 — скрыпт з праверкай партоў і ўласнасці эмулятара, з кодам выхаду па выніку, з UI-дампам, які пры няўдачы не вяртае стары экран, з праверкай сваіх шляхоў у тэчцы зборкі і з шляхам Expo CLI у двукоссі пры запуску Metro.

```powershell
& { Set-Location D:\KUDY-592; $r = Get-Content docs\testing\evidence\2026-10-08-g2136\android-review\results.json -Raw -Encoding UTF8 | ConvertFrom-Json; "checks=$($r.totals.checks)/$($r.totals.expected) passed=$($r.totals.passed) failed=$($r.totals.failed) crashBufferLines=$($r.crashBufferLines) exitCode=$($r.exitCode) failureReasons=$(@($r.failureReasons).Count)"; Select-String -Path docs\testing\evidence\2026-10-08-g2136\android-review\scenarios.log -Pattern "^(== |EXIT|NOT OK)" | ForEach-Object { $_.Line } } | ForEach-Object { [Console]::Out.Write([string]$_ + [char]10) }
```

```output
checks=26/26 passed=26 failed=0 crashBufferLines=0 exitCode=0 failureReasons=0
== ports
== emulator
== metro
== scenarios
== large font
== background
EXIT 0
```
