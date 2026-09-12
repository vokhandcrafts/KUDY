# G00.01.a — reproducible GPS/audio spike

This disposable Expo development-build spike demonstrates the contract with three synthetic stops. It keeps one session-owned location subscription and one replaceable audio player. Coordinates are converted to relative metres in memory; diagnostics show only owner, timestamps, permission state, stop IDs, and player state.

## Pinned intended stack

`package.json` pins Expo 54.0.33, React Native 0.81.5, React 19.1.0, expo-location 19.0.8, and expo-audio 1.1.1. These are an **unverified candidate set in this checkout**: network access was forbidden and the npm cache was empty, so official compatibility metadata and a complete npm lockfile could not be fetched or generated. Do not treat these declarations as a successful install or build.

Before a native build, verify the set against the official [Expo SDK reference](https://docs.expo.dev/versions/latest/), [expo-location](https://docs.expo.dev/versions/latest/sdk/location/), and [expo-audio](https://docs.expo.dev/versions/latest/sdk/audio/) pages, then generate and commit `package-lock.json` with the permitted network policy.

## Commands

The deterministic core and synthetic audio require only the checked Node version:

```sh
node --version
npm --version
npm run generate-audio
npm test
```

Expected here: Node `v22.23.2`, npm `10.9.8`, three 8 kHz mono WAV files, and seven passing tests.

Native install/build/run commands, to run only after official version verification and lockfile generation:

```sh
npm install
npx expo-doctor
npx expo prebuild --clean
npx expo run:android
npx expo start --dev-client
```

For iOS, use macOS with Xcode and a real registered iPhone:

```sh
npx expo run:ios --device
```

Expo Go is not evidence. Use a development build. The app anchors the first accepted position as synthetic stop 1; stops 2 and 3 are 35 m and 70 m east. Start asks for foreground location, Pause and End remove the subscription, and Resume explicitly reacquires it. Manual Play works at any distance.

## Device matrix

Record device model, OS, development-build/runtime versions, permission state, action, expected result, actual result, timestamped local log/video, trigger delay, fix interval, and measurement duration. Never record raw coordinates.

| Scenario | Expected |
|---|---|
| Foreground approach and 6 s dwell | Exactly one stop audio starts; manual Play works regardless of radius. |
| Locked screen / background | Measure audio continuation and fix/trigger delay; do not infer either from configuration. |
| Call or competing audio | No overlap; interruption is not `finished`; no automatic sound after focus returns. |
| Pause / End / explicit Resume | GPS is released on Pause/End; no trigger occurs; only Resume reacquires it. |
| Foreground/background permission denial or revocation | Honest permission state and manual playback remain available. |
| Stale (>15 s) or inaccurate (>40 m) fix | No automatic audio from that fix. |
| Recent-apps removal / force-stop / reboot / battery saver | Record each independently; OS termination must not be described as retry recovery. |
| Rapid Play and replacement | One player only; the newly selected file replaces the old one. |

This checkout has no Android SDK/JDK, ADB device, Xcode/iOS path, installed npm dependencies, or permitted package download. All native matrix cells are therefore `not-run` here.
