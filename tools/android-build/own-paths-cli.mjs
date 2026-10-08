#!/usr/bin/env node
// G21.36 (#592) [key: build-output-link-escape]: the own-paths.mjs checks for
// writers that are not Node, today emulator-scenarios.ps1. Creates or checks
// the given directories below the build root and checks the given files and
// directory entries, all before the caller writes anything.
//
//   node own-paths-cli.mjs --build-root <dir> --checkout <dir>
//     [--dir <relative dir>]... [--file <relative file>]... [--entries <relative dir>]...
//
// Exit codes: 0 all paths are the build root's own, 73 a path is refused
// (reason on stderr), 64 usage.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { OwnPathError, checkOwnEntries, checkOwnFile, prepareOwnDirs } from './own-paths.mjs';

function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        'build-root': { type: 'string' }, checkout: { type: 'string' },
        dir: { type: 'string', multiple: true }, file: { type: 'string', multiple: true }, entries: { type: 'string', multiple: true },
      },
    }));
  } catch (error) {
    console.error(`own-paths: ${error.message}`);
    return 64;
  }
  const buildRoot = values['build-root'];
  if (!buildRoot || !values.checkout || !path.isAbsolute(buildRoot)) {
    console.error('own-paths: --build-root <absolute dir> and --checkout <dir> are required');
    return 64;
  }
  // A file's directory is checked (and created) like the named directories.
  const fileDirs = (values.file ?? []).map((rel) => path.dirname(rel)).filter((dir) => dir !== '.');
  const dirs = [...(values.dir ?? []), ...(values.entries ?? []), ...fileDirs];
  try {
    prepareOwnDirs(buildRoot, path.resolve(values.checkout), { dirs });
    for (const rel of values.entries ?? []) checkOwnEntries(path.join(buildRoot, rel));
    for (const rel of values.file ?? []) checkOwnFile(path.join(buildRoot, rel));
  } catch (error) {
    if (!(error instanceof OwnPathError)) throw error;
    console.error(`own-paths: refused: ${error.message}`);
    return 73;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
