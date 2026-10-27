import type { Pt } from '../model/types';

/**
 * World (mm, y-up) ↔ screen (px, y-down) mapping with view rotation.
 * Mutated directly by pan/zoom handlers; listeners are notified once per animation frame
 * so the React element layers never re-render while panning or zooming.
 */
export class Viewport {
  k = 0.05; // px per mm
  tx = 400;
  ty = 400;
  rot = 0; // degrees, CCW
  private listeners = new Set<() => void>();
  private raf = 0;
  version = 0;

  private get cs() {
    const r = (this.rot * Math.PI) / 180;
    return [Math.cos(r), Math.sin(r)] as const;
  }

  toScreen(p: Pt): Pt {
    const [c, s] = this.cs;
    return { x: this.k * (c * p.x - s * p.y) + this.tx, y: -this.k * (s * p.x + c * p.y) + this.ty };
  }

  toWorld(p: Pt): Pt {
    const [c, s] = this.cs;
    const u = (p.x - this.tx) / this.k,
      v = -(p.y - this.ty) / this.k;
    return { x: u * c + v * s, y: -u * s + v * c };
  }

  /** World → screen as [a, b, c, d, e, f] (SVG / canvas setTransform order). */
  m(): [number, number, number, number, number, number] {
    const [c, s] = this.cs;
    const k = this.k;
    return [k * c, -k * s, -k * s, -k * c, this.tx, this.ty];
  }

  /** SVG matrix() string for the world group. */
  matrix() {
    return `matrix(${this.m().join(' ')})`;
  }

  zoomAt(screen: Pt, factor: number) {
    const w = this.toWorld(screen);
    this.k = Math.min(50, Math.max(1e-4, this.k * factor));
    const s2 = this.toScreen(w);
    this.tx += screen.x - s2.x;
    this.ty += screen.y - s2.y;
    this.changed();
  }

  pan(dx: number, dy: number) {
    this.tx += dx;
    this.ty += dy;
    this.changed();
  }

  setRotation(deg: number, pivotScreen: Pt) {
    const w = this.toWorld(pivotScreen);
    this.rot = deg;
    const s2 = this.toScreen(w);
    this.tx += pivotScreen.x - s2.x;
    this.ty += pivotScreen.y - s2.y;
    this.changed();
  }

  fit(minX: number, minY: number, maxX: number, maxY: number, w: number, h: number, margin = 40) {
    const corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY },
    ];
    // extents in the rotated frame
    const [c, s] = this.cs;
    const us = corners.map((p) => c * p.x - s * p.y),
      vs = corners.map((p) => s * p.x + c * p.y);
    const du = Math.max(...us) - Math.min(...us) || 1000,
      dv = Math.max(...vs) - Math.min(...vs) || 1000;
    this.k = Math.min((w - 2 * margin) / du, (h - 2 * margin) / dv);
    const cu = (Math.max(...us) + Math.min(...us)) / 2,
      cv = (Math.max(...vs) + Math.min(...vs)) / 2;
    this.tx = w / 2 - this.k * cu;
    this.ty = h / 2 + this.k * cv;
    this.changed();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  changed() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.version++;
      this.listeners.forEach((f) => f());
    });
  }
}

export const viewport = new Viewport();

/**
 * SVG transform for text placed at world point (x,y) inside the world group so that it reads upright on screen,
 * rotated by `screenAngle` degrees (CCW on screen).
 */
export function textTransform(x: number, y: number, viewRot: number, screenAngle = 0) {
  const t = (viewRot * Math.PI) / 180;
  const c = Math.cos(t),
    s = Math.sin(t);
  // N = inverse of the group's (unit-scale) linear part = [[c,-s],[-s,-c]] (column-major: a=c,b=-s,c=-s,d=-c)
  const a = (-screenAngle * Math.PI) / 180;
  const ca = Math.cos(a),
    sa = Math.sin(a);
  // R = SVG rotate(a) = [[ca,-sa],[sa,ca]]; result = N * R
  const m11 = c * ca + -s * sa,
    m21 = -s * ca + -c * sa;
  const m12 = c * -sa + -s * ca,
    m22 = -s * -sa + -c * ca;
  return `matrix(${m11} ${m21} ${m12} ${m22} ${x} ${y})`;
}

/** Screen angle (CCW, degrees) of a world direction, folded to keep text readable. */
export function readableAngle(worldDeg: number, viewRot: number) {
  let a = worldDeg + viewRot;
  a = ((a % 360) + 360) % 360;
  if (a > 90 && a <= 270) a -= 180;
  return a;
}
