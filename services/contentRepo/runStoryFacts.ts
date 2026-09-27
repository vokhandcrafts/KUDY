// G06.03 (issue #279) — the panel's story facts: the transcript every story
// of one verified layer names (stops.json), read from the same layer
// directory as the run-map facts. The transcript is a card convenience — a
// missing or damaged stops.json never blocks the walk (11 §3: the walk's
// truth is the engine); the card renders its honest unavailable word, and
// the caller decides what the diagnostic means for its surface.
import type { BundlesStore } from './types.ts';

export interface RunStoryFact {
  readonly storyId: string;
  // null = the entry carries no readable transcript — the card shows the
  // honest unavailable word, never invented text.
  readonly transcript: string | null;
}

export type RunStoryFacts =
  | { ok: true; stories: ReadonlyArray<RunStoryFact> }
  | {
      ok: false;
      diagnostic:
        | 'run-story#stops-json-missing'
        | 'run-story#stops-json-unreadable'
        | 'run-story#stops-json-invalid';
    };

export async function readRunStoryFacts(store: BundlesStore, layerDir: string): Promise<RunStoryFacts> {
  const file = await store.readFile(`${layerDir}/stops.json`);
  if (file.kind === 'absent') return { ok: false, diagnostic: 'run-story#stops-json-missing' };
  if (file.kind === 'unreadable') return { ok: false, diagnostic: 'run-story#stops-json-unreadable' };
  let doc: unknown;
  try {
    doc = JSON.parse(new TextDecoder().decode(file.bytes));
  } catch {
    return { ok: false, diagnostic: 'run-story#stops-json-invalid' };
  }
  if (!Array.isArray(doc)) return { ok: false, diagnostic: 'run-story#stops-json-invalid' };
  const stories: RunStoryFact[] = [];
  for (const entry of doc) {
    if (entry === null || typeof entry !== 'object') continue;
    const storyId = (entry as Record<string, unknown>).story_id;
    if (typeof storyId !== 'string' || storyId.length === 0) continue;
    const transcript = (entry as Record<string, unknown>).transcript;
    stories.push({
      storyId,
      transcript: typeof transcript === 'string' && transcript.length > 0 ? transcript : null,
    });
  }
  return { ok: true, stories };
}
