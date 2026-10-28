import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLauncherIcons } from './with-shape-aware-icons.cjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const names = ['ic_launcher', 'ic_launcher_round', 'ic_launcher_round_foreground'];

test('native prebuild install uses distinct square/round launcher images and foregrounds', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'kudy-launcher-'));
  try {
    const xmlPath = join(scratch, 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml');
    mkdirSync(dirname(xmlPath), { recursive: true });
    const xml = '<adaptive-icon><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>';
    writeFileSync(xmlPath, xml);
    const source = join(scratch, 'assets/kudy-icon/native-android');
    mkdirSync(source, { recursive: true });
    for (const density of densities) {
      for (const name of names) {
        const path = join(root, 'assets/kudy-icon/native-android', `${name}-${density}.webp`);
        const content = readFileSync(path);
        assert.equal(content.toString('ascii', 0, 4), 'RIFF');
        writeFileSync(join(source, `${name}-${density}.webp`), content);
      }
    }
    installLauncherIcons(scratch);
    assert.match(readFileSync(xmlPath, 'utf8'), /@mipmap\/ic_launcher_round_foreground/);
    assert.doesNotMatch(readFileSync(xmlPath, 'utf8'), /@mipmap\/ic_launcher_foreground"/);
    for (const density of densities) {
      for (const name of names) {
        assert.deepEqual(
          readFileSync(join(scratch, 'android/app/src/main/res', `mipmap-${density}`, `${name}.webp`)),
          readFileSync(join(source, `${name}-${density}.webp`)),
        );
      }
    }
    assert.notDeepEqual(
      readFileSync(join(source, 'ic_launcher-xxxhdpi.webp')),
      readFileSync(join(source, 'ic_launcher_round-xxxhdpi.webp')),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
