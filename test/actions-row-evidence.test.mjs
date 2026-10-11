import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { escapeNonAscii, fail } from "../docs/testing/evidence/device-run-lib.mjs";

const evidence = new URL("../docs/testing/evidence/2026-10-11-g219/", import.meta.url);

test("#719: both saved device scales include active actions, pause, and resume", () => {
  for (const scale of [1, 2]) {
    const run = JSON.parse(readFileSync(new URL(`rows-scale${scale}.json`, evidence), "utf8"));
    assert.equal(Number(run.run.device.fontScaleApplied), scale);
    assert.equal(run.run.device.fontScaleRestored, "1.0");
    assert.deepEqual(run.horizontalClipScan, []);
    assert.deepEqual(run.surfaces.map((s) => s.surface), ["city", "preview", "map", "my", "feedback-unavailable", "run"]);
    for (const surface of run.surfaces) {
      assert.deepEqual(surface.essentialMissing, []);
      for (const capture of surface.captures) {
        const png = readFileSync(new URL(`${surface.surface}-${capture.tag}-scale${scale}.png`, evidence));
        assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        assert.deepEqual(capture.clipFindings, []);
      }
    }
    const captures = run.surfaces.find((s) => s.surface === "run").captures;
    for (const word of ["Прыпыніць прагулку", "Завяршыць прагулку"]) {
      assert.ok(captures.find((c) => c.tag === "resumed").visibleTexts.includes(escapeNonAscii(word)));
    }
    assert.ok(captures.find((c) => c.tag === "paused").visibleTexts.includes(escapeNonAscii("Працягнуць")));
  }
});

test("device-run failure unwinds finally so font-scale cleanup can run", () => {
  let restored = false;
  assert.throws(() => {
    try { fail("missing surface"); }
    finally { restored = true; }
  }, /SKIP\/BLOCKED: missing surface/);
  assert.equal(restored, true);
});
