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

/** RCC tank whose walls stand on the panel edges: water fills the inside (panel less the wall
 *  thickness all round) to the depth that holds the volume, rounded up to 100 mm.
 *  bw × bh is the panel (or panels') extent in mm, panelArea in m². */
export function rccTankLoad(volumeL: number, wallT: number, bw: number, bh: number, panelArea: number, roof?: TankRoof, parts?: TankPartitions) {
  const iw = Math.max(0, bw - 2 * wallT), ih = Math.max(0, bh - 2 * wallT);
  // partition walls (same thickness) span the inside and take their footprint out of the water
  const n = parts ? Math.max(0, Math.round(parts.n)) : 0;
  const partLen = parts?.along === 'Y' ? ih : iw; // mm, each wall
  const across = parts?.along === 'Y' ? iw : ih; // the inside dimension the walls divide
  const partArea = Math.min(n * wallT, across) / 1000 * (partLen / 1000);
  const innerArea = Math.max(0, (iw / 1000) * (ih / 1000) - partArea);
  const hNeed = innerArea > 0 ? volumeL / 1000 / innerArea : 0; // m
  const h = Math.ceil(hNeed * 10 - 1e-9) / 10;
  const water = innerArea * h * G; // 1 m³ of water = 1000 kg
  // partitions stand on the slab, so their own weight goes into the shell load: water depth + freeboard tall
  const partH = n ? h + (parts!.freeboard / 1000) : 0; // m
  const partWalls = partArea * partH * 25;
  // roof slab over the whole panel extent, beams at their full b × d
  const roofSlab = roof ? (bw / 1000) * (bh / 1000) * (roof.t / 1000) * 25 : 0;
  const beams = roof ? roof.beams.reduce((s, b) => s + (b.b / 1000) * (b.d / 1000) * b.len * 25, 0) : 0;
  const total = water + partWalls + roofSlab + beams;
  return { iw, ih, n, partLen, partArea, partH, partWalls, innerArea, hNeed, h, water, roofSlab, beams, total, unit: panelArea > 0 ? total / panelArea : 0 };
}

/** Intermediate walls splitting the tank into n + 1 compartments; `along` is the axis the walls run on,
 *  freeboard (mm) is the wall height above the water. */
export interface TankPartitions {
  n: number;
  along: 'X' | 'Y';
  freeboard: number;
}

/** Tank roof: slab thickness (mm) and the beams carrying it (b, d in mm, length in m). */
export interface TankRoof {
  t: number;
  beams: { b: number; d: number; len: number }[];
}
