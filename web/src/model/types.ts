// All lengths are millimetres. Plan axes: X right, Y up (same as ETABS global).

export type Pt = { x: number; y: number };

export interface Story {
  name: string;
  height: number; // height of this story (from the story below up to this one)
  isMaster: boolean;
  similarTo: string; // '' or name of master story
}

export interface Grid {
  id: string;
  label: string;
  dir: 'X' | 'Y' | 'G'; // X grid = line of constant x; Y grid = constant y; G = general
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bubble: 'start' | 'end' | 'both';
}

export interface Column {
  id: string; // also the GUID written to ETABS
  story: string; // spans from story below to this story
  x: number;
  y: number;
  section: string;
  angle: number; // degrees, local-2 axis from global X
}

export interface Beam {
  id: string;
  story: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  section: string;
}

export interface Slab {
  id: string;
  story: string;
  pts: Pt[];
  section: string;
}

export type FrameShape = 'Rectangle' | 'Circle' | 'Other';

export interface FrameSection {
  name: string;
  shape: FrameShape;
  t3: number; // depth (rect) / diameter (circle)
  t2: number; // width
  material: string;
  fromEtabs: boolean;
}

export interface SlabSection {
  name: string;
  thickness: number;
  material: string;
  fromEtabs: boolean;
}

export interface Material {
  name: string;
  type: string;
}

export interface Model {
  baseElevation: number;
  stories: Story[]; // bottom → top
  grids: Grid[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  frameSections: FrameSection[];
  slabSections: SlabSection[];
  materials: Material[];
  pushedIds: string[]; // ids that exist in ETABS from previous pushes (for delete sync)
  /** inputs the base elevation was computed from (base = foundingDepth - footingThickness + plinthHeight) */
  foundation?: { foundingDepth: number; footingThickness: number; plinthHeight: number };
}

export type ElementKind = 'column' | 'beam' | 'slab' | 'grid';
export type ElRef = { kind: ElementKind; id: string };

export const emptyModel = (): Model => ({
  baseElevation: 0,
  stories: [
    { name: 'Story1', height: 3000, isMaster: true, similarTo: '' },
    { name: 'Story2', height: 3000, isMaster: false, similarTo: 'Story1' },
    { name: 'Story3', height: 3000, isMaster: false, similarTo: 'Story1' },
  ],
  grids: [],
  columns: [],
  beams: [],
  slabs: [],
  frameSections: [
    { name: 'C400x400', shape: 'Rectangle', t3: 400, t2: 400, material: '4000Psi', fromEtabs: false },
    { name: 'B300x500', shape: 'Rectangle', t3: 500, t2: 300, material: '4000Psi', fromEtabs: false },
  ],
  slabSections: [{ name: 'S150', thickness: 150, material: '4000Psi', fromEtabs: false }],
  materials: [{ name: '4000Psi', type: 'Concrete' }],
  pushedIds: [],
});

// Ids double as ETABS GUIDs, so they must be RFC-4122 shaped (randomUUID is missing on plain-http origins).
export const uid = (): string =>
  (crypto as any).randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 3) | 8).toString(16);
      });

export function storyElevations(m: Model): Record<string, { bottom: number; top: number; index: number }> {
  const out: Record<string, { bottom: number; top: number; index: number }> = {};
  let z = m.baseElevation;
  m.stories.forEach((s, i) => {
    out[s.name] = { bottom: z, top: z + s.height, index: i };
    z += s.height;
  });
  return out;
}
