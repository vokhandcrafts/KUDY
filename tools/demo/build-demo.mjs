// Build the offline demo from the same validated publisher used by catalog E2E.
// The source package is copied into ignored scratch space; test fixtures stay unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBundle } from '../build-bundle/build-bundle.mjs';
import { publishCatalog } from '../publish-catalog/publish-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const work = path.join(root, '.scratch', 'offline-demo');
const source = path.join(work, 'source');
const published = path.join(work, 'published');
const output = path.join(root, 'controllers', 'demoCatalog.generated.ts');

async function update(rel, edit) {
  const file = path.join(source, rel);
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  edit(value);
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

async function filesUnder(dir, prefix = '') {
  const entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await filesUnder(dir, rel));
    else if (entry.isFile()) found.push(rel);
  }
  return found.sort();
}

await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(work, { recursive: true });
await fs.cp(path.join(root, 'fixtures', 'e2e', 'free-guide'), source, { recursive: true });

await update('route.json', (route) => {
  route.city_id = 'gdansk';
  route.distance_m = 400;
  route.duration_min = 10;
  const names = [
    { be: 'Пачатак гісторыі', en: 'The beginning' },
    { be: 'На шляху', en: 'Along the way' },
    { be: 'Апошняя кропка', en: 'The final stop' },
  ];
  const announcements = [
    { be: 'Знаёмства з дэманстрацыйным маршрутам', en: 'Meet the sample walk' },
    { be: 'Другая частка прыкладнай прагулкі', en: 'The second part of the sample walk' },
    { be: 'Завяршэнне дэманстрацыйнага шляху', en: 'The sample walk concludes' },
  ];
  route.stops.forEach((stop, index) => {
    stop.preview = { name: names[index], announce: announcements[index] };
  });
});
await update('places.json', (places) => {
  for (const [index, place] of places.entries()) {
    place.lat = 54.3480 + index * 0.0007;
    place.lng = 18.6530 + index * 0.0006;
  }
});
await update('discovery.json', (doc) => {
  doc.city_id = 'gdansk';
  doc.themes[0].labels = { be: 'Першая прагулка', en: 'First walk' };
  for (const offer of doc.offers) offer.city_id = 'gdansk';
  const guide = doc.offers.find((offer) => offer.ref.kind === 'guide');
  guide.localized.title = { be: 'Тры гісторыі старога горада · дэма', en: 'Three old-town stories · demo' };
  guide.localized.summary = { be: 'Кароткая дэманстрацыйная прагулка з трыма кропкамі, тэкстам і прыкладным аўдыё.', en: 'A short sample walk with three stops, text and sample audio.' };
  guide.localized.why_recommended = { be: 'Паглядзіце, як працуе прагулка; усе гісторыі тут выдуманыя.', en: 'Try the walk flow; every story here is fictional.' };
  guide.localized.conditions = { be: 'Кропкі і адлегласці прыкладныя; не выкарыстоўвайце гэты маршрут для навігацыі.', en: 'Stops and distances are illustrative; do not use this route for navigation.' };
  guide.distance_m = 400;
  guide.estimated_duration = { min_minutes: 10, max_minutes: 15, basis: 'author_estimate' };
  const place = doc.offers.find((offer) => offer.ref.kind === 'place');
  place.localized.title = { be: 'Першая кропка · дэма', en: 'First stop · demo' };
  place.localized.summary = { be: 'Прыклад карткі месца і кароткай гукавой гісторыі.', en: 'An example place card with a short audio story.' };
  place.localized.why_recommended = { be: 'Пачніце тут, каб паглядзець картку месца.', en: 'Start here to see how a place card works.' };
  place.localized.conditions = { be: 'Месца выдуманае; фота і рэжым працы не падаюцца.', en: 'This place is fictional; no photo or opening hours are provided.' };
  const collection = doc.offers.find((offer) => offer.ref.kind === 'collection');
  collection.localized.title = { be: 'Маленькая падборка · дэма', en: 'A small collection · demo' };
  collection.localized.summary = { be: 'Прыклад таго, як месца і гід могуць быць разам.', en: 'An example of a place and guide grouped together.' };
  collection.localized.why_recommended = { be: 'Адна картка паказвае месца і прагулку разам.', en: 'One card groups a place and a walk.' };
  collection.localized.conditions = { be: 'Усе даныя прыкладныя; падборка нічога не адкрывае аўтаматычна.', en: 'All data is illustrative; the collection starts nothing automatically.' };
  collection.estimated_duration = { min_minutes: 10, max_minutes: 20, basis: 'author_estimate' };
  doc.collections[0].city_id = 'gdansk';
  doc.collections[0].localized.title = collection.localized.title;
  doc.collections[0].localized.description = collection.localized.summary;
  doc.collections[0].overlap_note = {
    be: 'Месца з падборкі — першая кропка дэманстрацыйнага гіда.',
    en: 'The place in this collection is the demo guide’s first stop.',
  };
});
await update('voices.json', (voices) => {
  for (const voice of voices) voice.narrator_credit = voice.locale === 'be' ? 'Дэманстрацыйны гукавы тон' : 'Sample audio tone';
});
await update('places/e2e-place-1/public.json', (place) => {
  place.name = { be: 'Першая кропка · дэма', en: 'First stop · demo' };
  place.summary = { be: 'Выдуманае месца для паказу карткі і гукавой гісторыі.', en: 'A fictional place showing the card and audio flow.' };
});
await update('collections/e2e-day/public.json', (collection) => {
  collection.name = { be: 'Маленькая падборка · дэма', en: 'A small collection · demo' };
  collection.description = { be: 'Выдуманыя месца і гід у адной падборцы.', en: 'A fictional place and guide in one collection.' };
});
for (const locale of ['be', 'en']) {
  await update(`${locale}/base/stops.json`, (stories) => {
    for (const [index, story] of stories.entries()) {
      const number = index + 1;
      story.text = locale === 'be'
        ? `Дэманстрацыйная гісторыя ${number}. Гэта прыклад працы прагулкі, а не звесткі пра сапраўднае месца.`
        : `Sample story ${number}. This demonstrates the walk, not a real place or historical account.`;
      story.transcript = story.text;
      story.sources = [locale === 'be' ? 'Дэманстрацыйны кантэнт KUDY' : 'KUDY sample content'];
    }
  });
}

const staging = path.join(work, 'staging');
await buildBundle({ inDir: source, outDir: staging });
await publishCatalog({ staging, target: published, now: '2026-10-15T00:00:00.000Z' });
const paths = await filesUnder(published);
const records = [];
for (const rel of paths) {
  if (rel === 'catalog.previous.json' || rel.startsWith('releases/')) continue;
  const bytes = await fs.readFile(path.join(published, rel));
  records.push(`  ${JSON.stringify(rel)}: ${JSON.stringify(bytes.toString('base64'))},`);
}
const generated = `// Generated by tools/demo/build-demo.mjs. All bytes come from validated published fixtures.\n` +
  `export const demoFiles: Readonly<Record<string, string>> = {\n${records.join('\n')}\n};\n`;
if (process.argv.includes('--check')) {
  const current = await fs.readFile(output, 'utf8').catch(() => '');
  if (current !== generated) throw new Error('demo-catalog-generated-stale');
} else {
  await fs.writeFile(output, generated);
}
console.log(`demo catalog: ${records.length} published files`);
