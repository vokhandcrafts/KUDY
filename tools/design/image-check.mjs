// DQ-11 (issue #921) — the technical half of docs/design-qa/image-checklist.md:
// one repeatable report over a generated image (format, dimensions, alpha
// channel, file size, SHA-256) plus the provenance enforcement the checklist
// relies on. The provenance file (provenance.json next to the image, or
// --provenance) must record the image's checksum and a draft/accepted status
// with a decision link — the script fails when either is missing, so a draft
// can never pass for an accepted asset (design-QA spec §1.3, §5 row
// «Згенераваныя выявы», §6.2).
//
// Anatomy, baked-in text and palette roles stay agent checks (checklist §2);
// this script covers only what is measurable from bytes. Findings are
// diagnostics, never thrown errors (implementation-rules 14): a corrupt PNG,
// a broken JPEG or malformed provenance JSON produce a named finding, not a
// crashed suite.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HEX64 = /^[0-9a-f]{64}$/i;
const STATUSES = new Set(["draft", "accepted"]);

// --- image metadata ---------------------------------------------------------

// PNG chunk walk: dimensions from IHDR, alpha from the color type (4 =
// grayscale+alpha, 6 = RGBA) or a tRNS chunk. Stops at the first IDAT/IEND —
// IHDR precedes them by the PNG grammar, so the walk never touches pixel data.
export function pngMeta(buffer) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(sig)) return null;
  let offset = 8;
  let ihdr = null;
  let trns = false;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (type === "IHDR") {
      if (length < 13 || offset + 12 + 13 > buffer.length) {
        return { error: "png-ihdr-truncated", message: "PNG IHDR chunk is truncated" };
      }
      const colorType = buffer[offset + 17];
      if (![0, 2, 3, 4, 6].includes(colorType)) {
        return { error: "png-color-type", message: `PNG color type ${colorType} is not valid` };
      }
      ihdr = {
        width: buffer.readUInt32BE(offset + 8),
        height: buffer.readUInt32BE(offset + 12),
        colorType,
      };
    } else if (type === "tRNS") {
      trns = true;
    }
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }
  if (!ihdr) return { error: "png-no-ihdr", message: "PNG has no IHDR chunk before the first IDAT" };
  return {
    format: "PNG",
    width: ihdr.width,
    height: ihdr.height,
    alpha: ihdr.colorType === 4 || ihdr.colorType === 6 || trns,
  };
}

// JPEG marker walk: dimensions from the first SOFn frame header. JPEG has no
// alpha channel.
export function jpegMeta(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      return { error: "jpeg-marker", message: `JPEG marker walk lost sync at byte ${offset}` };
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff) { offset += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; } // standalone
    const length = buffer.readUInt16BE(offset + 2);
    const isSOF = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      if (offset + 2 + length > buffer.length || length < 6) {
        return { error: "jpeg-sof-truncated", message: "JPEG frame header is truncated" };
      }
      return {
        format: "JPEG",
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        alpha: false,
      };
    }
    offset += 2 + length;
  }
  return { error: "jpeg-no-sof", message: "JPEG has no frame header before the scan data" };
}

// Meta of one image buffer; `label` names the input in diagnostics.
export function readImageMeta(buffer, label = "image") {
  const meta = pngMeta(buffer) ?? jpegMeta(buffer);
  if (!meta) {
    return { error: "unsupported-format", message: `${label}: not a PNG or JPEG file` };
  }
  if (meta.error) return { ...meta, message: `${label}: ${meta.message}` };
  return meta;
}

// --- provenance -------------------------------------------------------------

// Checks one parsed provenance record against the computed checksum. Rules:
// the record names the image's SHA-256 (the checksum rule), the status is
// exactly draft or accepted (the status rule), and a decision link is present
// in both cases (issue #921: «status draft/accepted with a decision link»).
export function checkProvenance(provenance, { fileName, sha256 }) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    add("provenance-json", "provenance is not a JSON object");
    return findings;
  }
  const files = provenance.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    add("provenance-json", "provenance.files is missing or not an object");
  }
  if (!STATUSES.has(provenance.status)) {
    add("status", `provenance.status is ${JSON.stringify(provenance.status ?? null)}, expected "draft" or "accepted"`);
  }
  if (typeof provenance.decision !== "string" || provenance.decision.trim() === "") {
    add("decision", `provenance.decision must link the owner decision for a ${provenance.status ?? "draft"} image`);
  }
  if (files && typeof files === "object" && !Array.isArray(files)) {
    const recorded = files[fileName];
    if (typeof recorded !== "string") {
      add("checksum", `provenance lacks the checksum for ${fileName}`);
    } else if (!HEX64.test(recorded)) {
      add("checksum", `provenance checksum for ${fileName} is not a SHA-256 hex string`);
    } else if (recorded.toLowerCase() !== sha256.toLowerCase()) {
      add("checksum-mismatch", `provenance checksum for ${fileName} does not match the file bytes (${recorded} ≠ ${sha256})`);
    }
  }
  return findings;
}

// --- one image --------------------------------------------------------------

// Full check of one image file. Returns { image, meta, status, decision,
// provenancePath, bytes, sha256, findings }; findings empty means the image
// passed every byte-level rule.
export function checkImage(imagePath, options = {}) {
  const findings = [];
  const add = (rule, message) => findings.push({ rule, message });
  const provenancePath = options.provenance
    ?? resolve(dirname(imagePath), "provenance.json");

  let buffer;
  try {
    buffer = readFileSync(imagePath);
  } catch (error) {
    add("image", `cannot read the image: ${error.message}`);
    return { image: imagePath, meta: null, status: null, decision: null, provenancePath, bytes: null, sha256: null, findings };
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const bytes = buffer.length;
  const meta = readImageMeta(buffer, basename(imagePath));
  if (meta.error) add("format", meta.message);

  let provenance;
  try {
    provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
  } catch (error) {
    add("provenance-missing", `cannot read the provenance file ${provenancePath}: ${error.message}`);
    return { image: imagePath, meta, status: null, decision: null, provenancePath, bytes, sha256, findings };
  }
  findings.push(...checkProvenance(provenance, { fileName: basename(imagePath), sha256 }));
  return {
    image: imagePath,
    meta,
    status: provenance && typeof provenance === "object" ? provenance.status ?? null : null,
    decision: provenance && typeof provenance === "object" ? provenance.decision ?? null : null,
    provenancePath,
    bytes,
    sha256,
    findings,
  };
}

// --- report -----------------------------------------------------------------

// One human-readable line per image, ready for a design-QA report. A draft is
// spelled out as not accepted; an accepted image shows its decision link.
export function formatReportLine(result) {
  const head = result.findings.length === 0 ? "PASS" : "FAIL";
  if (!result.meta || result.meta.error) {
    const detail = result.findings.map((f) => `[${f.rule}] ${f.message}`).join("; ");
    return `${head} ${result.image}: ${detail || "no metadata"}`;
  }
  const detail = `${result.meta.format} ${result.meta.width}x${result.meta.height}, `
    + `alpha: ${result.meta.alpha ? "yes" : "no"}, ${result.bytes} bytes, sha256 ${result.sha256}`;
  const statusLine = result.findings.length === 0
    ? (result.status === "accepted"
      ? `status: accepted (decision: ${result.decision})`
      : `status: ${result.status} (not accepted — the owner decision link is pending)`)
    : result.findings.map((f) => `[${f.rule}] ${f.message}`).join("; ");
  return `${head} ${result.image}: ${detail}, ${statusLine}`;
}

// --- CLI --------------------------------------------------------------------

function usage() {
  return "usage: node tools/design/image-check.mjs <image...> [--provenance <file>]";
}

export function main(argv, { log = console.log } = {}) {
  const images = [];
  let provenance;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--provenance") {
      provenance = argv[i + 1];
      i += 1;
    } else {
      images.push(argv[i]);
    }
  }
  if (images.length === 0 || (argv.includes("--provenance") && provenance === undefined)) {
    log(usage());
    return 1;
  }
  let failed = false;
  for (const image of images) {
    const result = checkImage(image, { provenance });
    log(formatReportLine(result));
    if (result.findings.length > 0) failed = true;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main(process.argv.slice(2)));
}
