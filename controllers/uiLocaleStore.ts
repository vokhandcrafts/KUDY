// G14.04.d (issue #305) — the UI-locale switch (the L02 selection G06.05
// deferred here; uk-release-scope §4: «Мова прапануецца ў My KUDY і
// запамінаецца»). One small observable store owns the current display
// locale: the My KUDY row writes it, the screens read it per render through
// the composition root — switching re-renders the chrome words in place, no
// restart. The vocabulary is closed (be/en/uk — 09 §8's canon extended by
// the uk package); an unknown value is a named error, never a silent state.
// The walk's own locale stays out of this store's reach by construction: the
// run surface words and the audio ride the session's pinned locale
// (ADR G01.03 §3.4; uk-release-scope §4/L02 — a UI switch never substitutes
// the active walk's language), so the switch cannot change them
// (services.uiLocale holds no session reference).
// Persistence rides an optional port: absent (the app build today — the
// device db adapter is TR-10) the choice lives for the session; when the
// port lands it writes the durable `settings` row (the consent idiom).

export type UiLocaleSwitchCode = 'be' | 'en' | 'uk';

// The store's surface: read the current value, switch it, subscribe to the
// switches (the useSyncExternalStore idiom of the hint mount).
export interface UiLocaleSwitch {
  readonly current: () => UiLocaleSwitchCode;
  readonly set: (locale: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

// The optional durable seam: read the stored choice at composition, write it
// on every switch. Absent until the device db adapter lands.
export interface UiLocalePersistence {
  readonly read: () => UiLocaleSwitchCode | null;
  readonly write: (locale: UiLocaleSwitchCode) => void;
}

export class UiLocaleError extends Error {
  readonly rule: 'ui-locale-unknown';

  constructor(rule: 'ui-locale-unknown', locale: string) {
    super(`ui-locale-unknown: ${locale}`);
    this.name = 'UiLocaleError';
    this.rule = rule;
  }
}

const VOCABULARY: readonly UiLocaleSwitchCode[] = ['be', 'en', 'uk'];

export function createUiLocaleStore(persistence?: UiLocalePersistence): UiLocaleSwitch {
  const stored = persistence?.read() ?? null;
  let current: UiLocaleSwitchCode = stored ?? 'be';
  const listeners = new Set<() => void>();

  return {
    current: () => current,
    set: (locale: string) => {
      if (!VOCABULARY.includes(locale as UiLocaleSwitchCode)) {
        throw new UiLocaleError('ui-locale-unknown', locale);
      }
      const next = locale as UiLocaleSwitchCode;
      if (next === current) return;
      current = next;
      // The write happens before the listeners run: a listener that reads
      // back through current() sees the value that fired the event.
      persistence?.write(next);
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
