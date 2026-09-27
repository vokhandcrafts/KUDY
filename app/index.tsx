import { Redirect } from "expo-router";

// The cold start of the navigation contract opens the catalog —
// screens-and-transitions.md, Explore row: «Уваход: старт дадатка або
// вяртанне»; the screen list is `19` §2.5. Expo Router resolves "/" only
// through an index route, so without this file every cold start landed on
// +not-found (issue #339). No UI of its own — a redirect to the canonical
// entry, not a new screen.
export default function Index() {
  return <Redirect href="/explore" />;
}
