/**
 * Colour by LEVEL, for the plan.
 *
 * A framing plan is read level by level: a beam sunk 300 and the panel beside
 * it sunk 300 are one pour, and they should look like it. So the colour is keyed
 * to the level of a member's top and nothing else — not to the member kind, and
 * not to the slab type. Two slab types that happen to share a sink deliberately
 * come out the same colour, because on the drawing they are the same thing at
 * the same height.
 *
 * The section is deliberately left out of this. It draws levels directly, as
 * heights on the page with a tag against each one, so a colour key there would
 * repeat what the geometry already says; its tones stay as they are, telling
 * slab from beam from column instead.
 *
 * Colours are assigned by ORDER, not by value: the sinks present in the plan
 * are sorted and take the tints in turn. 0 is pinned to the flush tint whatever
 * else exists, so the general slab never moves. Adding a shallower sink than
 * any already drawn therefore shifts the deeper ones along the palette — the
 * grouping is what carries meaning here, not which particular hue a level got.
 */

import { beamTopLevel } from './grid';
import type { PlanModel } from './types';

export interface LevelColour {
  /** Fill for the member's plan outline. */
  fill: string;
  /** Text that has to stay legible on that fill — the level tag written on it. */
  ink: string;
}

export interface LevelPalette {
  /** The colour for something whose top sits at this level. */
  at(level: number): LevelColour;
  /**
   * Whether the plan casts anything else at this level. Upstands ask before
   * taking a colour: a nib whose top lines up with a slab or a beam top joins
   * that level's colour, and one that lines up with nothing keeps the warm
   * tone that says "raised nib" in both drawings.
   */
  has(level: number): boolean;
}

/** Flush with the datum: near-white, so the general floor reads as the background it is. */
const FLUSH: LevelColour = { fill: '#fbfcfd', ink: '#5b6470' };

/**
 * Sunken levels, shallowest first. Blue leads because it is the tint sunken
 * work carried when there was only ever one sunken level, so a plan with a
 * single sink looks exactly as it did.
 */
const SUNKEN: LevelColour[] = [
  { fill: '#dbe9f6', ink: '#1d5b95' }, // blue
  { fill: '#dcecd9', ink: '#2f6b33' }, // green
  { fill: '#f8e6cd', ink: '#8a5a12' }, // amber
  { fill: '#f2dde9', ink: '#8e3a6b' }, // pink
  { fill: '#e0dff2', ink: '#4b46a0' }, // violet
  { fill: '#f8ddd6', ink: '#a04430' }, // terracotta
  { fill: '#d6ecef', ink: '#1c6470' }, // teal
];

/**
 * Levels above the datum — a beam cast high, its top a negative level. Warm and
 * earthy, matching the tone upstands carry in both drawings, so raised concrete
 * reads apart from the cool tints sunken concrete gets.
 */
const RAISED: LevelColour[] = [
  { fill: '#eee1c0', ink: '#7a5c12' }, // sand
  { fill: '#f0d9c4', ink: '#8a4f22' }, // clay
  { fill: '#e0e4c4', ink: '#5c6b1e' }, // olive
];

/**
 * The plan's colour lookup: level in, colour out.
 *
 * Built from the whole model rather than per member, so the assignment is the
 * same everywhere on the drawing. Slab types contribute their sink whether or
 * not a panel is tagged with them yet, which keeps a panel's colour from
 * changing as other panels are tagged.
 *
 * Upstand tops are deliberately NOT collected here. A nib is not a level of its
 * own — it either lands on one the framing already works to, and takes its
 * colour, or it stands alone and keeps the upstand tone. Collecting them would
 * mint a new colour for every nib and push the sinks along the palette.
 */
export function levelColours(model: PlanModel): LevelPalette {
  const levels = new Set<number>();
  for (const type of model.slabTypes) levels.add(type.sink);
  for (const beam of model.beams) levels.add(beamTopLevel(beam));

  const byLevel = new Map<number, LevelColour>([[0, FLUSH]]);

  // Sunken: shallowest first. Raised: nearest the datum first, so the palette
  // runs outwards from 0 in both directions.
  const sunken = [...levels].filter((l) => l > 0).sort((a, b) => a - b);
  const raised = [...levels].filter((l) => l < 0).sort((a, b) => b - a);

  sunken.forEach((level, i) => byLevel.set(level, SUNKEN[i % SUNKEN.length]!));
  raised.forEach((level, i) => byLevel.set(level, RAISED[i % RAISED.length]!));

  return {
    // A level the model never declared — nothing on the plan should be at one,
    // but a stale render mid-edit must not come out unpainted.
    at: (level) => byLevel.get(level) ?? FLUSH,
    has: (level) => byLevel.has(level),
  };
}
