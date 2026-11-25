/**
 * The catch check.
 *
 * All levels are down-positive from the datum (general floor slab structural
 * concrete top). For a slab of sink s and thickness t:
 *
 *     top    = s
 *     soffit = s + t
 *
 * A beam has to meet the slab beside it at BOTH faces, and both are checked for
 * every slab on both sides of the beam, every time — neither one gates the
 * other:
 *
 *     soffit   margin     = beamSoffit - slabSoffit    PASS when margin >= 0
 *
 *     top      topMargin  = slabTop - beamTop          PASS when topMargin >= 0
 *
 * The soffit face alone is not enough. Sinking a beam until it catches a sunken
 * slab on one side routinely drops its top below the flush slab on the other,
 * and that slab then has nothing to bear on — it hangs in the air over a beam
 * that starts below it. Only the top face sees that, so a beam sunk past a slab
 * fails outright rather than being reported as a note beside a pass.
 *
 * The engine only ever sees (topLevel, depth), and the depth always hangs off
 * the beam's own top: sinking a beam moves the whole section down rather than
 * shortening it. A flush beam is topLevel 0 with depth equal to the slab
 * thickness and an upstand cast the whole beam up is a negative topLevel, so
 * one pair of formulae covers every beam and a flush beam failing to catch a
 * sink falls out of the arithmetic rather than needing a special case.
 *
 * A raised nib cast on top of a beam over only part of its length is a
 * different thing from the whole-beam upstand above: it does not change the
 * beam's own topLevel, only the crossing it happens to cover, so `cutSection`
 * folds it in as `RunBeam.upstandDepth` and this file simply subtracts it from
 * `topLevel` before the same formulae run — the soffit is untouched, since the
 * nib adds height above the top, never below it.
 *
 * The other half of the catch check — whether the beam is itself caught over its
 * full depth at its two ends — lives in `bearing.ts` and is folded in here as
 * `endBearing`/`bearingPass`. It is deliberately NOT rolled into `pass`: `pass`
 * is the two-face slab verdict this file computes, and it is what drives the
 * per-face table and the depth arrows on the section, neither of which has
 * anything to say about an end. A beam can fail one and pass the other, and the
 * fix is different in each case, so they are reported side by side.
 */

import { checkBearing, type BeamBearing, type EndBearing } from './bearing';
import { beamSoffitLevel, beamTopLevel } from './grid';
import type { PlanModel, RunBeam, RunItem, RunSlab, SectionRun } from './types';

export type Side = 'left' | 'right';

export interface SideCheck {
  side: Side;
  slabTypeId: string;
  slabLabel: string;
  sink: number;
  thickness: number;
  slabTop: number;
  slabSoffit: number;
  /** beamSoffit - slabSoffit. Negative means the beam misses the slab soffit. */
  margin: number;
  /** How far the beam hangs below this slab's soffit. */
  projection: number;
  /** Overall depth this beam would need for this side's soffit alone. */
  requiredDepth: number;
  /** The soffit face on its own. */
  soffitPass: boolean;
  /** slabTop - beamTop. Negative means the beam is sunk past this slab's top. */
  topMargin: number;
  /** The top face on its own. */
  topPass: boolean;
  /** Both faces. */
  pass: boolean;
}

export interface BeamCheck {
  beamId: string;
  label: string;
  d0: number;
  d1: number;
  topLevel: number;
  soffitLevel: number;
  depth: number;
  sides: SideCheck[];
  /** The slab faces only — see the note at the top of the file. */
  pass: boolean;
  /** This beam's two ends, from `bearing.ts`. Empty if the beam failed to resolve. */
  endBearing: EndBearing[];
  /** Both ends caught over the full depth. Independent of `pass`. */
  bearingPass: boolean;
  /** Deepest `required` across the sides: the level the soffit has to reach. */
  requiredSoffitLevel: number;
  /**
   * Highest slab top beside the beam — the lowest level its own top may sit at
   * and still be under every slab it carries. Null when it has no slab beside it.
   */
  requiredTopLevel: number | null;
  /**
   * Overall depth needed, measured from wherever the top would have to be: a
   * beam sunk past a slab has to come back up first, and the depth then has to
   * reach the deepest soffit from up there.
   */
  requiredDepth: number;
  /** Side governing the soffit face. */
  governingSide: Side | null;
  /** Side whose top the beam clears by the least — the one governing the top face. */
  governingTopSide: Side | null;
  /** Slab-face warnings only, so they read alongside the per-face rows. */
  warnings: string[];
  /** End-bearing warnings, kept apart because they are about a different fault. */
  bearingWarnings: string[];
}

/**
 * Nearest slab on one side of a run item. Columns are stepped over — they sit
 * beside a beam without breaking the beam's relationship to the slab beyond —
 * and so is an upstand nib, which sits at the very same d0/d1 as the beam it
 * rides on rather than beside it. Another beam still ends the search.
 */
function neighbourSlab(items: RunItem[], from: number, step: -1 | 1): RunSlab | null {
  for (let i = from + step; i >= 0 && i < items.length; i += step) {
    const item = items[i]!;
    if (item.kind === 'slab') return item;
    if (item.kind === 'beam') return null;
  }
  return null;
}

export function checkRun(model: PlanModel, run: SectionRun): BeamCheck[] {
  const out: BeamCheck[] = [];
  // Bearing is a property of the beam in plan, not of this cut, so it is
  // computed once for the whole model and looked up per beam the run reaches.
  const bearing = new Map<string, BeamBearing>(
    checkBearing(model).map((entry) => [entry.beamId, entry]),
  );

  run.items.forEach((item, index) => {
    if (item.kind !== 'beam') return;
    // A beam the section runs along is drawn in long section, with no slab on
    // either side of it along the line — there is nothing here to catch, and the
    // slabs it does carry are the ones a cut across it elsewhere would report.
    if (item.longitudinal) return;
    const beam = model.beams.find((b) => b.id === item.beamId);
    if (!beam) return;

    const type = model.beamTypes.find((t) => t.id === beam.typeId);
    // An upstand covering this exact crossing raises the effective top by its
    // depth; the soffit is untouched, since the upstand only adds height above
    // the beam's own top, never below it.
    const topLevel = beamTopLevel(beam) - (item.upstandDepth ?? 0);
    const soffitLevel = beamSoffitLevel(model, beam);
    const warnings: string[] = [];

    const sides: SideCheck[] = [];
    const neighbours: [Side, RunSlab | null][] = [
      ['left', neighbourSlab(run.items, index, -1)],
      ['right', neighbourSlab(run.items, index, 1)],
    ];

    for (const [side, slab] of neighbours) {
      if (!slab) continue;
      const slabType = model.slabTypes.find((s) => s.id === slab.slabTypeId);
      if (!slabType) continue;

      const slabTop = slabType.sink;
      const slabSoffit = slabType.sink + slabType.thickness;
      const margin = soffitLevel - slabSoffit;

      // Depth hangs off the beam's own top, so the depth it needs is the drop
      // from that top down to the level it has to reach — a beam already cast
      // low needs less section to get there.
      const requiredDepth = slabSoffit - topLevel;

      // The top face: the beam has to start at or above the slab top, or the
      // slab has nothing to sit on.
      const topMargin = slabTop - topLevel;
      const topPass = topMargin >= 0;

      if (!topPass) {
        warnings.push(
          `${slabType.label} top (${slabTop}) sits above the beam top (${topLevel}) — ` +
            `the beam is sunk past this slab, so nothing catches it.`,
        );
      }

      sides.push({
        side,
        slabTypeId: slab.slabTypeId,
        slabLabel: slabType.label,
        sink: slabType.sink,
        thickness: slabType.thickness,
        slabTop,
        slabSoffit,
        margin,
        projection: soffitLevel - slabSoffit,
        requiredDepth,
        soffitPass: margin >= 0,
        topMargin,
        topPass,
        pass: margin >= 0 && topPass,
      });
    }

    const governing = sides.reduce<SideCheck | null>(
      (worst, side) => (!worst || side.requiredDepth > worst.requiredDepth ? side : worst),
      null,
    );
    const governingTop = sides.reduce<SideCheck | null>(
      (worst, side) => (!worst || side.topMargin < worst.topMargin ? side : worst),
      null,
    );

    // Both faces feed the one depth answer. Raising a beam that is sunk past a
    // slab lifts its soffit with it, so the depth quoted is what it would take
    // to reach the deepest soffit from the top it has to come back up to —
    // quoting the drop from where it wrongly sits would understate it.
    const requiredSoffitLevel = governing ? governing.slabSoffit : soffitLevel;
    const requiredTopLevel = governingTop ? governingTop.slabTop : null;
    const allowedTop = requiredTopLevel === null ? topLevel : Math.min(topLevel, requiredTopLevel);

    // A beam that never resolved in plan has no ends to judge, so it is left
    // silent rather than reported as uncaught.
    const ends = bearing.get(beam.id);

    out.push({
      beamId: beam.id,
      label: type?.label ?? beam.id,
      d0: item.d0,
      d1: item.d1,
      topLevel,
      soffitLevel,
      depth: soffitLevel - topLevel,
      sides,
      pass: sides.every((s) => s.pass),
      endBearing: ends?.ends ?? [],
      bearingPass: ends ? ends.pass : true,
      requiredSoffitLevel,
      requiredTopLevel,
      requiredDepth: sides.length ? requiredSoffitLevel - allowedTop : 0,
      governingSide: governing?.side ?? null,
      governingTopSide: governingTop?.side ?? null,
      warnings,
      bearingWarnings: ends?.warnings ?? [],
    });
  });

  return out;
}

/** Convenience for the results panel. */
export function summarise(checks: BeamCheck[]): { total: number; failing: number } {
  return { total: checks.length, failing: checks.filter((c) => !c.pass).length };
}

export function isBeamItem(item: RunItem): item is RunBeam {
  return item.kind === 'beam';
}
