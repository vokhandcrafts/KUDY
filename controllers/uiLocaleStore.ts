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

// G21.09 (issue #542, criterion 4): the store's vocabulary derives from the
// one locale registry — the complete catalogues (all eight since G21.14); a
// planned code is not switchable. The unknown-input semantics below are
// unchanged.
// G21.50 (issue #711): switchable means OPEN, not merely complete — the
// open set rides the release flag (the openLocales injection is the tests'
// seam; production derives it from the registry module's OPEN_UI_LOCALES).
import { COMPLETE_UI_LOCALES, OPEN_UI_LOCALES, type CompleteUiLocaleCode } from '../contracts/ui-locales.ts';

export type UiLocaleSwitchCode = CompleteUiLocaleCode;

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
  readonly rule: 'ui-locale-unknown' | 'ui-locale-closed';

  constructor(rule: 'ui-locale-unknown' | 'ui-locale-closed', locale: string) {
    super(`${rule}: ${locale}`);
    this.name = 'UiLocaleError';
    this.rule = rule;
  }
}

export function createUiLocaleStore(
  persistence?: UiLocalePersistence,
  openLocales?: readonly UiLocaleSwitchCode[],
): UiLocaleSwitch {
  const open = openLocales ?? OPEN_UI_LOCALES;
  const stored = persistence?.read() ?? null;
  // G21.50 (issue #711, criterion 3): a stored code that is registered but
  // closed is not the session locale — the session falls back to be, the row
  // is not overwritten and nothing throws; a later read may restore the code
  // once the flag opens it.
  let current: UiLocaleSwitchCode = stored !== null && open.includes(stored) ? stored : 'be';
  const listeners = new Set<() => void>();

  return {
    current: () => current,
    set: (locale: string) => {
      // G21.50: the switch vocabulary is the open set. A code that is
      // registered but closed is a named refusal of its own — it is not
      // `ui-locale-unknown` (the registry knows it) and not a silent state.
      if (!(open as readonly string[]).includes(locale)) {
        throw new UiLocaleError(
          (COMPLETE_UI_LOCALES as readonly string[]).includes(locale) ? 'ui-locale-closed' : 'ui-locale-unknown',
          locale,
        );
      }
      const next = locale as UiLocaleSwitchCode;
      if (next === current) return;
      current = next;
      // The write happens before the listeners run: a listener that reads
      // back through current() sees the value that fired the event.
      // G21.15 (issue #549): the durable write is best-effort — a failed
      // write (a closed db, a full disk) leaves the session choice standing
      // and the listeners firing; the row keeps its last successful value
      // and the next switch catches it up. Symmetric with the seam's read
      // (sessionPorts.ts): a corrupt row reads as no choice, never a throw.
      try {
        persistence?.write(next);
      } catch {
        // the in-memory switch stands; the durable row is not the session's truth
      }
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
