import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useApp, usePreview, planModel, planeLevel, viewModel, visibleModel } from '../model/store';
import { cachedStoryNodes, isNodeId, slabGrips, type PanelSize } from '../model/ops';
import { fmt } from '../model/geom';
import { asStair, columnOn, terminatingColumns, type Beam, type Flight, type Landing, type Pt, type Slab, type Span } from '../model/types';
import { StairLayer } from './StairLayer';
import { flightGrips, flightStory, landingStory, landingRect, landingSides, rectPts } from '../stair/stair';
import { viewport } from './viewport';
import { UnderlayLayer, StairBoxLayer, GridLayer, GridDimLayer, SlabLayer, BeamLayer, ColumnLayer, LabelLayer, LoadLayer, ColorLegend } from './layers';
import { activePattern, useViewPatterns } from '../ui/LoadDialogs';
import { onMove, onClick, onInput, setOffsetInput, onCancel, finishPolygon, picking, finishFramePick, hitTest, boxSelect, fillIntersections, doSnap, gripAt, gripMove, gripDrop, gripCancel, midPicking, startMidPick, spanGrips, type Grip } from './tools';
import { columnOutline } from './snap';
import { pasteLoads, type LoadClip } from '../model/loads';
import { useUnderlay, regionFor, underlayStory } from '../underlay/store';
import { UnderlayCanvas } from './UnderlayCanvas';
import { useIssues } from '../ui/Checks';
import { useFramePick, useMovePick } from '../ui/dialogState';

export function fitAll(w?: number, h?: number) {
  const el = document.getElementById('plan-host');
  const W = w ?? el?.clientWidth ?? 800,
    H = h ?? el?.clientHeight ?? 600;
  const st = useApp.getState();
  const m = st.activeStair ? viewModel(st) : st.model;
  const xs: number[] = [],
    ys: number[] = [];
  m.grids.forEach((g) => (xs.push(g.x1, g.x2), ys.push(g.y1, g.y2)));
  m.columns.forEach((c) => (xs.push(c.x), ys.push(c.y)));
  m.beams.forEach((b) => (xs.push(b.x1, b.x2), ys.push(b.y1, b.y2)));
  const u = useUnderlay.getState();
  // the setup view shows the raw drawing, which can be far from the model: frame the drawing
  if (u.kind === 'dxf' && u.dxf && u.setupMode) {
    const b = u.dxf.fitBox;
    return viewport.fit(b.minX, b.minY, b.maxX, b.maxY, W, H);
  }
  if (!xs.length) {
    if (u.kind === 'dxf' && u.dxf) {
      const story = useApp.getState().activeStory;
      const reg = u.setupMode ? null : u.regions.find((r) => r.stories.includes(story));
      const b = reg ? { minX: reg.rect.minX - reg.ref.x, minY: reg.rect.minY - reg.ref.y, maxX: reg.rect.maxX - reg.ref.x, maxY: reg.rect.maxY - reg.ref.y } : u.dxf.fitBox;
      return viewport.fit(b.minX, b.minY, b.maxX, b.maxY, W, H);
    }
    return viewport.fit(-2000, -2000, 30000, 20000, W, H);
  }
  // leave room for grid bubbles and the dimension chains outside the grid lines
  const pad = m.grids.length ? useApp.getState().gridBubble * 3 : 0;
  viewport.fit(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad, W, H);
}

/**
 * Zoom extents for the active story: its DXF region plus the story's own members and grids.
 * Falls back to fitAll when the story has no region (or in setup view).
 */
export function fitStory() {
  const el = document.getElementById('plan-host');
  const W = el?.clientWidth ?? 800,
    H = el?.clientHeight ?? 600;
  const st = useApp.getState();
  const u = useUnderlay.getState();
  const story = st.activeStory;
  const reg = u.kind === 'dxf' && u.dxf && !u.setupMode ? regionFor(story) : null;
  if (!reg) return fitAll(W, H);
  const m = st.model;
  const xs = [reg.rect.minX - reg.ref.x, reg.rect.maxX - reg.ref.x],
    ys = [reg.rect.minY - reg.ref.y, reg.rect.maxY - reg.ref.y];
  m.grids.forEach((g) => (xs.push(g.x1, g.x2), ys.push(g.y1, g.y2)));
  m.columns.forEach((c) => columnOn(m, c, story) && (xs.push(c.x), ys.push(c.y)));
  m.beams.forEach((b) => b.story === story && (xs.push(b.x1, b.x2), ys.push(b.y1, b.y2)));
  m.slabs.forEach((s) => s.story === story && s.pts.forEach((p) => (xs.push(p.x), ys.push(p.y))));
  const pad = m.grids.length ? st.gridBubble * 3 : 0;
  viewport.fit(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad, W, H);
}

const useVp = () => useSyncExternalStore((f) => viewport.subscribe(f), () => viewport.version);

export function PlanView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const model = useApp(planModel);
  // a reference plane's planModel drops other stories' columns, so judge "terminating" on the full model
  const full = useApp(visibleModel);
  const story = useApp((s) => s.activeStory);
  const selection = useApp((s) => s.selection);
  const show = useApp((s) => s.show);
  const pattern = useApp(activePattern);
  const viewPats = useViewPatterns();
  const viewRot = useApp((s) => s.viewRotation);
  const tool = useApp((s) => s.tool);
  const ts = useApp((s) => s.textScale);
  const bubble = useApp((s) => s.gridBubble);
  const colorBy = useApp((s) => s.colorBy);
  // View by load values: the load labels follow its pattern chips, not just the active pattern
  const loadPats = useMemo(() => (colorBy === 'value' ? viewPats : [pattern]), [colorBy, viewPats, pattern]);
  const gridLock = useApp((s) => s.gridLock);
  const stairs = useApp((s) => s.model.stairs);
  const activeStair = useApp((s) => s.activeStair);
  const stairBoxes = useMemo(() => (activeStair ? stairs.filter((r) => r.id === activeStair) : stairs), [stairs, activeStair]);
  // the setup view shows the raw DXF: place this story's model on its region (reference point = model 0,0)
  const setupRef = useUnderlay((u) => (u.kind === 'dxf' && u.setupMode ? u.regions.find((r) => r.stories.includes(story))?.ref ?? null : null));
  // the cropped view names the story in a fixed banner at the top of the canvas, so it stays put while zooming
  // the reference plane in view, named under the story in the banner: "(RP1 @ +2000)"
  const planeTag = useApp((s) => {
    const r = planeLevel(s) && s.model.refPlanes.find((x) => x.id === s.activePlane);
    return r ? `(${r.name} @ ${r.z >= 0 ? '+' : '−'}${Math.round(Math.abs(r.z))})` : '';
  });
  const uStory = useApp((s) => (s.activeStair || s.underlayBelow ? underlayStory(story) : story));
  const hasRegion = useUnderlay((u) => u.kind === 'dxf' && !!u.dxf && !u.setupMode && u.regions.some((r) => r.stories.includes(uStory)));

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

  const cols = useMemo(() => model.columns.filter((c) => columnOn(model, c, story)), [model, story]);
  // red only on the floor the column stops at, not on the lower stories a joined column passes through
  const ends = useMemo(() => { const t = terminatingColumns(full); return new Set(cols.filter((c) => c.story === story && t.has(c.id)).map((c) => c.id)); }, [full, cols, story]);
  const beams = useMemo(() => model.beams.filter((b) => b.story === story), [model.beams, story]);
  const slabs = useMemo(() => model.slabs.filter((s) => s.story === story), [model.slabs, story]);
  // inside a stair: its flights, landings and spans on this story
  const stair = useMemo(() => {
    const sm = asStair(model);
    return { flights: sm.flights.filter((f) => flightStory(sm, f) === story), landings: sm.landings.filter((l) => landingStory(sm, l) === story), spans: sm.spans.filter((s) => s.story === story) };
  }, [model, story]);
  const legendItems = useMemo(() => [...cols, ...beams, ...(show.slabs ? slabs : [])], [cols, beams, slabs, show.slabs]);
  // ghosts come from the full model: planModel keeps only the level in view while Ref planes is on
  const gCols = useMemo(() => (below && show.ghostBelow ? full.columns.filter((c) => columnOn(full, c, below)) : []), [full, below, show.ghostBelow]);
  const gBeams = useMemo(() => (below && show.ghostBelow ? full.beams.filter((b) => b.story === below && !b.dz) : []), [full.beams, below, show.ghostBelow]);
  const empty = useMemo(() => new Set<string>(), []);

  // ---------- input ----------
  const drag = useRef<{ mode: 'pan' | 'box' | 'grip' | 'none'; start: Pt; last: Pt; button: number; grip?: Grip } | null>(null);
  const space = useRef(false);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        space.current = true;
        e.preventDefault();
      }
      if (e.key === 'Escape') dropStaleGrip();
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

  // a grip drag whose pointer-up never arrived (pointer cancelled, capture lost) must not leave its preview behind
  const dropStaleGrip = () => {
    if (drag.current?.mode !== 'grip') return;
    drag.current = null;
    gripCancel();
  };

  const down = (e: React.PointerEvent) => {
    dropStaleGrip();
    const p = local(e);
    (document.activeElement as HTMLElement | null)?.blur?.();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      drag.current = { mode: 'pan', start: p, last: p, button: e.button };
      return;
    }
    if (e.button === 2) return;
    if (e.button !== 0) return;
    const grip = useApp.getState().tool === 'select' && !picking() ? gripAt(p) : null;
    drag.current = grip ? { mode: 'grip', start: p, last: p, button: 0, grip } : { mode: 'none', start: p, last: p, button: 0 };
  };

  const move = (e: React.PointerEvent) => {
    const p = local(e);
    const d = drag.current;
    if (d?.mode === 'pan') {
      viewport.pan(p.x - d.last.x, p.y - d.last.y);
      d.last = p;
      return;
    }
    if (d?.mode === 'grip') return gripMove(d.grip!, p);
    if (!d && useApp.getState().tool === 'select' && !picking()) hostRef.current!.style.cursor = gripAt(p) ? 'move' : 'default';
    if (d && d.button === 0 && !picking()) {
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
    if (d.mode === 'grip') return gripDrop(d.grip!, p);
    if (picking()) return finishFramePick(p);
    const st = useApp.getState();
    if (d.mode === 'box') {
      usePreview.getState().set({ box: null });
      if (st.tool === 'column') return fillIntersections(d.start, p);
      let ids = boxSelect(planModel(st), d.start, p, st.activeStory, p.x < d.start.x);
      // priority: elements, then nodes, then grids; Alt+drag picks nodes only
      const nodes = ids.filter(isNodeId);
      const elems = ids.filter((id) => !isNodeId(id) && !st.model.grids.some((g) => g.id === id));
      if (e.altKey) ids = nodes;
      else if (elems.length) ids = elems;
      else if (nodes.length) ids = nodes;
      if (e.shiftKey) st.setSelection(st.selection.filter((id) => !ids.includes(id)));
      else st.setSelection(e.ctrlKey ? [...new Set([...st.selection, ...ids])] : ids);
      return;
    }
    if (st.tool === 'select') {
      const id = hitTest(planModel(st), p, st.activeStory);
      if (e.ctrlKey && id) st.setSelection(st.selection.includes(id) ? st.selection.filter((x) => x !== id) : [...st.selection, id]);
      else st.setSelection(id ? [id] : []);
      return;
    }
    const s = doSnap(p);
    onClick(s.p);
    onMove(p);
  };

  const endChain = () => {
    const t = useApp.getState().tool;
    if (t === 'slabDraw' || t === 'area') finishPolygon();
    else onCancel();
  };

  // right-click in a draw tool opens a small menu; elsewhere (select, picks, mid pick) it cancels as before
  const [menu, setMenu] = useState<Pt | null>(null);
  const ctx = (e: React.MouseEvent) => {
    e.preventDefault();
    const st = useApp.getState();
    if (st.tool !== 'select' && !picking() && !midPicking()) return setMenu(local(e));
    // select tool with frames or slabs picked: offer copy/paste of their loads
    if (st.tool === 'select' && !picking() && !midPicking() && loadTargets().all.length) return setMenu(local(e));
    endChain();
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => (window.removeEventListener('pointerdown', close), window.removeEventListener('keydown', key));
  }, [menu]);
  const menuItem = (label: string, run: () => void) => (
    <div className="menu-item" role="menuitem" onClick={() => (setMenu(null), run())}>
      <span />
      <span>{label}</span>
      <span />
    </div>
  );

  const dblClick = () => {
    const t = useApp.getState().tool;
    if (t === 'slabDraw' || t === 'area') finishPolygon();
  };

  const framePick = useFramePick((s) => !!s.done);
  const movePick = useMovePick((s) => !!s.done);
  const pickOn = framePick || movePick;
  const cursor = tool === 'select' && !pickOn ? 'default' : 'crosshair';

  return (
    <div id="plan-host" ref={hostRef} className="plan-host" style={{ cursor }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={dropStaleGrip} onContextMenu={ctx} onDoubleClick={dblClick} onPointerLeave={() => usePreview.getState().set({ cursor: null, snap: null })}>
      <UnderlayCanvas w={size.w} h={size.h} />
      <svg width={size.w} height={size.h} className="plan-svg">
        <g ref={worldRef}>
          {show.underlay && <UnderlayLayer story={story} viewRot={viewRot} />}
          <g transform={setupRef ? `translate(${setupRef.x} ${setupRef.y})` : undefined}>
            {show.slabs && <SlabLayer slabs={slabs} sel={sel} colorBy={colorBy} patterns={viewPats} />}
            <StairBoxLayer stairs={stairBoxes} viewRot={viewRot} size={bubble} />
            {show.grids && <GridLayer grids={model.grids} sel={sel} viewRot={viewRot} showLabels={show.gridLabels} bubble={bubble} />}
            {show.gridDims && <GridDimLayer grids={model.grids} viewRot={viewRot} bubble={bubble} />}
            {gBeams.length > 0 && <BeamLayer beams={gBeams} sel={empty} ghost colorBy="none" />}
            {gCols.length > 0 && <ColumnLayer cols={gCols} secs={secs} sel={empty} ghost colorBy="none" />}
            <BeamLayer beams={beams} sel={sel} colorBy={colorBy} patterns={viewPats} />
            <ColumnLayer cols={cols} secs={secs} sel={sel} colorBy={colorBy} patterns={viewPats} ends={ends} />
            <StairLayer flights={stair.flights} landings={stair.landings} spans={stair.spans} sel={sel} viewRot={viewRot} ts={ts} />
            {show.sectionLabels && <LabelLayer m={model} story={story} viewRot={viewRot} ts={ts} showSlabs={show.slabs} />}
            {(show.loads || colorBy === 'value') && <LoadLayer m={model} story={story} patterns={loadPats} viewRot={viewRot} ts={ts} />}
          </g>
        </g>
        <IssueLayer story={story} offset={setupRef} />
        {show.nodes && <NodeLayer story={story} sel={sel} offset={setupRef} />}
        {tool === 'select' && <GripLayer beams={activeStair ? [] : [...beams, ...model.grids]} slabs={activeStair ? [] : slabs} {...stair} sel={sel} offset={setupRef} />}
        <Overlay />
      </svg>
      {menu && (
        <div className="menu ctx-menu" role="menu" style={{ top: menu.y, left: menu.x }} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation())}>
          {tool === 'select' ? (
            <LoadClipItems item={menuItem} />
          ) : (
            <>
              {menuItem('Mid between two points', startMidPick)}
              <div className="menu-sep" role="separator" />
              {menuItem(tool === 'slabDraw' || tool === 'area' ? 'Close polygon' : 'End / cancel', endChain)}
            </>
          )}
        </div>
      )}
      {tool === 'beamOffset' && <OffsetField />}
      <Compass rot={viewRot} />
      <ColorLegend items={legendItems} colorBy={colorBy} patterns={viewPats} />
      {show.underlay && hasRegion && (
        <div className="story-banner nosel">
          {story}
          {planeTag && <div className="plane-tag">{planeTag}</div>}
          {uStory !== story && <div className="plane-tag">(underlay: {uStory})</div>}
        </div>
      )}
      <button className="zoom-ext" title="Zoom extents: the whole story region" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={fitStory}>
        <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
          <rect x={5} y={5} width={6} height={6} strokeWidth={1.2} />
        </svg>
      </button>
      <button className={'grid-lock' + (gridLock ? ' on' : '')} title={gridLock ? 'Grids locked: click to allow selecting and editing grids' : 'Lock grids: they can no longer be selected, drawn or reshaped'} aria-pressed={gridLock} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={useApp.getState().toggleGridLock}>
        <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <rect x={3} y={7} width={10} height={7} rx={1} />
          <path d={gridLock ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0'} />
        </svg>
      </button>
    </div>
  );
}

// ---------- copy / paste load assignments (select tool right-click) ----------

// shortcut: in-memory only, lost on reload; fine for copying between elements in one sitting
let loadClip: LoadClip | null = null;

/** The selected frames (columns, beams) and slabs. */
function loadTargets() {
  const { model: m, selection } = useApp.getState();
  const s = new Set(selection);
  const frames = [...m.columns, ...m.beams].filter((x) => s.has(x.id));
  const slabs = m.slabs.filter((x) => s.has(x.id));
  return { frames, slabs, all: [...frames, ...slabs] };
}

function LoadClipItems({ item }: { item: (label: string, run: () => void) => React.ReactNode }) {
  const { frames, slabs, all } = loadTargets();
  const one = all.length === 1 ? all[0] : null;
  const copy = () => {
    loadClip = frames.length ? { frame: true, loads: frames[0].loads ?? [] } : { frame: false, loads: slabs[0].loads ?? [] };
  };
  const clip = loadClip;
  const targets = clip ? (clip.frame ? frames : slabs).map((x) => x.id) : [];
  const paste = (replace: boolean) => () => useApp.getState().commit((m) => pasteLoads(m, targets, clip!, replace));
  const what = clip ? `${clip.loads.length} ${clip.frame ? 'frame' : 'slab'} load${clip.loads.length === 1 ? '' : 's'}` : '';
  return (
    <>
      {one && item(`Copy loads (${(one.loads ?? []).length})`, copy)}
      {targets.length > 0 && item(`Paste ${what}: add`, paste(false))}
      {targets.length > 0 && item(`Paste ${what}: replace`, paste(true))}
      {!one && !targets.length && <div className="menu-item" aria-disabled style={{ opacity: 0.5, pointerEvents: 'none' }}><span /><span>{clip ? `Copied ${what} need ${clip.frame ? 'frames' : 'slabs'} selected` : 'Select one element to copy its loads'}</span><span /></div>}
      <div className="menu-sep" role="separator" />
      {item('Clear selection', () => useApp.getState().setSelection([]))}
    </>
  );
}

// ---------- nodes (screen space so they stay a fixed size at any zoom) ----------

function NodeLayer({ story, sel, offset }: { story: string; sel: Set<string>; offset: Pt | null }) {
  useVp();
  const model = useApp(planModel);
  const nodes = cachedStoryNodes(model, story);
  const ox = offset?.x ?? 0,
    oy = offset?.y ?? 0;
  return (
    <g className="nodes">
      {nodes.map((n) => {
        const p = viewport.toScreen({ x: n.x + ox, y: n.y + oy });
        const s = sel.has(n.id);
        return <rect key={n.id} x={p.x - (s ? 4 : 2.5)} y={p.y - (s ? 4 : 2.5)} width={s ? 8 : 5} height={s ? 8 : 5} fill={s ? 'var(--sel)' : 'var(--node)'} stroke={s ? 'var(--bg)' : 'none'} strokeWidth={1} />;
      })}
    </g>
  );
}

/** Red rings where the model check found a problem on this story (screen space, fixed size). */
function IssueLayer({ story, offset }: { story: string; offset: Pt | null }) {
  useVp();
  const issues = useIssues().filter((i) => i.story === story);
  const ox = offset?.x ?? 0,
    oy = offset?.y ?? 0;
  return (
    <g className="issue-marks">
      {issues.map((i, k) => {
        const p = viewport.toScreen({ x: i.at.x + ox, y: i.at.y + oy });
        return (
          <g key={k}>
            <circle cx={p.x} cy={p.y} r={11} fill="none" stroke="var(--danger)" strokeWidth={2} />
            <text x={p.x + 13} y={p.y - 9} fill="var(--danger)" fontSize={13} fontWeight={700}>!</text>
          </g>
        );
      })}
    </g>
  );
}

/** End grips on selected beams and grids (screen space, fixed size). Drag one to reshape or extend it. */
function GripLayer({ beams, slabs, flights, landings, spans, sel, offset }: { beams: Pick<Beam, 'id' | 'x1' | 'y1' | 'x2' | 'y2'>[]; slabs: Slab[]; flights: Flight[]; landings: Landing[]; spans: Span[]; sel: Set<string>; offset: Pt | null }) {
  useVp();
  const ox = offset?.x ?? 0,
    oy = offset?.y ?? 0;
  const picked = [
    ...beams.filter((b) => sel.has(b.id)).map((b) => ({ id: b.id, pts: [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }] })),
    ...slabs.filter((s) => sel.has(s.id)).map((s) => ({ id: s.id, pts: slabGrips(s.pts) })),
    ...landings.filter((l) => sel.has(l.id)).map((l) => ({ id: l.id, pts: [...rectPts(landingRect(l)), ...landingSides(l)] })),
    ...spans.filter((sp) => sel.has(sp.id)).map((sp) => ({ id: sp.id, pts: spanGrips(sp).map(([, q]) => q) })),
    ...flights.filter((f) => sel.has(f.id)).map((f) => ({ id: f.id, pts: Object.values(flightGrips(f)) })),
  ];
  if (picked.length > 200) return null;
  return (
    <g className="grips">
      {picked.flatMap((b) =>
        b.pts.map((q, i) => {
          const p = viewport.toScreen({ x: q.x + ox, y: q.y + oy });
          return <rect key={b.id + i} x={p.x - 4.5} y={p.y - 4.5} width={9} height={9} fill="#4aa3ff" stroke="var(--bg)" strokeWidth={1.5} />;
        }),
      )}
    </g>
  );
}

// ---------- screen-space overlay (snap markers, rubber band, measurements) ----------

/** Distance box beside the pointer for Offset beam, shown once the source and its direction are fixed; Enter places the beam. */
function OffsetField() {
  const line = usePreview((s) => s.offsetLine);
  const input = usePreview((s) => s.input);
  const cur = usePreview((s) => s.cursor);
  if (!line) return null;
  const m = viewport.toScreen(cur ?? { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 }); // follows the pointer
  const stop = (e: React.SyntheticEvent) => e.stopPropagation(); // typing/clicking here must not place a beam
  return (
    <label className="offset-field" style={{ left: m.x + 16, top: m.y + 16 }} onPointerDown={stop} onPointerUp={stop} onPointerMove={stop}>
      Offset
      <input
        id="offset-cmd"
        autoFocus
        inputMode="decimal"
        value={input}
        placeholder="mm"
        onChange={(e) => setOffsetInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onInput(input)}
      />
      mm
    </label>
  );
}

function Overlay() {
  useVp();
  const pv = usePreview();
  const tool = useApp((s) => s.tool);
  const model = useApp((s) => s.model);
  const active = useApp((s) => s.active);
  const angle = useApp((s) => s.columnAngle);
  const colAlign = useApp((s) => s.colAlign);
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
  if (pv.rubber.length && cur && tool !== 'region' && tool !== 'stairBox') {
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
  if (pv.panel) items.push(<PanelDims key="pnl" s={pv.panel} />);
  if (pv.grip) {
    items.push(<polyline key="grip" points={pv.grip.map(S).map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#4aa3ff" strokeWidth={2} strokeDasharray="8 4" />);
  }
  if (pv.pick) {
    const a = S(pv.pick.a),
      p = S(pv.pick.p);
    items.push(
      <g key="pick">
        <line x1={a.x} y1={a.y} x2={p.x} y2={p.y} stroke="#ff7ad9" strokeWidth={3} strokeOpacity={0.8} />
        <circle cx={a.x} cy={a.y} r={5} fill="none" stroke="#ff7ad9" strokeWidth={2} />
        <text x={a.x + 8} y={a.y + 16} fill="#ff7ad9" fontSize={11} className="halo">start</text>
        <circle cx={p.x} cy={p.y} r={4} fill="#ff7ad9" />
        <text x={p.x + 12} y={p.y + 22} fill="#ff7ad9" fontSize={12} className="halo">{pv.pick.text}</text>
      </g>,
    );
  }
  if (pv.offsetLine) {
    const [a, b] = pv.offsetLine.map(S);
    items.push(<line key="off" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffc850" strokeWidth={2} strokeDasharray="8 4" />);
  }
  if (pv.guide) {
    const { p: g, d } = pv.guide;
    const far = 4000 / viewport.k; // same reach as the column align guide
    const a = S({ x: g.x - d.x * far, y: g.y - d.y * far }),
      b = S({ x: g.x + d.x * far, y: g.y + d.y * far });
    items.push(<line key="ofg" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff9f43" strokeDasharray="10 5" strokeWidth={1.5} />);
  }
  if (tool === 'column' && cur && !pv.box) {
    const sec = model.frameSections.find((s) => s.name === active.column);
    const ol = columnOutline({ x: cur.x, y: cur.y, angle, section: active.column }, sec).map(S);
    items.push(<polygon key="cpv" points={ol.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(255,200,80,.25)" stroke="#ffc850" />);
  }
  if (tool === 'column' && colAlign.ref && colAlign.mode !== 'off') {
    const r = S(colAlign.ref);
    // guide line through the reference point, drawn across the whole view (world X or Y direction)
    const dir = colAlign.mode === 'x' ? { x: 0, y: 1 } : { x: 1, y: 0 };
    const far = 4000 / viewport.k; // ~4000 px each way: past the screen edge, small enough for SVG to draw
    const a = S({ x: colAlign.ref.x - dir.x * far, y: colAlign.ref.y - dir.y * far }),
      b = S({ x: colAlign.ref.x + dir.x * far, y: colAlign.ref.y + dir.y * far });
    items.push(<line key="algl" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ff9f43" strokeDasharray="10 5" strokeWidth={1} />);
    items.push(<circle key="algr" cx={r.x} cy={r.y} r={6} fill="none" stroke="#ff9f43" strokeWidth={2} />);
  }
  if (pv.mid) {
    const c = '#ff9f43';
    const pts = pv.mid.pts.map(S);
    if (pts.length === 2) items.push(<line key="midab" x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke={c} strokeOpacity={0.6} strokeDasharray="4 3" />);
    else if (pts.length === 1 && cur) {
      const q = S(cur);
      items.push(<line key="midab" x1={pts[0].x} y1={pts[0].y} x2={q.x} y2={q.y} stroke={c} strokeOpacity={0.6} strokeDasharray="4 3" />);
    }
    pts.forEach((p, i) => items.push(<circle key={'midp' + i} cx={p.x} cy={p.y} r={4} fill={c} />));
    if (pv.mid.guide) {
      const g = pv.mid.guide;
      const far = 4000 / viewport.k; // same reach as the column align guide
      const d = pv.mid.vertical === false ? { x: far, y: 0 } : { x: 0, y: far };
      const a = S({ x: g.x - d.x, y: g.y - d.y }),
        b = S({ x: g.x + d.x, y: g.y + d.y }),
        m = S(g);
      items.push(<line key="midgl" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeDasharray="10 5" strokeWidth={1} />);
      items.push(<path key="midm" d={`M${m.x} ${m.y - 7}L${m.x + 7} ${m.y + 6}L${m.x - 7} ${m.y + 6}Z`} fill="none" stroke={c} strokeWidth={2} />);
    }
  }
  pv.tracks.forEach((q, i) => {
    const t = S(q);
    items.push(<path key={'trk' + i} d={`M${t.x - 4} ${t.y}h8M${t.x} ${t.y - 4}v8`} stroke="#9ad" />);
  });
  if (pv.snap?.guides) {
    const p = S(pv.snap.p);
    pv.snap.guides.forEach((g, i) => {
      const a = S(g);
      const L = Math.hypot(p.x - a.x, p.y - a.y) || 1;
      const far = 4000 / L; // run on past the cursor
      items.push(<line key={'tg' + i} x1={a.x} y1={a.y} x2={p.x + (p.x - a.x) * far} y2={p.y + (p.y - a.y) * far} stroke="#9ad" strokeDasharray="6 4" strokeWidth={1} />);
    });
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
    else if (k === 'ortho' || k === 'align' || k === 'track') mark = <circle cx={p.x} cy={p.y} r={3} fill={c} />;
    else mark = <rect x={p.x - 6} y={p.y - 6} width={12} height={12} fill="none" stroke={c} strokeWidth={2} />;
    items.push(<g key="snap">{mark}<text x={p.x + 10} y={p.y - 10} fill={c} fontSize={11}>{pv.snap.guides?.length === 1 ? `track ${fmt(Math.hypot(pv.snap.p.x - pv.snap.guides[0].x, pv.snap.p.y - pv.snap.guides[0].y))}` : k}</text></g>);
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

/**
 * Panel Size & Type result drawn inside the panel: an Lx and an Ly dimension line across it, and
 * the slab type with Ly/Lx at the centre. Screen space, so text keeps its size and stays upright.
 */
function PanelDims({ s }: { s: PanelSize }) {
  const S = (p: Pt) => viewport.toScreen(p);
  const at = (a: number, b: number) => S({ x: s.c.x + s.dx.x * a + s.dy.x * b, y: s.c.y + s.dx.y * a + s.dy.y * b });
  const c = '#ff7ad9';
  // dimension from p to q, label above the line (upright, along it)
  const dim = (key: string, p: Pt, q: Pt, label: string) => {
    let ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    // keep text upright; vertical text reads bottom to top, as on drawings
    if (ang > 89.5) ang -= 180;
    else if (ang < -90.5) ang += 180;
    const L = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / L,
      uy = (q.y - p.y) / L;
    const head = (o: Pt, d: number) => `M${o.x} ${o.y}l${(ux * 4 - uy * 3) * d * 2} ${(uy * 4 + ux * 3) * d * 2}M${o.x} ${o.y}l${(ux * 4 + uy * 3) * d * 2} ${(uy * 4 - ux * 3) * d * 2}`;
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    return (
      <g key={key}>
        <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={c} strokeWidth={1.2} />
        <path d={head(p, 1) + head(q, -1)} stroke={c} strokeWidth={1.2} fill="none" />
        {L > 40 && (
          <text transform={`translate(${m.x},${m.y}) rotate(${ang})`} dy={-5} fontSize={12} textAnchor="middle" fill={c} className="halo">
            {label}
          </text>
        )}
      </g>
    );
  };
  const centre = S(s.c);
  return (
    <g className="nosel">
      {dim('lx', at(-s.lx / 2, s.ly * 0.25), at(s.lx / 2, s.ly * 0.25), `Lx = ${fmt(s.lx)}`)}
      {dim('ly', at(s.lx * 0.25, -s.ly / 2), at(s.lx * 0.25, s.ly / 2), `Ly = ${fmt(s.ly)}`)}
      <text x={centre.x} y={centre.y} fontSize={14} fontWeight={600} textAnchor="middle" fill={c} className="halo">
        {s.oneWay ? 'One-way' : 'Two-way'}
      </text>
      <text x={centre.x} y={centre.y + 16} fontSize={11} textAnchor="middle" fill={c} className="halo">
        Ly/Lx = {fmt(s.ratio, 2)}
      </text>
    </g>
  );
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
