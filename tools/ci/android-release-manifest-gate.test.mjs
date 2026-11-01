// #854: a required CI check must test the generated release manifest, not skip it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const workflowFile = process.env.KUDY_REQUIRED_WORKFLOW_PATH ??
  path.resolve('.github/workflows/required-checks.yml');

function missingReleaseGate(workflow) {
  const normalized = workflow.replace(/\r\n/g, '\n')
    .split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  const lint = normalized.split('\n  lint:')[1]?.split('\n  server-typecheck:')[0] ?? '';
  const required = [
    ['pinned JDK 17', /uses:\s*actions\/setup-java@[a-f0-9]{40}[\s\S]*?java-version:\s*'17'/],
    ['Android prebuild', /npx expo prebuild --platform android --no-install/],
    ['release manifest Gradle task', /gradlew :app:processReleaseMainManifest/],
    ['missing-manifest failure', /test -s "\$manifest"/],
    ['explicit merged manifest test', /KUDY_RELEASE_MANIFEST="\$manifest" node --test test\/android-merged-media-fgs\.test\.mjs/],
  ];
  return required.filter(([, pattern]) => !pattern.test(lint)).map(([name]) => name);
}

test('#854: the required lint job builds and asserts the release manifest', () => {
  const workflow = fs.readFileSync(workflowFile, 'utf8');
  assert.deepEqual(missingReleaseGate(workflow), [],
    'a missing release manifest or an omitted gate must fail required CI');
});

test('#854: reverting any release-manifest CI step breaks the workflow guard', () => {
  const source = `jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3 # v4
        with:
          java-version: '17'
      - name: Android release manifest FGS check
        run: |
          npx expo prebuild --platform android --no-install
          (cd android && ./gradlew :app:processReleaseMainManifest --no-daemon)
          manifest=android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml
          test -s "$manifest"
          KUDY_RELEASE_MANIFEST="$manifest" node --test test/android-merged-media-fgs.test.mjs
  server-typecheck:`;
  assert.deepEqual(missingReleaseGate(source), []);
  for (const marker of ['actions/setup-java@cf277c60eb25467037889841efdb72551f06f6c3',
    'npx expo prebuild --platform android --no-install', 'gradlew :app:processReleaseMainManifest',
    'test -s "$manifest"', 'KUDY_RELEASE_MANIFEST="$manifest" node --test test/android-merged-media-fgs.test.mjs']) {
    assert.notDeepEqual(missingReleaseGate(source.replace(marker, 'REMOVED')), [],
      `dropping ${marker} must fail the guard`);
  }
});
