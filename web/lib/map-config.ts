// The single tile-provider config (G10.01.b step 3). The founder's decision
// (2026-09-21, recorded in docs/agent-tasks/results/G10.01.b.md and issue
// #111): OpenFreeMap is the recorded provider — free, keyless, hosted and
// ODbL-attributed. A later comparison with MapTiler is a one-entry switch
// here (MapTiler needs an operator API key, so it stays an optional
// follow-up). External tile/map URLs live only in this file — the guard test
// scans app/, components/ and lib/ and lets no second tile host through.
export interface MapProviderConfig {
  providerName: string;
  styleUrl: string;
  osmCopyrightUrl: string;
}

export const mapProvider: MapProviderConfig = {
  providerName: 'OpenFreeMap',
  styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  osmCopyrightUrl: 'https://www.openstreetmap.org/copyright',
};
