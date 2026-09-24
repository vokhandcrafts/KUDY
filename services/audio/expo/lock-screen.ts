// G05.03.b — pure mapping from a lock-screen remote command to an explicit
// select-story command over the recommended list.
//
// Canon anchors, copied not paraphrased (implementation-rules 2):
// `09` §6.3 `audio` row — "Prev/next на lock-screen = яўны выбар даступнага
// аўдыё ў рэкамендаваным спісе, locked прапускаецца без змены прагрэсу; гэта
// не загад рухацца, і lock-screen не запускае ручны кантэнт."
//
// Consequences fixed here so the device wiring cannot reinterpret them:
// - The list type carries only guide stories (`storyId`) — a Moment has no
//   address in it, so no lock-screen command can reach manual Moment
//   content; the device side builds the list, this module cannot widen it.
// - Locked entries are skipped in the walk direction; progress is an input
//   this function never receives, so skipping cannot touch it.
// - The result is a select-story command (or null), never a movement or a
//   play of an invented source — the service plays what the controller
//   selects, with its own token and source key (G05.03.a contract).
// - The walk stops at the list boundary; it does not wrap around, so a
//   repeated "next" at the end selects nothing instead of jumping to the
//   head. (No canon line fixes wrap vs stop — stop is the conservative
//   choice, recorded in results/G05.03.b.md.)

export interface RecommendedStory {
  storyId: string;
  locked: boolean;
}

export type LockScreenCommand = 'next' | 'prev';

export type SelectStoryCommand = { type: 'select-story'; storyId: string };

// The recommended list at the moment of the command, in recommendation
// order; `currentStoryId` is the selection the lock screen shows (null when
// nothing is selected). Returns the accessible neighbor in the command
// direction, skipping locked entries, or null when none exists in that
// direction — including: empty list, current not in the list, boundary
// reached, or every remaining entry locked.
export function mapLockScreenCommand(
  command: LockScreenCommand,
  list: readonly RecommendedStory[],
  currentStoryId: string | null,
): SelectStoryCommand | null {
  if (list.length === 0) return null;
  const currentIndex = currentStoryId === null ? -1 : list.findIndex((entry) => entry.storyId === currentStoryId);
  if (currentStoryId !== null && currentIndex === -1) return null;

  // next walks forward from the current selection (or from the list head
  // when nothing is selected); prev walks backward from the current
  // selection and selects nothing when none exists.
  const step = command === 'next' ? 1 : -1;
  if (command === 'prev' && currentIndex === -1) return null;
  let index = currentIndex;
  for (index += step; index >= 0 && index < list.length; index += step) {
    const entry = list[index];
    if (!entry.locked) return { type: 'select-story', storyId: entry.storyId };
  }
  return null;
}
