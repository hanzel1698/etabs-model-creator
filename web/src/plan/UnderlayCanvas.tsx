import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../model/store';
import { useUnderlay, regionFor } from '../underlay/store';
import { viewport } from './viewport';

/**
 * DXF underlay drawn on a canvas behind the SVG plan. One cached Path2D per layer is stroked
 * with the current view transform, at most once per animation frame, so pan/zoom stays smooth
 * even with 100k+ segments.
 */
export function UnderlayCanvas({ w, h }: { w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const u = useUnderlay();
  const story = useApp((s) => s.activeStory);
  const show = useApp((s) => s.show.underlay);

  const paths = useMemo(() => (u.dxf ? u.dxf.layers.map((l) => ({ name: l.name, visible: l.visible, p: new Path2D(l.d) })) : []), [u.dxf]);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d')!;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--underlay').trim() || '#7d8796';

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (!show || u.kind !== 'dxf' || !u.dxf) return;
      const reg = u.setupMode ? null : regionFor(story);
      if (!u.setupMode && u.regions.length && !reg) return;
      const [a, b, c, d, e, f] = viewport.m();
      ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
      ctx.globalAlpha = u.opacity;
      // clips intersect with every earlier one until restored, so each frame's region clip is scoped
      ctx.save();
      if (reg) {
        ctx.translate(-reg.ref.x, -reg.ref.y);
        ctx.beginPath();
        ctx.rect(reg.rect.minX, reg.rect.minY, reg.rect.maxX - reg.rect.minX, reg.rect.maxY - reg.rect.minY);
        ctx.clip();
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / viewport.k; // 1 screen px
      for (const l of paths) if (l.visible) ctx.stroke(l.p);
      ctx.restore();

      if (u.showText) {
        // texts are drawn in screen space so tiny ones can be skipped cheaply
        const inv = new DOMMatrix([a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr]);
        const off = reg ? reg.ref : { x: 0, y: 0 };
        const hidden = new Set(paths.filter((l) => !l.visible).map((l) => l.name));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = color;
        ctx.textBaseline = 'alphabetic';
        const rot = viewport.rot;
        for (const t of u.dxf.texts) {
          const px = t.h * viewport.k * dpr;
          if (px < 3 || hidden.has(t.layer)) continue;
          if (reg && (t.x < reg.rect.minX || t.x > reg.rect.maxX || t.y < reg.rect.minY || t.y > reg.rect.maxY)) continue;
          const s = inv.transformPoint(new DOMPoint(t.x - off.x, t.y - off.y));
          if (s.x < -2000 || s.y < -2000 || s.x > cv.width + 2000 || s.y > cv.height + 2000) continue;
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate((-(t.rot + rot) * Math.PI) / 180);
          ctx.font = `${px}px sans-serif`;
          ctx.fillText(t.text, 0, 0);
          ctx.restore();
        }
      }
    };
    draw();
    return viewport.subscribe(draw);
  }, [w, h, u, paths, story, show]);

  return <canvas ref={ref} className="underlay-canvas" style={{ width: w, height: h }} />;
}
