// The shared preamble of the evidence device-run drivers (G21.47, #719): the
// adb seam, the skip discipline, the escape idiom and the preconditions both
// drivers assert. One source — the jscpd gate fails a second variant
// (implementation-rules 3: search before adding helpers). Import-only: the
// drivers keep their own flows and execute nothing here.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ADB = join(process.env.ANDROID_HOME ?? `${process.env.HOME}/Android/Sdk`, "platform-tools", "adb");
export const SERIAL = "emulator-5554";
// The Metro port is a parameter: a shared checkout can serve another
// branch on the default 8081, and a driver must fetch ITS OWN bundle.
export const PORT = Number(process.env.KUDY_METRO_PORT ?? 8081);
export const PACKAGE = "by.kudy.app";

export function fail(reason) {
  throw new Error(`SKIP/BLOCKED: ${reason}`);
}

export function adb(...args) {
  return execFileSync(ADB, ["-s", SERIAL, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function screencap() {
  return execFileSync(ADB, ["-s", SERIAL, "exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
}

// Escape-encode anything outside ASCII so committed machine files carry no
// raw non-ASCII bytes (the gitguard idiom of G21.40).
export const escapeNonAscii = (s) =>
  String(s).replace(/[^\x20-\x7E]/g, (c) =>
    [...c].map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, "0")}`).join(""),
  );

// ---- preconditions: adb, booted device, installed package, Metro up ----
export function assertPreconditions({ requireMetro = true } = {}) {
  try {
    execFileSync(ADB, ["devices"], { encoding: "utf8" });
  } catch {
    fail("adb not available (ANDROID_HOME/platform-tools/adb)");
  }
  const devices = execFileSync(ADB, ["devices"], { encoding: "utf8" });
  if (!devices.split("\n").some((l) => l.startsWith(SERIAL) && l.includes("device"))) {
    fail(`no booted ${SERIAL} in adb devices`);
  }
  const packages = adb("shell", "pm", "list", "packages");
  if (!packages.split("\n").includes(`package:${PACKAGE}`)) {
    fail(`${PACKAGE} is not installed on ${SERIAL}`);
  }
  if (requireMetro) {
    let metro = "";
    try {
      metro = execFileSync("curl", ["-s", "--max-time", "5", `http://localhost:${PORT}/status`], { encoding: "utf8" });
    } catch {}
    if (metro.trim() !== "packager-status:running") {
      fail(`Metro is not running on :${PORT} — start it first (expo start --dev-client --port ${PORT})`);
    }
  }
}

export function ensureRuntimeDir(runtime) {
  mkdirSync(runtime, { recursive: true });
}

// A driver's own directory: its artifacts land beside the driver, never
// beside the shared lib it imports.
export function driverPaths(importMetaUrl) {
  const here = dirname(fileURLToPath(importMetaUrl));
  return { here, runtime: join(here, "runtime") };
}

// ---- device facts (rule 9: the environment state as command output) ----
export function deviceProps() {
  return Object.fromEntries(
    ["ro.build.version.release", "ro.build.version.sdk", "ro.product.model", "ro.hardware"].map((p) => [
      p,
      adb("shell", "getprop", p).trim(),
    ]),
  );
}
