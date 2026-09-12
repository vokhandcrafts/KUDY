import { mkdir, writeFile } from 'node:fs/promises';

const sampleRate = 8_000;
const durationSeconds = 0.35;
const tones = [['crane', 440], ['gate', 554], ['fountain', 659]];
await mkdir(new URL('../assets/', import.meta.url), { recursive: true });

for (const [name, frequency] of tones) {
  const samples = sampleRate * durationSeconds;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const envelope = Math.min(1, index / 200, (samples - index) / 200);
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * envelope * 6000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  await writeFile(new URL(`../assets/${name}.wav`, import.meta.url), Buffer.concat([header, data]));
}
