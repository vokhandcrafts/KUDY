// APR-08.b (issue #853): the privacy paragraphs must keep naming the actual
// data flows the APR-08 inventory proved (D03–D08/D12): RevenueCat as a
// separate recipient with the device-UUID buyer id, the KUDY server device
// registration with the one-way IP hash, the server-held ratings, and the
// deletion boundary that does not erase store or RevenueCat records. Reverting
// any of those disclosures from the be source or dropping the RevenueCat
// naming from a shipped translation fails here — a stale-claims guard, not a
// style check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMPLETE_UI_LOCALES } from '../../contracts/ui-locales.ts';
import { loadUiMessagesSource } from '../../contracts/ui-messages/ui-messages.mjs';
import { loadUiMessageTranslations } from '../../contracts/ui-messages/translations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const sourceDoc = loadUiMessagesSource(join(root, 'contracts/ui-messages/source.json'));

function sourceText(id) {
  const record = sourceDoc.records.find((record) => record.id === id);
  assert.ok(record, `source record ${id} exists`);
  return record.source;
}

const PRIVACY_PURCHASES = 'web.ui.privacyPurchases';
const PRIVACY_APP_DATA = 'web.ui.privacyAppData';
const PRIVACY_DELETION = 'web.ui.privacyDeletion';

test('be source names RevenueCat, the device registration, the IP hash and the deletion boundary', () => {
  const purchases = sourceText(PRIVACY_PURCHASES);
  assert.ok(purchases.includes('RevenueCat'), 'privacyPurchases must name RevenueCat');
  assert.ok(purchases.includes('App Store') && purchases.includes('Google Play'), 'privacyPurchases keeps the store names');
  assert.ok(purchases.includes('ідэнтыфікатар прылады'), 'privacyPurchases ties RevenueCat to the device identifier');

  const appData = sourceText(PRIVACY_APP_DATA);
  assert.ok(appData.includes('аднабаковы hash IP-адраса'), 'privacyAppData must disclose the one-way IP hash');
  assert.ok(appData.includes('hash сакрэта'), 'privacyAppData must disclose the server-side secret hash');
  assert.ok(
    appData.includes('перадаецца серверу KUDY з кожным яе запытам як ключ доступа'),
    'privacyAppData must state the bearer mechanism (the secret travels with every request)',
  );
  assert.ok(appData.includes('Ацэнкі маршрутаў і месцаў'), 'privacyAppData must disclose the server-held ratings');
  assert.ok(appData.includes('без вольнага тэксту'), 'ratings disclosure keeps the no-free-text boundary');

  const deletion = sourceText(PRIVACY_DELETION);
  assert.ok(deletion.includes('RevenueCat'), 'privacyDeletion must state the RevenueCat boundary');
  assert.ok(deletion.includes('не выдаляе'), 'privacyDeletion must state what the button does not erase');
});

// Per-locale markers that pin each privacyAppData disclosure sentence
// individually (voka #942 round 2): dropping one sentence must fail the
// guard, so every probe matches only its own sentence. zh entries are written
// as escapes so this source file stays ASCII.
const APPDATA_PROBES = {
  en: {
    ipHash: 'one-way hash of the IP address',
    ratings: 'selected reasons',
    accessKey: 'as the access key',
  },
  uk: {
    ipHash: 'односторонній hash IP-адреси',
    ratings: 'вибрані причини',
    accessKey: 'як ключ доступу',
  },
  cs: {
    ipHash: 'jednosměrný hash IP adresy',
    ratings: 'vybrané důvody',
    accessKey: 'jako přístupový klíč',
  },
  de: {
    ipHash: 'Einweg-Hash der IP-Adresse',
    ratings: 'ausgewählte Gründe',
    accessKey: 'als Zugriffsschlüssel',
  },
  es: {
    ipHash: 'hash unidireccional de la dirección IP',
    ratings: 'los motivos elegidos',
    accessKey: 'como clave de acceso',
  },
  fr: {
    ipHash: 'hachage unidirectionnel',
    ratings: 'les raisons choisies',
    accessKey: "comme clé d'accès",
  },
  sv: {
    ipHash: 'envägs-hash av IP-adressen',
    ratings: 'valda skäl',
    accessKey: 'som åtkomstnyckel',
  },
  zh: {
    ipHash: '\u5355\u5411\u54C8\u5E0C',
    ratings: '\u6240\u9009\u539f\u56e0',
    accessKey: '\u4f5c\u4e3a\u8bbf\u95ee\u5bc6\u94a5',
  },
};

for (const locale of COMPLETE_UI_LOCALES.filter((code) => code !== 'be')) {
  test(`${locale}: shipped privacy paragraphs keep the RevenueCat naming and appData disclosures`, () => {
    const set = loadUiMessageTranslations(
      join(root, `contracts/ui-messages/translations/${locale}.json`),
      sourceDoc,
      COMPLETE_UI_LOCALES,
    );
    for (const id of [PRIVACY_PURCHASES, PRIVACY_DELETION]) {
      const record = set.records.find((record) => record.id === id);
      assert.ok(record, `${locale}: translation record ${id} exists`);
      assert.ok(
        record.value.includes('RevenueCat'),
        `${locale}: ${id} must keep the RevenueCat brand name (brand names stay Latin)`,
      );
    }
    const appData = set.records.find((record) => record.id === PRIVACY_APP_DATA);
    assert.ok(appData, `${locale}: translation record ${PRIVACY_APP_DATA} exists`);
    for (const [disclosure, probe] of Object.entries(APPDATA_PROBES[locale])) {
      assert.ok(
        appData.value.includes(probe),
        `${locale}: ${PRIVACY_APP_DATA} must keep the ${disclosure} disclosure (${probe})`,
      );
    }
  });
}
