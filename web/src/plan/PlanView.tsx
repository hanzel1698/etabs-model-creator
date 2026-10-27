import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp, usePreview } from '../model/store';
import type { Pt } from '../model/types';
import { viewport } from './viewport';
import { UnderlayLayer, GridLayer, SlabLayer, BeamLayer, ColumnLayer, LabelLayer } from './layers';
import { onMove, onClick, onCancel, finishPolygon, hitTest, boxSelect, fillIntersections, doSnap } from './tools';
import { columnOutline } from './snap';
import { useUnderlay } from '../underlay/store';
import { UnderlayCanvas } from './UnderlayCanvas';

export function fitAll(w?: number, h?: number) {
  const el = document.getElementById('plan-host');
  const W = w ?? el?.clientWidth ?? 800,
    H = h ?? el?.clientHeight ?? 600;
  const m = useApp.getState().model;
  const xs: number[] = [],
    ys: number[] = [];
  m.grids.forEach((g) => (xs.push(g.x1, g.x2), ys.push(g.y1, g.y2)));
  m.columns.forEach((c) => (xs.push(c.x), ys.push(c.y)));
  m.beams.forEach((b) => (xs.push(b.x1, b.x2), ys.push(b.y1, b.y2)));
  if (!xs.length) {
    const u = useUnderlay.getState();
    if (u.kind === 'dxf' && u.dxf) {
      const story = useApp.getState().activeStory;
      const reg = u.setupMode ? null : u.regions.find((r) => r.stories.includes(story));
      const b = reg ? { minX: reg.rect.minX - reg.ref.x, minY: reg.rect.minY - reg.ref.y, maxX: reg.rect.maxX - reg.ref.x, maxY: reg.rect.maxY - reg.ref.y } : u.dxf.fitBox;
      return viewport.fit(b.minX, b.minY, b.maxX, b.maxY, W, H);
    }
    return viewport.fit(-2000, -2000, 30000, 20000, W, H);
  }
  viewport.fit(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), W, H);
}

const useVp = () => useSyncExternalStore((f) => viewport.subscribe(f), () => viewport.version);

export function PlanView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const model = useApp((s) => s.model);
  const story = useApp((s) => s.activeStory);
  const selection = useApp((s) => s.selection);
  const show = useApp((s) => s.show);
  const viewRot = useApp((s) => s.viewRotation);
  const tool = useApp((s) => s.tool);
  const ts = useApp((s) => s.textScale);
  const bubble = useApp((s) => s.gridBubble);
  const colorBy = useApp((s) => s.colorBySection);

  // keep the world transform in sync without re-rendering React
  useEffect(() => {
    const apply = () => worldRef.current?.setAttribute('transform', viewport.matrix());
    apply();
    return viewport.subscribe(apply);
  }, []);

  useEffect(() => {
    const el = hostRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    requestAnimationFrame(() => fitAll(el.clientWidth, el.clientHeight));
    return () => ro.disconnect();
  }, []);

  // view rotation pivots around the screen centre
  useEffect(() => {
    if (viewport.rot !== viewRot) viewport.setRotation(viewRot, { x: size.w / 2, y: size.h / 2 });
  }, [viewRot]);

  const sel = useMemo(() => new Set(selection), [selection]);
  const secs = useMemo(() => new Map(model.frameSections.map((s) => [s.name, s])), [model.frameSections]);
  const below = useMemo(() => {
    const i = model.stories.findIndex((s) => s.name === story);
    return i > 0 ? model.stories[i - 1].name : null;
  }, [model.stories, story]);

  const cols = useMemo(() => model.columns.filter((c) => c.story === story), [model.columns, story]);
  const beams = useMemo(() => model.beams.filter((b) => b.story === story), [model.beams, story]);
  const slabs = useMemo(() => model.slabs.filter((s) => s.story === story), [model.slabs, story]);
  const gCols = useMemo(() => (below && show.ghostBelow ? model.columns.filter((c) => c.story === below) : []), [model.columns, below, show.ghostBelow]);
  const gBeams = useMemo(() => (below && show.ghostBelow ? model.beams.filter((b) => b.story === below) : []), [model.beams, below, show.ghostBelow]);
  const empty = useMemo(() => new Set<string>(), []);

  // ---------- input ----------
  const drag = useRef<{ mode: 'pan' | 'box' | 'none'; start: Pt; last: Pt; button: number } | null>(null);
  const space = useRef(false);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        space.current = true;
        e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => e.code === 'Space' && (space.current = false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  useEffect(() => {
    const el = hostRef.current!;
    // smooth zoom: accumulate wheel deltas and apply once per frame
    let acc = 0,
      at: Pt = { x: 0, y: 0 },
      raf = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      at = { x: e.clientX - r.left, y: e.clientY - r.top };
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      acc += e.deltaY * unit * (e.ctrlKey ? 2.5 : 1);
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          viewport.zoomAt(at, Math.exp(-acc * 0.0018));
          acc = 0;
        });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const local = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent) => {
    const p = local(e);
    (document.activeElement as HTMLElement | null)?.blur?.();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      drag.current = { mode: 'pan', start: p, last: p, button: e.button };
      return;
    }
    if (e.button === 2) return;
    if (e.button === 0) drag.current = { mode: 'none', start: p, last: p, button: 0 };
  };

  const move = (e: React.PointerEvent) => {
    const p = local(e);
    const d = drag.current;
    if (d?.mode === 'pan') {
      viewport.pan(p.x - d.last.x, p.y - d.last.y);
      d.last = p;
      return;
    }
    if (d && d.button === 0) {
      const t = useApp.getState().tool;
      if ((t === 'select' || t === 'column') && Math.hypot(p.x - d.start.x, p.y - d.start.y) > 5) d.mode = 'box';
      if (d.mode === 'box') {
        d.last = p;
        usePreview.getState().set({ box: { a: viewport.toWorld(d.start), b: viewport.toWorld(p) }, cursor: viewport.toWorld(p) });
        return;
      }
    }
    onMove(p);
  };

  const up = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === 'pan') return;
    const p = local(e);
    const st = useApp.getState();
    if (d.mode === 'box') {
      usePreview.getState().set({ box: null });
      if (st.tool === 'column') return fillIntersections(d.start, p);
      let ids = boxSelect(st.model, d.start, p, st.activeStory, p.x < d.start.x);
      const nonGrid = ids.filter((id) => !st.model.grids.some((g) => g.id === id));
      if (nonGrid.length) ids = nonGrid;
      st.setSelection(e.shiftKey ? [...new Set([...st.selection, ...ids])] : ids);
      return;
    }
    if (st.tool === 'select') {
      const id = hitTest(st.model, p, st.activeStory);
      if (e.shiftKey && id) st.setSelection(st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id]);
      else st.setSelection(id ? [id] : []);
      return;
    }
    const s = doSnap(p);
    onClick(s.p);
    onMove(p);
  };

  const ctx = (e: React.MouseEvent) => {
    e.preventDefault();
    const t = useApp.getState().tool;
    if (t === 'slabDraw' || t === 'area') finishPolygon();
    else onCancel();
  };

  const dblClick = () => {
    const t = useApp.getState().tool;
    if (t === 'slabDraw' || t === 'area') finishPolygon();
  };

  const cursor = tool === 'select' ? 'default' : 'crosshair';

  return (
    <div id="plan-host" ref={hostRef} className="plan-host" style={{ cursor }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onContextMenu={ctx} onDoubleClick={dblClick} onPointerLeave={() => usePreview.getState().set({ cursor: null, snap: null })}>
      <UnderlayCanvas w={size.w} h={size.h} />
      <svg width={size.w} height={size.h} className="plan-svg">
        <g ref={worldRef}>
          {show.underlay && <UnderlayLayer story={story} viewRot={viewRot} />}
          {show.slabs && <SlabLayer slabs={slabs} sel={sel} />}
          <GridLayer grids={model.grids} sel={sel} viewRot={viewRot} showLabels={show.gridLabels} bubble={bubble} />
          {gBeams.length > 0 && <BeamLayer beams={gBeams} sel={empty} ghost colorBy={false} />}
          {gCols.length > 0 && <ColumnLayer cols={gCols} secs={secs} sel={empty} ghost colorBy={false} />}
          <BeamLayer beams={beams} sel={sel} colorBy={colorBy} />
          <ColumnLayer cols={cols} secs={secs} sel={sel} colorBy={colorBy} />
          {show.sectionLabels && <LabelLayer m={model} story={story} viewRot={viewRot} ts={ts} showSlabs={show.slabs} />}
        </g>
        <Overlay />
      </svg>
      <Compass rot={viewRot} />
    </div>
  );
}

// ---------- screen-space overlay (snap markers, rubber band, measurements) ----------

function Overlay() {
  useVp();
  const pv = usePreview();
  const tool = useApp((s) => s.tool);
  const model = useApp((s) => s.model);
  const active = useApp((s) => s.active);
  const angle = useApp((s) => s.columnAngle);
  const S = (p: Pt) => viewport.toScreen(p);
  const items: JSX.Element[] = [];

  if (pv.box) {
    const a = S(pv.box.a),
      b = S(pv.box.b);
    const crossing = tool === 'select' && b.x < a.x;
    items.push(
      <rect key="box" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={crossing ? 'rgba(80,220,120,.08)' : 'rgba(80,160,255,.08)'} stroke={crossing ? '#50dc78' : '#4aa3ff'} strokeDasharray={crossing ? '5 4' : undefined} />,
    );
  }
  const cur = pv.snap?.p ?? pv.cursor;
  if (pv.rubber.length && cur && tool !== 'region') {
    const pts = [...pv.rubber, cur].map(S);
    const closing = (tool === 'slabDraw' || tool === 'area') && pv.rubber.length >= 2;
    items.push(<polyline key="rub" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={closing ? 'rgba(255,200,80,.08)' : 'none'} stroke="#ffc850" strokeWidth={1.5} strokeDasharray="6 3" />);
    if (closing) items.push(<line key="close" x1={pts[pts.length - 1].x} y1={pts[pts.length - 1].y} x2={pts[0].x} y2={pts[0].y} stroke="#ffc850" strokeOpacity={0.4} strokeDasharray="3 3" />);
  }
  if (pv.measure) {
    const pts = pv.measure.pts.map(S);
    items.push(<polyline key="ms" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ff7ad9" strokeWidth={1.5} />);
    pts.forEach((p, i) => items.push(<circle key={'mp' + i} cx={p.x} cy={p.y} r={3} fill="#ff7ad9" />));
  }
  if (pv.offsetLine) {
    const [a, b] = pv.offsetLine.map(S);
    items.push(<line key="off" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffc850" strokeWidth={2} strokeDasharray="8 4" />);
  }
  if (tool === 'column' && cur && !pv.box) {
    const sec = model.frameSections.find((s) => s.name === active.column);
    const ol = columnOutline({ x: cur.x, y: cur.y, angle, section: active.column }, sec).map(S);
    items.push(<polygon key="cpv" points={ol.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(255,200,80,.25)" stroke="#ffc850" />);
  }
  if (pv.track && tool !== 'select') {
    const t = S(pv.track);
    items.push(<path key="trk" d={`M${t.x - 4} ${t.y}h8M${t.x} ${t.y - 4}v8`} stroke="#9ad" />);
  }
  if (pv.snap) {
    const p = S(pv.snap.p);
    const k = pv.snap.kind;
    const c = '#39ff9a';
    let mark: JSX.Element;
    if (k === 'intersection') mark = <path d={`M${p.x - 7} ${p.y - 7}L${p.x + 7} ${p.y + 7}M${p.x + 7} ${p.y - 7}L${p.x - 7} ${p.y + 7}`} stroke={c} strokeWidth={2} />;
    else if (k === 'column') mark = <circle cx={p.x} cy={p.y} r={7} fill="none" stroke={c} strokeWidth={2} />;
    else if (k === 'mid') mark = <path d={`M${p.x} ${p.y - 7}L${p.x + 7} ${p.y + 6}L${p.x - 7} ${p.y + 6}Z`} fill="none" stroke={c} strokeWidth={2} />;
    else if (k === 'perp') mark = <path d={`M${p.x - 7} ${p.y + 7}H${p.x + 7}M${p.x - 7} ${p.y + 7}V${p.y - 7}M${p.x - 7} ${p.y}H${p.x}V${p.y + 7}`} fill="none" stroke={c} strokeWidth={2} />;
    else if (k === 'near' || k === 'face') mark = <path d={`M${p.x - 6} ${p.y - 6}L${p.x + 6} ${p.y + 6}L${p.x - 6} ${p.y + 6}L${p.x + 6} ${p.y - 6}Z`} fill="none" stroke={c} strokeWidth={1.5} />;
    else if (k === 'ortho') mark = <circle cx={p.x} cy={p.y} r={3} fill={c} />;
    else mark = <rect x={p.x - 6} y={p.y - 6} width={12} height={12} fill="none" stroke={c} strokeWidth={2} />;
    items.push(<g key="snap">{mark}<text x={p.x + 10} y={p.y - 10} fill={c} fontSize={11}>{k}</text></g>);
  }
  if (cur && pv.rubber.length && pv.hint && tool !== 'region') {
    const p = S(cur);
    items.push(
      <text key="lt" x={p.x + 14} y={p.y + 22} fill="#ffc850" fontSize={12} className="halo">
        {pv.hint}
      </text>,
    );
  }
  return <g className="overlay">{items}</g>;
}

function Compass({ rot }: { rot: number }) {
  return (
    <svg className="compass" width={56} height={56} viewBox="-28 -28 56 56">
      <g transform={`rotate(${-rot})`}>
        <line x1={0} y1={0} x2={20} y2={0} stroke="#ff6b6b" strokeWidth={2} />
        <text x={22} y={4} fontSize={10} fill="#ff6b6b">X</text>
        <line x1={0} y1={0} x2={0} y2={-20} stroke="#5be37d" strokeWidth={2} />
        <text x={-3} y={-22} fontSize={10} fill="#5be37d">Y</text>
      </g>
    </svg>
  );
}
