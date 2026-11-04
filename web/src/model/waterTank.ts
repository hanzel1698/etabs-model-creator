/** HDPE tank capacity (L) → largest outer diameter (mm) from manufacturers' ranges. */
export const HDPE_TANKS: [number, number][] = [
  [200, 650], [300, 750], [500, 920], [750, 1030], [1000, 1110], [1500, 1365],
  [2000, 1365], [2500, 1450], [3000, 1500], [5000, 2000], [10000, 2130],
];

const EDGE = 150; // mm clear from a tank to the pad edge
const GAP = 300; // mm clear between tanks
const G = 10; // m/s²

/** HDPE tanks in one row on an RC pad, spread over a slab panel. Lengths in mm, area in m². */
export function hdpeTankLoad(capacity: number, n: number, padT: number, panelArea: number) {
  const dia = HDPE_TANKS.find(([c]) => c === capacity)?.[1] ?? 0;
  const L = 2 * EDGE + n * dia + (n - 1) * GAP;
  const W = 2 * EDGE + dia;
  const padArea = (L / 1000) * (W / 1000);
  const pad = padArea * (padT / 1000) * 25;
  const water = (capacity * n * G) / 1000; // 1 L of water = 1 kg
  const total = pad + water;
  return { dia, L, W, padArea, pad, water, total, unit: panelArea > 0 ? total / panelArea : 0 };
}
