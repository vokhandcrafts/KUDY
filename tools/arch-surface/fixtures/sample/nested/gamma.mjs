// Fixture for the tools/arch-surface test (G18.03): nested directory, dynamic
// import, destructured export. Never executed.
export let gammaState = 0;

export class GammaWidget {
  tick() {
    gammaState += 1;
    return import('node:path');
  }
}

export const { gx, gy } = { gx: 1, gy: 2 };
