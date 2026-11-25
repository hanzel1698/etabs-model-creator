/**
 * Turns a cut run plus its checks into drawable section geometry.
 *
 * The section is drawn in (d, level) space: d runs along the section line and
 * level is down-positive from the datum, which is also the direction screen y
 * runs, so the mapping to the canvas needs no flip.
 */

import { beamSoffitLevel, beamTopLevel } from './grid';
import type { BeamCheck } from './checks';
import type { PlanModel, SectionRun } from './types';

export interface SectionElement {
  key: string;
  kind: 'slab' | 'beam' | 'column' | 'upstand';
  d0: number;
  d1: number;
  /** Down-positive level of the top face. */
  top: number;
  /** Down-positive level of the soffit. */
  bottom: number;
  label: string;
  sunken: boolean;
  pass: boolean;
  /** d0 is not this element's true edge — a break line belongs there. Columns always break at top/bottom instead. */
  d0Cut?: boolean;
  /** d1 is not this element's true edge — a break line belongs there. Columns always break at top/bottom instead. */
  d1Cut?: boolean;
  /** A beam the section runs along: shown in long section rather than cut across. */
  longitudinal?: boolean;
  /** Set on beam elements, so the drawing can point back at the beam it came from. */
  beamId?: string;
}

export interface SectionGeometry {
  length: number;
  elements: SectionElement[];
  minLevel: number;
  maxLevel: number;
}

/** Fallback range so an empty section still draws a sensible datum line. */
const FALLBACK_RANGE = { min: 0, max: 600 };

/** How far a column pokes past the rest of the section, as a fraction of its height. */
const COLUMN_OVERSHOOT_RATIO = 0.5;
/** Floor on that overshoot (mm) so short sections still get a visible stub. */
const MIN_COLUMN_OVERSHOOT = 120;

export function sectionGeometry(
  model: PlanModel,
  run: SectionRun,
  checks: BeamCheck[],
): SectionGeometry {
  // Slabs and beams first, so columns — placed afterwards — can be drawn
  // behind them and still know the full height to run past.
  const frameElements: SectionElement[] = [];
  /**
   * A beam the section runs along spans the stretch of line the members crossing
   * it also occupy, so it is collected separately and drawn behind them: the
   * concrete is monolithic at those junctions, and what the drawing should show
   * there is the crossing member's own depth, not a break in the long section.
   */
  const longElements: SectionElement[] = [];
  const checkByBeam = new Map(checks.map((c) => [`${c.beamId}:${c.d0}`, c]));

  for (const item of run.items) {
    if (item.kind === 'slab') {
      const slab = model.slabTypes.find((s) => s.id === item.slabTypeId);
      if (!slab) continue;
      frameElements.push({
        key: `s${item.d0}`,
        kind: 'slab',
        d0: item.d0,
        d1: item.d1,
        top: slab.sink,
        bottom: slab.sink + slab.thickness,
        label: slab.label,
        sunken: slab.sink > 0,
        pass: true,
        d0Cut: item.d0Cut,
        d1Cut: item.d1Cut,
      });
    } else if (item.kind === 'beam') {
      const beam = model.beams.find((b) => b.id === item.beamId);
      if (!beam) continue;
      const type = model.beamTypes.find((t) => t.id === beam.typeId);
      const check = checkByBeam.get(`${item.beamId}:${item.d0}`);
      const top = beamTopLevel(beam);
      (item.longitudinal ? longElements : frameElements).push({
        key: `b${item.d0}`,
        kind: 'beam',
        d0: item.d0,
        d1: item.d1,
        top,
        bottom: beamSoffitLevel(model, beam),
        label: type?.label ?? beam.id,
        sunken: top > 0,
        pass: check?.pass ?? true,
        d0Cut: item.d0Cut,
        d1Cut: item.d1Cut,
        longitudinal: item.longitudinal,
        beamId: beam.id,
      });
    } else if (item.kind === 'upstand') {
      const upstand = model.upstands.find((u) => u.id === item.upstandId);
      const beam = model.beams.find((b) => b.id === item.beamId);
      if (!upstand || !beam) continue;
      const upType = model.upstandTypes.find((t) => t.id === upstand.typeId);
      if (!upType) continue;
      const beamTop = beamTopLevel(beam);
      const top = beamTop - upType.depth;
      (item.longitudinal ? longElements : frameElements).push({
        key: `u${item.d0}`,
        kind: 'upstand',
        d0: item.d0,
        d1: item.d1,
        top,
        bottom: beamTop,
        label: upType.label,
        sunken: top > 0,
        pass: true,
        d0Cut: item.d0Cut,
        d1Cut: item.d1Cut,
        longitudinal: item.longitudinal,
        beamId: beam.id,
      });
    }
  }

  // Columns span whatever the rest of the section occupies, so their extent is
  // only known once the slabs and beams have been placed — then a bit more on
  // top and bottom, so a column reads as continuing past the section rather
  // than stopping flush with whatever beam or slab happens to bound it.
  const frameSpans = [...longElements, ...frameElements].flatMap((e) => [e.top, e.bottom]);
  const contentMin = frameSpans.length ? Math.min(...frameSpans) : FALLBACK_RANGE.min;
  const contentMax = frameSpans.length ? Math.max(...frameSpans) : FALLBACK_RANGE.max;
  const overshoot = Math.max((contentMax - contentMin) * COLUMN_OVERSHOOT_RATIO, MIN_COLUMN_OVERSHOOT);

  const columnElements: SectionElement[] = [];
  for (const item of run.items) {
    if (item.kind !== 'column') continue;
    const column = model.columns.find((c) => c.id === item.columnId);
    const type = model.columnTypes.find((t) => t.id === column?.typeId);
    columnElements.push({
      key: `c${item.d0}`,
      kind: 'column',
      d0: item.d0,
      d1: item.d1,
      top: contentMin - overshoot,
      bottom: contentMax + overshoot,
      label: type?.label ?? '',
      sunken: false,
      pass: true,
    });
  }

  // Columns drawn first so beams and slabs, drawn after, paint over them
  // within their own footprint — the column only shows through above, below,
  // or beside whatever else occupies that same stretch of the section. Long
  // sections of beam sit between the two: over the columns they run past, under
  // the beams and slabs that cross them.
  const elements = [...columnElements, ...longElements, ...frameElements];
  const allSpans = elements.flatMap((e) => [e.top, e.bottom]);
  const minLevel = allSpans.length ? Math.min(...allSpans) : FALLBACK_RANGE.min;
  const maxLevel = allSpans.length ? Math.max(...allSpans) : FALLBACK_RANGE.max;

  return { length: run.length, elements, minLevel, maxLevel };
}

/** Distinct sink levels worth tagging on the section. */
export function levelTags(geometry: SectionGeometry): number[] {
  const levels = new Set<number>([0]);
  for (const element of geometry.elements) {
    if (element.kind === 'slab' || ((element.kind === 'beam' || element.kind === 'upstand') && element.sunken))
      levels.add(element.top);
  }
  return [...levels].sort((a, b) => a - b);
}
