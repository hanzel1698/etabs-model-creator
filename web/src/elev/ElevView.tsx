import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, sectionColor, colorKey, visibleModel } from '../model/store';
import { useViewPatterns } from '../ui/LoadDialogs';
import { ColorLegend } from '../plan/layers';
import { fmt } from '../model/geom';
import { elevationAt } from './elevation';
import { addBeams, addColumns } from '../model/ops';
import { placeAt, storyElevations } from '../model/types';
import { commitBeams } from '../plan/tools';

const PAD = 60; // px around the drawing when fitting
const SNAP = 12; // px: how close the cursor must be to a grid crossing to snap to it

/** Elevation along one grid line: levels, crossing grids, and the columns, beams and slabs on that line. */
export function ElevView() {
  const model = useApp((s) => visibleModel(s));
  const grids = useApp((s) => s.model.grids);
  const gridId = useApp((s) => s.elevGrid);
  const selection = useApp((s) => s.selection);
  const colorBy = useApp((s) => s.colorBy);
  const patterns = useViewPatterns();
  const [tol, setTol] = useState(300);
  const [names, setNames] = useState(true);
  const [wire, setWire] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ k: 0.05, tx: 0, ty: 0 }); // screen = (k·s + tx, −k·z + ty)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const tool = useApp((s) => s.tool);
  const drawing = tool === 'column' || tool === 'beam';
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null); // px in the view
  const [start, setStart] = useState<{ s: number; z: number; z0: number; story: string; dz: number } | null>(null); // beam chain's last point

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
  useEffect(() => setStart(null), [tool, grid?.id]);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === 'Escape' && setStart(null);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const X = (s: number) => view.k * s + view.tx;
  const Y = (z: number) => -view.k * z + view.ty;

  const pick = (id: string, ev: React.PointerEvent) => {
    if (drag.current?.moved || drawing) return;
    const st = useApp.getState();
    st.setSelection(ev.ctrlKey ? (st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id]) : [id]);
  };
  const byId = useMemo(() => new Map([...model.columns, ...model.beams, ...model.slabs].map((x) => [x.id, x])), [model]);
  const shown = useMemo(() => (e ? [...e.columns, ...e.beams, ...e.cuts].flatMap((x) => byId.get(x.id) ?? []) : []), [e, byId]);
  const fill = (id: string, def: string) => {
    if (sel.has(id)) return 'var(--sel)';
    const k = colorKey(byId.get(id) ?? { section: '' }, colorBy, patterns);
    return k === null ? def : sectionColor(k);
  };

  // the drawing point under the cursor: station snapped to a grid crossing or the grid's ends; for a beam the
  // nearest story level or reference plane (the chain's once started), for a column the first one above the cursor
  const snap = (() => {
    if (!drawing || !mouse || !e || !grid) return null;
    const s = (mouse.x - view.tx) / view.k,
      z = (view.ty - mouse.y) / view.k;
    const near = [0, Math.hypot(grid.x2 - grid.x1, grid.y2 - grid.y1), ...e.grids.map((g) => g.s)].reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
    const ss = Math.abs(near - s) * view.k < SNAP ? near : Math.round(s);
    const tops = [...e.levels.slice(1), ...e.refPlanes].map((l) => l.z).filter((t) => t > e.levels[0].z); // levels[0] is the base
    const at = (top: number) => {
      const p = placeAt(model, top);
      return p && { s: ss, z: top, z0: storyElevations(model)[p.story].bottom, ...p };
    };
    if (tool === 'beam') return start ? { ...start, s: ss } : tops.length ? at(tops.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a))) : null;
    const above = tops.filter((t) => t >= z);
    return z < e.levels[0].z || !above.length ? null : at(Math.min(...above));
  })();
  const place = () => {
    if (!snap || !grid) return;
    const L = Math.hypot(grid.x2 - grid.x1, grid.y2 - grid.y1) || 1;
    const at = (s: number) => ({ x: grid.x1 + ((grid.x2 - grid.x1) * s) / L, y: grid.y1 + ((grid.y2 - grid.y1) * s) / L });
    const A = useApp.getState();
    if (tool === 'column') return A.commit((m) => addColumns(m, [at(snap.s)], [snap.story], A.active.column, A.columnAngle, snap.dz));
    if (start && Math.abs(snap.s - start.s) > 1) commitBeams((m) => addBeams(m, [[at(start.s), at(snap.s)]], [snap.story], A.active.beam, snap.dz));
    setStart(snap);
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
        const r = host.current!.getBoundingClientRect();
        if (drawing) setMouse({ x: ev.clientX - r.left, y: ev.clientY - r.top });
      }}
      onPointerMove={(ev) => {
        const r = host.current!.getBoundingClientRect();
        if (drawing) setMouse({ x: ev.clientX - r.left, y: ev.clientY - r.top });
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
      onPointerLeave={() => setMouse(null)}
      onContextMenu={(ev) => {
        if (!drawing) return;
        ev.preventDefault();
        setStart(null); // right-click ends the beam chain
      }}
      onPointerUp={(ev) => {
        if (drawing) {
          if (ev.button === 0 && drag.current && !drag.current.moved) place();
          return void setTimeout(() => (drag.current = null));
        }
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
        <button className={wire ? '' : 'on'} title="Show members with their section sizes instead of centrelines" onClick={() => setWire(!wire)}>
          3D view
        </button>
        {drawing && (
          <span className="muted">
            {tool === 'column'
              ? 'Click between two levels to place a column on this grid line (snaps to grid crossings).'
              : 'Click start, then end on a level (chained). Right-click/Esc ends the chain.'}
          </span>
        )}
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
          {wire ? (
            // centrelines as in the 3D wireframe; members sit on their level, cut beams show as points
            <g strokeWidth={2.5} style={{ cursor: 'pointer' }}>
              {e.slabs.map((s, i) => (
                <line key={s.id + i} x1={X(s.s0)} x2={X(s.s1)} y1={Y(s.z)} y2={Y(s.z)} stroke={sel.has(s.id) ? 'var(--sel)' : 'var(--slabEdge)'} strokeWidth={7} strokeOpacity={0.45} onPointerUp={(ev) => pick(s.id, ev)} />
              ))}
              {e.beams.map((b) => (
                <line key={b.id} x1={X(b.s0)} x2={X(b.s1)} y1={Y(b.z)} y2={Y(b.z)} stroke={fill(b.id, 'var(--beam)')} onPointerUp={(ev) => pick(b.id, ev)} />
              ))}
              {e.cuts.map((b) => (
                <circle key={b.id} cx={X((b.s0 + b.s1) / 2)} cy={Y(b.z)} r={4} fill={fill(b.id, 'var(--beam)')} stroke="var(--text)" strokeWidth={1} onPointerUp={(ev) => pick(b.id, ev)} />
              ))}
              {e.columns.map((c) => (
                <line key={c.id} x1={X((c.s0 + c.s1) / 2)} x2={X((c.s0 + c.s1) / 2)} y1={Y(c.z0)} y2={Y(c.z1)} stroke={fill(c.id, 'var(--col)')} onPointerUp={(ev) => pick(c.id, ev)} />
              ))}
            </g>
          ) : (
            <>
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
            </>
          )}
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
          {snap && (
            <g className="nosel" pointerEvents="none" stroke="var(--sel)" strokeWidth={2}>
              {tool === 'column' ? (
                <line x1={X(snap.s)} x2={X(snap.s)} y1={Y(snap.z0)} y2={Y(snap.z)} strokeDasharray="6 4" />
              ) : (
                start && <line x1={X(start.s)} x2={X(snap.s)} y1={Y(start.z)} y2={Y(snap.z)} strokeDasharray="6 4" />
              )}
              <circle cx={X(snap.s)} cy={Y(snap.z)} r={5} fill="none" />
            </g>
          )}
        </svg>
      )}
      <ColorLegend items={shown} colorBy={colorBy} patterns={patterns} />
    </div>
  );
}
