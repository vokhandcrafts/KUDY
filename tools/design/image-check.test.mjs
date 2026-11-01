// DQ-11 (issue #921) tests: the image-check report and its provenance
// enforcement. The negative cases are the revert guards (implementation-rules
// 1 and the issue Proof): removing the checksum rule or the status rule from
// tools/design/image-check.mjs turns these cases red.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, before, after } from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkImage,
  checkProvenance,
  formatReportLine,
  main,
  readImageMeta,
} from "./image-check.mjs";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE_PNG = fileURLToPath(new URL("../../test/fixtures/image-check/draft-example.png", import.meta.url));
const FIXTURE_SHA = "62d7895fd3c408a13593a41669f3ef5795f8b31d0e142d737e6043300529b098";

let tmp;

before(() => {
  tmp = mkdtempSync(join(tmpdir(), "image-check-"));
});

after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// Copies the committed fixture bytes into the temp dir under a new name so
// per-test provenance files can be written next to them.
function withImage(name) {
  const dir = mkdtempSync(join(tmp, "case-"));
  const imagePath = join(dir, name);
  writeFileSync(imagePath, readFileSync(FIXTURE_PNG));
  return { dir, imagePath };
}

function writeProvenance(dir, provenance) {
  const path = join(dir, "provenance.json");
  writeFileSync(path, typeof provenance === "string" ? provenance : JSON.stringify(provenance));
  return path;
}

const baseProvenance = (overrides = {}) => ({
  status: "draft",
  decision: "DQ-11 draft example (issue #921)",
  rights: "test-only bytes",
  files: { "img.png": FIXTURE_SHA },
  ...overrides,
});

test("image metadata: PNG dimensions and alpha channel", () => {
  const meta = readImageMeta(readFileSync(FIXTURE_PNG), "draft-example.png");
  assert.deepEqual(meta, { format: "PNG", width: 64, height: 64, alpha: true });
});

test("image metadata: JPEG frame header, no alpha", () => {
  // Minimal SOF0 frame header: precision 8, 3 px high, 2 px wide, 1 component.
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0c, 0x08, 0x00, 0x03, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
  assert.deepEqual(readImageMeta(jpeg, "tiny.jpg"), {
    format: "JPEG",
    width: 2,
    height: 3,
    alpha: false,
  });
});

test("image metadata: corrupt input yields a diagnostic, not a throw", () => {
  assert.ok(readImageMeta(Buffer.from("not an image at all"), "junk.bin").error);
  const truncated = readFileSync(FIXTURE_PNG).subarray(0, 10);
  assert.ok(readImageMeta(truncated, "cut.png").error);
});

test("image metadata: an invalid PNG color type yields a diagnostic", () => {
  // sig + IHDR(13) + dummy CRC: color type 5 is not a legal PNG value.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 5;  // color type: invalid
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), Buffer.from("IHDR", "ascii"), ihdr, Buffer.alloc(4),
  ]);
  assert.equal(readImageMeta(png, "bad-type.png").error, "png-color-type");
});

test("the accepted icon package (#429) passes with its committed provenance", () => {
  const result = checkImage(join(REPO, "assets/kudy-icon/icon.png"));
  assert.deepEqual(result.findings, []);
  assert.equal(result.status, "accepted");
  assert.equal(result.meta.format, "PNG");
  assert.ok(result.meta.width > 0 && result.meta.height > 0);
  const provenance = JSON.parse(readFileSync(result.provenancePath, "utf8"));
  assert.equal(result.sha256, provenance.files["icon.png"]);
});

test("the remaining accepted exports match the recorded checksums", () => {
  for (const name of [
    "android-adaptive-foreground.png",
    "android-adaptive-background.png",
    "android-adaptive-square-foreground.png",
  ]) {
    const result = checkImage(join(REPO, "assets/kudy-icon", name));
    assert.deepEqual(result.findings, [], name);
    assert.equal(result.status, "accepted", name);
  }
});

test("a draft is reported as draft, never as accepted", () => {
  const result = checkImage(FIXTURE_PNG);
  assert.deepEqual(result.findings, []);
  assert.equal(result.status, "draft");
  const line = formatReportLine(result);
  assert.ok(line.includes("status: draft (not accepted"), line);
  assert.ok(!line.includes("status: accepted"), line);
});

test("the accepted report line shows the decision link, not a draft note", () => {
  const result = checkImage(join(REPO, "assets/kudy-icon/icon.png"));
  const line = formatReportLine(result);
  assert.ok(line.includes("status: accepted"), line);
  assert.ok(line.includes("issues/429"), line);
});

test("the checksum rule: a provenance without the image checksum fails", () => {
  const { dir, imagePath } = withImage("img.png");
  writeProvenance(dir, { ...baseProvenance(), files: {} });
  const rules = checkImage(imagePath).findings.map((f) => f.rule);
  assert.ok(rules.includes("checksum"), rules.join(", "));
});

test("the status rule: an unknown status fails", () => {
  const { dir, imagePath } = withImage("img.png");
  writeProvenance(dir, baseProvenance({ status: "approved" }));
  const rules = checkImage(imagePath).findings.map((f) => f.rule);
  assert.ok(rules.includes("status"), rules.join(", "));
});

test("the decision rule: an accepted image without a decision link fails", () => {
  const { dir, imagePath } = withImage("img.png");
  writeProvenance(dir, baseProvenance({ status: "accepted", decision: "  " }));
  const rules = checkImage(imagePath).findings.map((f) => f.rule);
  assert.ok(rules.includes("decision"), rules.join(", "));
});

test("a mismatched checksum fails", () => {
  const { dir, imagePath } = withImage("img.png");
  const wrong = "0".repeat(64);
  writeProvenance(dir, baseProvenance({ files: { "img.png": wrong } }));
  const findings = checkImage(imagePath).findings;
  assert.ok(findings.some((f) => f.rule === "checksum-mismatch" && f.message.includes(wrong)));
});

test("corrupt provenance JSON is a diagnostic, not a crash", () => {
  const { dir, imagePath } = withImage("img.png");
  writeProvenance(dir, "{ not json");
  const rules = checkImage(imagePath).findings.map((f) => f.rule);
  assert.ok(rules.includes("provenance-missing"), rules.join(", "));
});

test("a malformed provenance object answers with diagnostics", () => {
  assert.deepEqual(
    checkProvenance(null, { fileName: "img.png", sha256: FIXTURE_SHA })[0].rule,
    "provenance-json",
  );
  assert.deepEqual(
    checkProvenance({ status: "draft", files: ["img.png"] }, { fileName: "img.png", sha256: FIXTURE_SHA })
      .map((f) => f.rule),
    ["provenance-json", "decision"],
  );
});

test("an unreadable image or missing provenance answers with diagnostics", () => {
  const result = checkImage(join(tmp, "does-not-exist.png"));
  assert.deepEqual(result.findings.map((f) => f.rule), ["image"]);
  assert.equal(result.decision, null);
  assert.equal(result.bytes, null);
  assert.equal(result.sha256, null);
  const { dir, imagePath } = withImage("img.png");
  const result2 = checkImage(imagePath, { provenance: join(dir, "absent.json") });
  assert.deepEqual(result2.findings.map((f) => f.rule), ["provenance-missing"]);
  assert.equal(result2.decision, null);
  assert.equal(result2.bytes, readFileSync(FIXTURE_PNG).length);
});

test("main() without arguments prints usage and fails", () => {
  const lines = [];
  assert.equal(main([], { log: (l) => lines.push(l) }), 1);
  assert.match(lines[0], /^usage:/);
});

test("the CLI passes on the committed draft fixture and fails on a broken provenance", () => {
  const script = fileURLToPath(new URL("./image-check.mjs", import.meta.url));
  const passing = spawnSync(process.execPath, [script, "test/fixtures/image-check/draft-example.png"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(passing.status, 0, passing.stdout + passing.stderr);
  assert.match(passing.stdout, /status: draft \(not accepted/);

  const { dir, imagePath } = withImage("img.png");
  writeProvenance(dir, baseProvenance({ status: "accepted", files: {} }));
  const failing = spawnSync(process.execPath, [script, imagePath], { encoding: "utf8" });
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /\[checksum\]/);

  const usage = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: REPO });
  assert.equal(usage.status, 1);
  assert.match(usage.stdout, /^usage:/);
});
