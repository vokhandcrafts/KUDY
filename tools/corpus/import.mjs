// G19.02 — safe deterministic package import (issue #459).
// One manifest record in, one immutable package out:
//   articles/<article_id>/revisions/<revision_id>/raw.html
//   articles/<article_id>/revisions/<revision_id>/extractions/<extractor_version>/{article.json,text.md}
//   articles/<article_id>/revisions/<revision_id>/images/<asset_id>.<extension>
// article_id = SHA-256 of the canonical UTF-8 JSON array
// [source_namespace, source_record_key] (a shared title never merges two
// records); revision_id = SHA-256 of the untouched HTML bytes; asset_id =
// SHA-256 of the image bytes. A new extractor_version adds a sibling
// extraction directory and never rewrites an earlier one.
//
// Safety (25 §3): every path is confined under the explicitly passed root by
// realpath containment (absolute, `..`, backslash and symlink/junction
// escapes are rejected); size limits are 20 MiB HTML, 50 MiB per image,
// 200 media per record; every diagnostic names its rule and is raised before
// the package is registered. Writes go to a staging directory that is
// renamed into place atomically — an interrupted run leaves the previous
// revision readable, a retry completes exactly one revision, and re-import
// of unchanged data returns already-present instead of duplicating.
// Original-image references are read as inert data by the extraction pass
// and are never fetched or evaluated; an original without a provided local
// file is reported as missing, never downloaded.
//
// v1 decision on an underspecified spot (25 §3–§4): images[] entries in
// article.json exist only for provided media ({ asset_id, source_locator:
// media_key }) — the extractor has no image bytes, so it emits no image
// entries; figure captions are preserved as caption fragments and the
// original stays byte-identical in raw.html. The missing-original list is
// part of the returned report only (the article schema has no field for it
// and site addresses are private data that must not enter Git).

import fs from 'node:fs';
import path from 'node:path';

import { validateDocument, validateInput } from './contracts.mjs';
import { CorpusDiagnostic, extractArticle, renderMarkdown, sha256Hex } from './extract.mjs';

const HTML_BYTES_LIMIT = 20 * 1024 * 1024;
const MEDIA_BYTES_LIMIT = 50 * 1024 * 1024;
const MEDIA_PER_RECORD_LIMIT = 200;
const EXTRACTOR_VERSION_PATTERN = /^[a-z][a-z0-9-]*\/v[0-9]+$/;

// Minimal magic-byte table for the v1 media formats; the extension must
// agree with the bytes or the record is rejected — content is never guessed
// from the name alone.
const MEDIA_FORMATS = [
  { extensions: ['png'], matches: (bytes) => bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 },
  { extensions: ['jpg', 'jpeg'], matches: (bytes) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { extensions: ['gif'], matches: (bytes) => bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 },
  {
    extensions: ['webp'],
    matches: (bytes) =>
      bytes.length > 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50,
  },
  {
    extensions: ['svg'],
    matches: (bytes) => {
      const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 256)).trimStart();
      return head.startsWith('<') || head.startsWith('<?xml');
    },
  },
];

export function articleIdFor(sourceNamespace, sourceRecordKey) {
  return sha256Hex(JSON.stringify([sourceNamespace, sourceRecordKey]));
}

function extensionOf(localPath) {
  const raw = path.extname(localPath).replace(/^\./, '').toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : null;
}

// realpath containment: the resolved real path must stay under the root.
// Absolute spellings, `..` and backslashes are already rejected at the
// manifest boundary (contracts.mjs); this is the filesystem-level half that
// catches symlinks and Windows junctions pointing outside the root.
function resolveConfined(rootReal, relativePath, missingRule, missingMessage) {
  const absolute = path.resolve(rootReal, relativePath);
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    throw new CorpusDiagnostic(missingRule, missingMessage, { path: relativePath });
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new CorpusDiagnostic('path-escapes-root', `${relativePath} resolves outside the input root`, {
      path: relativePath,
    });
  }
  return real;
}

function basenameOfReference(reference) {
  const withoutFragment = reference.split('#')[0].split('?')[0];
  const segment = withoutFragment.slice(withoutFragment.lastIndexOf('/') + 1);
  return segment;
}

function checkMediaFormat(bytes, extension, mediaKey) {
  const format = MEDIA_FORMATS.find((entry) => entry.extensions.includes(extension));
  if (!format) {
    throw new CorpusDiagnostic('media-unknown-format', `media '${mediaKey}' has unsupported extension '.${extension}'`, {
      media_key: mediaKey,
    });
  }
  if (!format.matches(bytes)) {
    throw new CorpusDiagnostic('media-mime-mismatch', `media '${mediaKey}' bytes do not match the declared '.${extension}' format`, {
      media_key: mediaKey,
    });
  }
}

// Full record validation reuses the manifest contract (schema, path safety,
// duplicate keys) by wrapping the record into a one-record manifest — the
// boundary checks stay in their single home (contracts.mjs).
function validateRecord(record, sourceNamespace) {
  const verdict = validateInput({ source_namespace: sourceNamespace, records: [record] });
  if (!verdict.ok) {
    const first = verdict.errors[0];
    throw new CorpusDiagnostic(`record-${first.rule}`, `record rejected by the corpus-input contract: ${first.rule} at ${first.path}`, {
      errors: verdict.errors,
    });
  }
}

export async function importArticle(inputRecord, { inputRoot, libraryRoot, sourceNamespace, extractorVersion, browserFactory }) {
  if (!EXTRACTOR_VERSION_PATTERN.test(extractorVersion)) {
    throw new CorpusDiagnostic('invalid-extractor-version', `extractor version '${extractorVersion}' does not match the profile pattern`);
  }
  if (!browserFactory || typeof browserFactory.open !== 'function') {
    throw new CorpusDiagnostic('browser-factory-missing', 'a browserFactory with open() is required for the DOM pass');
  }
  validateRecord(inputRecord, sourceNamespace);
  const { source_record_key: sourceRecordKey, html_path: htmlPath } = inputRecord;

  const articleId = articleIdFor(sourceNamespace, sourceRecordKey);

  let inputRootReal;
  try {
    inputRootReal = fs.realpathSync(inputRoot);
  } catch {
    throw new CorpusDiagnostic('input-root-missing', `input root ${inputRoot} does not exist`);
  }
  let libraryRootReal;
  try {
    libraryRootReal = fs.realpathSync(libraryRoot);
  } catch {
    throw new CorpusDiagnostic('library-root-missing', `library root ${libraryRoot} does not exist`);
  }

  const htmlReal = resolveConfined(inputRootReal, htmlPath, 'input-file-missing', `html file '${htmlPath}' does not exist under the input root`);
  const htmlBytes = fs.readFileSync(htmlReal);
  if (htmlBytes.byteLength > HTML_BYTES_LIMIT) {
    throw new CorpusDiagnostic('html-too-large', `html of record '${sourceRecordKey}' exceeds the ${HTML_BYTES_LIMIT} byte limit`);
  }
  const revisionId = sha256Hex(htmlBytes);

  const articleDir = path.join(libraryRootReal, 'articles', articleId);
  const revisionDir = path.join(articleDir, 'revisions', revisionId);
  const extractionDir = path.join(revisionDir, 'extractions', extractorVersion);

  // Unchanged data never duplicates: the revision and this extractor version
  // already have their files, so there is nothing to register.
  if (fs.existsSync(extractionDir)) {
    return {
      articleId,
      revisionId,
      extractorVersion,
      alreadyPresent: true,
      document: null,
      media: [],
      missing: [],
      paths: { articleDir, revisionDir, extractionDir },
    };
  }

  // Media validation completes before the first byte is written anywhere:
  // every declared file is read, size- and format-checked and hashed here,
  // so a diagnostic can never leave a half-written package behind.
  const recordMedia = inputRecord.media ?? [];
  if (recordMedia.length > MEDIA_PER_RECORD_LIMIT) {
    throw new CorpusDiagnostic('too-many-media', `record '${sourceRecordKey}' exceeds ${MEDIA_PER_RECORD_LIMIT} media files`);
  }
  const media = [];
  for (const medium of recordMedia) {
    const extension = extensionOf(medium.local_path);
    const mediaReal = resolveConfined(
      inputRootReal,
      medium.local_path,
      'media-file-missing',
      `media '${medium.media_key}' file '${medium.local_path}' does not exist under the input root`
    );
    const bytes = fs.readFileSync(mediaReal);
    if (bytes.byteLength > MEDIA_BYTES_LIMIT) {
      throw new CorpusDiagnostic('media-too-large', `media '${medium.media_key}' exceeds the ${MEDIA_BYTES_LIMIT} byte limit`);
    }
    if (!extension) {
      throw new CorpusDiagnostic('media-unknown-format', `media '${medium.media_key}' has an unusable file extension`, {
        media_key: medium.media_key,
      });
    }
    checkMediaFormat(bytes, extension, medium.media_key);
    media.push({ mediaKey: medium.media_key, extension, assetId: sha256Hex(bytes), realPath: mediaReal });
  }

  const staging = path.join(articleDir, `.staging-${revisionId}`);
  fs.mkdirSync(articleDir, { recursive: true });
  if (fs.existsSync(staging)) {
    if (!fs.statSync(staging).isDirectory()) {
      throw new CorpusDiagnostic('staging-collision', `staging path is not a directory: ${path.basename(staging)}`);
    }
    fs.rmSync(staging, { recursive: true, force: true });
  }
  fs.mkdirSync(staging, { recursive: true });
  const dropStaging = () => fs.rmSync(staging, { recursive: true, force: true });

  try {
    fs.writeFileSync(path.join(staging, 'raw.html'), htmlBytes);
    for (const entry of media) {
      fs.mkdirSync(path.join(staging, 'images'), { recursive: true });
      fs.writeFileSync(path.join(staging, 'images', `${entry.assetId}.${entry.extension}`), fs.readFileSync(entry.realPath));
    }

    // The extraction is the last expensive step; any failure so far has not
    // touched the previous revision, and a failure here only drops staging.
    const { document, imageRefs } = await extractArticle(htmlBytes, {
      articleId,
      revisionId,
      extractorVersion,
      browserFactory,
    });

    // An original is covered when a provided media file shares its file name
    // (the dump preserves names); everything else stays missing, unfetched.
    const providedNames = new Set(recordMedia.map((medium) => basenameOfReference(medium.local_path)));
    const missing = imageRefs
      .filter((ref) => !providedNames.has(basenameOfReference(ref.reference)))
      .map((ref) => ({ reference: ref.reference, locator: ref.locator, reason: 'no-local-file' }));

    const finalDocument = {
      ...document,
      ...(media.length > 0
        ? { images: media.map((entry) => ({ asset_id: entry.assetId, source_locator: entry.mediaKey })) }
        : {}),
    };
    const verdict = validateDocument('article-fragment-v1', finalDocument);
    if (!verdict.ok) {
      throw new CorpusDiagnostic('document-invalid', 'imported document failed the article schema', { errors: verdict.errors });
    }

    const extractionStaging = path.join(staging, 'extractions', extractorVersion);
    fs.mkdirSync(extractionStaging, { recursive: true });
    fs.writeFileSync(path.join(extractionStaging, 'article.json'), `${JSON.stringify(finalDocument, null, 2)}\n`);
    fs.writeFileSync(path.join(extractionStaging, 'text.md'), renderMarkdown(finalDocument));

    if (fs.existsSync(revisionDir)) {
      fs.mkdirSync(path.join(revisionDir, 'extractions'), { recursive: true });
      fs.renameSync(extractionStaging, extractionDir);
      fs.rmSync(staging, { recursive: true, force: true });
    } else {
      fs.mkdirSync(path.join(articleDir, 'revisions'), { recursive: true });
      fs.renameSync(staging, revisionDir);
    }

    return {
      articleId,
      revisionId,
      extractorVersion,
      alreadyPresent: false,
      document: finalDocument,
      media: media.map(({ mediaKey, assetId, extension }) => ({ mediaKey, assetId, extension })),
      missing,
      paths: { articleDir, revisionDir, extractionDir },
    };
  } catch (error) {
    dropStaging();
    throw error;
  }
}
