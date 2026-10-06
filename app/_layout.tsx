import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { createServices, type Services } from "../controllers/createServices";
import { useAppFonts } from "../components/fonts";

// The device composition binding is loaded lazily and only when a catalog
// origin is configured: the render tests import the screens that import this
// module, and the Expo facility modules (expo-audio and siblings) cannot
// initialize outside a native runtime. With no origin the root passes the
// empty port set and the surfaces keep their honest unavailable state (V5).
function createDeviceServiceSet(): ReturnType<
  typeof import("../controllers/deviceRoot")["createDeviceServiceSet"]
> | null {
  const origin = process.env.EXPO_PUBLIC_CATALOG_ORIGIN;
  if (!origin) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const deviceRoot = require("../controllers/deviceRoot") as typeof import("../controllers/deviceRoot");
  return deviceRoot.createDeviceServiceSet();
}

// Screens consume services only through this provider (19 §4.2: UI never
// touches services/ directly — controllers only). Exported for the render
// tests, which provide test services through the same context.
export const ServicesContext = createContext<Services | null>(null);

// Screens consume services only through this provider (19 §4.2: UI never
// touches services/ directly — controllers only).
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) {
    throw new Error("useServices must be used under the root layout");
  }
  return services;
}

// G14.04.d (issue #305) — the display locale the words read per render: the
// useSyncExternalStore idiom of the hint mount, over the ui-locale store the
// My KUDY row writes. Subscribing here is what makes the switch restart-free
// — a screen showing uk words re-renders in place when the row fires, the
// services object never rebuilds.
export function useUiLocale(): string {
  const { uiLocale } = useServices();
  return useSyncExternalStore(uiLocale.subscribe, uiLocale.current);
}

export default function RootLayout() {
  // G20.20 (issue #491): the ONE production service set comes from the
  // device composition root (controllers/deviceRoot.ts — the only file that
  // binds the Expo facilities); with no catalog origin configured the root
  // passes the empty port set and the surfaces keep their honest unavailable
  // state — no fake stands in for a device adapter (spec V5).
  const device = useMemo(createDeviceServiceSet, []);
  const services = useMemo(
    () => (device === null ? createServices({}) : createServices(device.ports)),
    [device],
  );
  // The composition's explicit teardown rides the root's unmount (tests,
  // hot reload): the wakelock lease is the one live OS resource it owns.
  useEffect(() => (device === null ? undefined : device.teardown), [device]);
  // G06.10.b: the approved families load once here, ungated — surfaces render
  // their system-ui fallback while loading and never wait for the faces.
  useAppFonts();
  return (
    <ServicesContext.Provider value={services}>
      {/* Issue #428: the clock and status-bar icons must stay readable on
          the light paper everywhere — one dark-content config here at the
          navigation root, no screen sets its own ("dark" resolves to RN's
          dark-content on both platforms). */}
      <StatusBar style="dark" />
      {/* UX 02 (issue #348): the native header is off — it printed raw route
          names as titles and duplicated the screens' own back; every screen
          owns its frame (one BackButton, safe-area padding). */}
      <Stack screenOptions={{ headerShown: false }} />
    </ServicesContext.Provider>
  );
}
