import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, sectionColor, colorKey, visibleModel } from '../model/store';
import { activePattern } from '../ui/LoadDialogs';
import { ColorLegend } from '../plan/layers';
import { fmt } from '../model/geom';
import { elevationAt } from './elevation';

const PAD = 60; // px around the drawing when fitting

/** Elevation along one grid line: levels, crossing grids, and the columns, beams and slabs on that line. */
export function ElevView() {
  const model = useApp((s) => visibleModel(s));
  const grids = useApp((s) => s.model.grids);
  const gridId = useApp((s) => s.elevGrid);
  const selection = useApp((s) => s.selection);
  const colorBy = useApp((s) => s.colorBy);
  const pattern = useApp(activePattern);
  const [tol, setTol] = useState(300);
  const [names, setNames] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ k: 0.05, tx: 0, ty: 0 }); // screen = (k·s + tx, −k·z + ty)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const grid = grids.find((g) => g.id === gridId) ?? grids[0];
  const e = useMemo(() => (grid ? elevationAt(model, grid, tol) : null), [model, grid, tol]);
  const sel = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const extent = () => {
    if (!e || !grid) return null;
    const ss = [0, Math.hypot(grid.x2 - grid.x1, grid.y2 - grid.y1), ...e.grids.map((g) => g.s), ...e.columns.flatMap((c) => [c.s0, c.s1]), ...e.beams.flatMap((b) => [b.s0, b.s1])];
    const zs = [...e.levels, ...e.refPlanes].map((l) => l.z);
    return { s0: Math.min(...ss), s1: Math.max(...ss), z0: Math.min(...zs), z1: Math.max(...zs) };
  };
  const fit = () => {
    const x = extent();
    if (!x) return;
    // room on the left for level names, on the right for reference plane names and on top for grid bubbles
    const left = PAD + 110,
      right = PAD + (e?.refPlanes.length ? 100 : 0),
      top = PAD + 50;
    const k = Math.min((size.w - left - right) / Math.max(x.s1 - x.s0, 1), (size.h - top - PAD) / Math.max(x.z1 - x.z0, 1));
    setView({ k, tx: left + ((size.w - left - right) - k * (x.s1 - x.s0)) / 2 - k * x.s0, ty: top + ((size.h - top - PAD) + k * (x.z1 - x.z0)) / 2 + k * x.z0 });
  };
  // refit when the grid changes or the view is resized
  useEffect(fit, [grid?.id, size.w, size.h]);

  const X = (s: number) => view.k * s + view.tx;
  const Y = (z: number) => -view.k * z + view.ty;

  const pick = (id: string, ev: React.PointerEvent) => {
    if (drag.current?.moved) return;
    const st = useApp.getState();
    st.setSelection(ev.shiftKey ? (st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id]) : [id]);
  };
  const byId = useMemo(() => new Map([...model.columns, ...model.beams, ...model.slabs].map((x) => [x.id, x])), [model]);
  const shown = useMemo(() => (e ? [...e.columns, ...e.beams, ...e.cuts].flatMap((x) => byId.get(x.id) ?? []) : []), [e, byId]);
  const fill = (id: string, def: string) => {
    if (sel.has(id)) return 'var(--sel)';
    const k = colorKey(byId.get(id) ?? { section: '' }, colorBy, pattern);
    return k === null ? def : sectionColor(k);
  };

  const x = extent();
  const sl = x ? X(x.s0) - 30 : 0,
    sr = x ? X(x.s1) + 30 : 0;
  const bubbleY = x ? Y(x.z1) - 34 : 0;

  return (
    <div
      className="elev-view"
      ref={host}
      onWheel={(ev) => {
        const r = host.current!.getBoundingClientRect();
        const px = ev.clientX - r.left,
          py = ev.clientY - r.top;
        const f = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
        setView((v) => ({ k: v.k * f, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f }));
      }}
      onPointerDown={(ev) => {
        if ((ev.target as HTMLElement).closest('.bar')) return;
        drag.current = { x: ev.clientX, y: ev.clientY, moved: false };
      }}
      onPointerMove={(ev) => {
        const d = drag.current;
        if (!d || !ev.buttons) return;
        const dx = ev.clientX - d.x,
          dy = ev.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 3) return;
        d.moved = true;
        d.x = ev.clientX;
        d.y = ev.clientY;
        setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
      }}
      onPointerUp={(ev) => {
        // a click on empty space clears the selection
        if (!drag.current?.moved && ev.target === ev.currentTarget.querySelector('svg')) useApp.getState().setSelection([]);
        setTimeout(() => (drag.current = null));
      }}
    >
      <div className="bar">
        <label title="Grid line to look along">
          Grid{' '}
          <select value={grid?.id ?? ''} onChange={(ev) => useApp.getState().setElevGrid(ev.target.value)}>
            {grids.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label title="Show members whose centreline is within this distance of the grid line">
          Within ±{' '}
          <input type="number" min={0} step={50} value={tol} style={{ width: 64 }} onChange={(ev) => setTol(Math.max(0, +ev.target.value || 0))} /> mm
        </label>
        <button onClick={fit}>Fit</button>
        <button className={names ? 'on' : ''} title="Show section names" onClick={() => setNames(!names)}>
          Names
        </button>
      </div>
      {!grid || !e || !x ? (
        <div className="muted" style={{ padding: '60px 20px' }}>
          No grids yet. Draw grids in the plan, then pick one here to see its elevation.
        </div>
      ) : (
        <svg width={size.w} height={size.h}>
          <g className="nosel">
            {e.levels.map((l) => (
              <g key={l.name}>
                <line x1={sl} x2={sr} y1={Y(l.z)} y2={Y(l.z)} stroke="var(--grid)" strokeDasharray="6 4" />
                <text x={sl - 6} y={Y(l.z)} dy={-3} textAnchor="end" fill="var(--gridText)" fontSize={12}>
                  {l.name}
                </text>
                <text x={sl - 6} y={Y(l.z)} dy={12} textAnchor="end" fill="var(--muted)" fontSize={11}>
                  {l.z >= 0 ? '+' : ''}
                  {fmt(l.z)}
                </text>
              </g>
            ))}
            {e.refPlanes.map((l, i) => (
              <g key={'rp' + i}>
                <line x1={sl} x2={sr} y1={Y(l.z)} y2={Y(l.z)} stroke="var(--accent2)" strokeOpacity={0.7} strokeDasharray="14 4 2 4" />
                <text x={sr + 6} y={Y(l.z)} dy={4} fill="var(--accent2)" fontSize={11}>
                  {l.name} {l.z >= 0 ? '+' : ''}
                  {fmt(l.z)}
                </text>
              </g>
            ))}
            {e.grids.map((g) => (
              <g key={g.id}>
                <line x1={X(g.s)} x2={X(g.s)} y1={bubbleY + 12} y2={Y(x.z0) + 20} stroke="var(--grid)" strokeDasharray="10 4 2 4" />
                <circle cx={X(g.s)} cy={bubbleY} r={12} fill="var(--bg)" stroke="var(--grid)" />
                <text x={X(g.s)} y={bubbleY} dy={4} textAnchor="middle" fill="var(--gridText)" fontSize={12}>
                  {g.label}
                </text>
              </g>
            ))}
            {e.grids.slice(1).map((g, i) => {
              const a = e.grids[i].s,
                y = Y(x.z0) + 34;
              return (
                <g key={'d' + g.id}>
                  <line x1={X(a)} x2={X(g.s)} y1={y} y2={y} stroke="var(--dim)" />
                  <text x={(X(a) + X(g.s)) / 2} y={y} dy={-4} textAnchor="middle" fill="var(--dim)" fontSize={11}>
                    {fmt(g.s - a)}
                  </text>
                </g>
              );
            })}
          </g>
          {e.slabs.map((s, i) => (
            <rect key={s.id + i} x={X(s.s0)} y={Y(s.z)} width={view.k * (s.s1 - s.s0)} height={Math.max(view.k * s.t, 1.5)} fill={sel.has(s.id) ? 'var(--sel)' : 'var(--slabEdge)'} onPointerUp={(ev) => pick(s.id, ev)} style={{ cursor: 'pointer' }} />
          ))}
          {e.beams.map((b) => (
            <rect key={b.id} x={X(b.s0)} y={Y(b.z)} width={view.k * (b.s1 - b.s0)} height={view.k * b.depth} fill={fill(b.id, 'var(--beam)')} fillOpacity={0.75} stroke="var(--colEdge)" onPointerUp={(ev) => pick(b.id, ev)} style={{ cursor: 'pointer' }} />
          ))}
          {e.cuts.map((b) => (
            <rect key={b.id} x={X(b.s0)} y={Y(b.z)} width={view.k * (b.s1 - b.s0)} height={view.k * b.depth} fill={fill(b.id, 'var(--beam)')} fillOpacity={0.9} stroke="var(--text)" strokeDasharray="3 2" onPointerUp={(ev) => pick(b.id, ev)} style={{ cursor: 'pointer' }} />
          ))}
          {e.columns.map((c) => (
            <rect key={c.id} x={X(c.s0)} y={Y(c.z1)} width={view.k * (c.s1 - c.s0)} height={view.k * (c.z1 - c.z0)} fill={fill(c.id, 'var(--col)')} fillOpacity={0.75} stroke="var(--colEdge)" onPointerUp={(ev) => pick(c.id, ev)} style={{ cursor: 'pointer' }} />
          ))}
          {names && (
            <g className="nosel" fontSize={11}>
              {e.beams.map((b) => (
                <text key={b.id} x={X((b.s0 + b.s1) / 2)} y={Y(b.z)} dy={-4} textAnchor="middle" fill="var(--label)" className="halo">
                  {b.section}
                </text>
              ))}
              {e.columns.map((c) => (
                <text key={c.id} transform={`translate(${X(c.s1) + 4} ${Y((c.z0 + c.z1) / 2)}) rotate(-90)`} textAnchor="middle" dy={10} fill="var(--labelCol)" className="halo">
                  {c.section}
                </text>
              ))}
            </g>
          )}
        </svg>
      )}
      <ColorLegend items={shown} colorBy={colorBy} pattern={pattern} />
    </div>
  );
}
