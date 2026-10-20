import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const outputRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sets');

// Original vector sketches. Keep semantic geometry stable across the six
// treatments so a comparison does not confuse shape with meaning.
const icons = {
  city: { title: 'Горад', paths: ['M3 20V9l5-4 5 4v11', 'M13 20V6l4-3 4 3v14', 'M3 20h18', 'M7 11h2', 'M7 15h2', 'M16 9h2', 'M16 13h2'] },
  guides: { title: 'Гіды', paths: ['M12 6c-2.4-1.4-5.2-1.5-9-1v13c3.7-.5 6.6-.3 9 1', 'M12 6c2.4-1.4 5.2-1.5 9-1v13c-3.7-.5-6.6-.3-9 1', 'M12 6v13', 'M5.5 9h4', 'M14.5 9h4'] },
  nearby: { title: 'Побач', paths: ['M12 21c4.2-5.3 6.3-8.8 6.3-11.7a6.3 6.3 0 0 0-12.6 0C5.7 12.2 7.8 15.7 12 21Z', 'M12 12.2a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z'] },
  discover: { title: 'Чым заняцца', paths: ['M12 2.5 14.3 9.7 21.5 12l-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3L12 2.5Z', 'M18.5 3.5v3', 'M17 5h3'] },
  my: { title: 'KUDY', paths: ['M5 3.5h14v17l-7-4-7 4v-17Z', 'M8.5 8h7', 'M8.5 11.5h5'] },
  map: { title: 'Карта', paths: ['M2.5 5.5 9 3l6 2 6.5-2.5v15L15 20l-6-2-6.5 2.5v-15Z', 'M9 3v15', 'M15 5v15', 'M4.5 13.5 7 12'] },
  place: { title: 'Месца', paths: ['M12 21c4-5 6-8.6 6-11.4a6 6 0 0 0-12 0C6 12.4 8 16 12 21Z', 'M9 12.2V9.5l3-2 3 2v2.7', 'M10.5 12.2h3'] },
  route: { title: 'Прагулка', paths: ['M5 17.5c3 0 3-10 8-10s3.3 6 6 6', 'M5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M19 16a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'] },
  clock: { title: 'Працягласць', paths: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3.5 2'] },
  play: { title: 'Граць', paths: ['M7 4.5 19 12 7 19.5V4.5Z'] },
  pause: { title: 'Паўза', paths: ['M7 5h3.5v14H7z', 'M13.5 5H17v14h-3.5z'] },
  download: { title: 'Загрузіць', paths: ['M12 3v11', 'M8 10.5 12 14.5l4-4', 'M4 16.5v3h16v-3'] },
  lock: { title: 'Зачынена', paths: ['M6 10V7a6 6 0 0 1 12 0v3', 'M4.5 10h15v11h-15V10Z', 'M12 14v3'] },
  back: { title: 'Назад', paths: ['M11 4 3 12l8 8', 'M4 12h17'] },
  menu: { title: 'Меню', paths: ['M4 6h16', 'M4 12h12', 'M4 18h16'] },
  close: { title: 'Закрыць', paths: ['M5 5 19 19', 'M19 5 5 19'] },
  transcript: { title: 'Тэкст гісторыі', paths: ['M5 2.5h10l4 4v15H5v-19Z', 'M15 2.5v4h4', 'M8 10h8', 'M8 14h8', 'M8 18h5'] },
  bookmark: { title: 'Захаваць', paths: ['M6 3h12v18l-6-4-6 4V3Z'] },
};

const families = [
  { id: '01-ink', name: 'Чарнільная лінія', stroke: 1.7, cap: 'round', join: 'round', surround: '' },
  { id: '02-carved', name: 'Разьба', stroke: 2.1, cap: 'square', join: 'bevel', surround: '<path d="M3 2.5h4M17 21.5h4" opacity=".5"/>' },
  { id: '03-seal', name: 'Пячатка', stroke: 1.8, cap: 'round', join: 'round', surround: '<circle cx="12" cy="12" r="10.6" stroke-width=".8" opacity=".65"/>', scale: '.76' },
  { id: '04-wayfinder', name: 'Указальнік', stroke: 1.75, cap: 'round', join: 'miter', surround: '<path d="M12 1.4 22.6 12 12 22.6 1.4 12 12 1.4Z" stroke-width=".8" opacity=".62"/>', scale: '.72' },
  { id: '05-tile', name: 'Плітка', stroke: 1.9, cap: 'round', join: 'round', surround: '<rect x="1.7" y="1.7" width="20.6" height="20.6" rx="4" stroke-width=".9" opacity=".7"/>', scale: '.72' },
  { id: '06-thread', name: 'Нітка гісторыі', stroke: 1.65, cap: 'round', join: 'round', surround: '<circle cx="20.5" cy="3.5" r="1" fill="currentColor" stroke="none"/><path d="M3.5 20.5h4" stroke-width=".9" opacity=".65"/>' },
];

function renderIcon(icon, family) {
  const paths = icon.paths.map((d) => `<path d="${d}"/>`).join('');
  const content = family.scale
    ? `<g transform="translate(12 12) scale(${family.scale}) translate(-12 -12)">${paths}</g>`
    : paths;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${family.stroke}" stroke-linecap="${family.cap}" stroke-linejoin="${family.join}" role="img" aria-label="${icon.title}"><title>${icon.title}</title>${family.surround}${content}</svg>\n`;
}

for (const family of families) {
  const dir = path.join(outputRoot, family.id);
  await mkdir(dir, { recursive: true });
  for (const [name, icon] of Object.entries(icons)) {
    await writeFile(path.join(dir, `${name}.svg`), renderIcon(icon, family));
  }
}

console.log(`Generated ${families.length} icon families: ${Object.keys(icons).join(', ')}`);
