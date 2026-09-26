import { Stack } from "expo-router";
import { createContext, useContext, useMemo } from "react";
import { createServices, type ServicePorts, type Services } from "../controllers/createServices";

// Device ports: adapters arrive with their owning tasks (G05.02.c location,
// G05.03.b audio, TR-10 filesystem); until then the app build passes the
// empty port set and the root constructs no services — no fake stands in for
// a device adapter. The catalog origin (G06.01.a) comes from the build
// environment (21 §3.3: only the configured public origin); the index
// integrity pin still needs the device digest adapter (expo-crypto), so the
// catalog service stays unconstructed until that port lands and the surfaces
// show their honest unavailable state.
const devicePorts: ServicePorts = {
  ...(process.env.EXPO_PUBLIC_CATALOG_ORIGIN
    ? { catalogOrigin: process.env.EXPO_PUBLIC_CATALOG_ORIGIN }
    : {}),
};

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

export default function RootLayout() {
  const services = useMemo(() => createServices(devicePorts), []);
  return (
    <ServicesContext.Provider value={services}>
      <Stack />
    </ServicesContext.Provider>
  );
}
