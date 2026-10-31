export const cityMenuAssets = {
  'nearby': { city: require('./pieces/nearby.png'), ui: require('./pieces/nearby--ui.png'), light: require('./pieces/nearby--light.png') },
  'guides': { city: require('./pieces/guides.png'), ui: require('./pieces/guides--ui.png'), light: require('./pieces/guides--light.png') },
  'discovery': { city: require('./pieces/discovery.png'), ui: require('./pieces/discovery--ui.png'), light: require('./pieces/discovery--light.png') },
  'reserve-1': { city: require('./pieces/reserve-1.png'), ui: require('./pieces/reserve-1--ui.png'), light: require('./pieces/reserve-1--light.png') },
  'kudy': { city: require('./pieces/kudy.png'), ui: require('./pieces/kudy--ui.png'), light: require('./pieces/kudy--light.png') },
} as const;
export const citySceneAssets = {
  water: require('./layers/water.png'),
  fortifications: require('./layers/fortifications.png'),
} as const;
