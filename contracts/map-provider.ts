// Shared online map source for the web map and the native Run map. PR #761
// uses this as an interim online style; ADR G00.02 still owns offline delivery.
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
