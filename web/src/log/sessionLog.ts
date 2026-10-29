import { create } from 'zustand';
import { useApp, type ShowFlags, type ToolName } from '../model/store';
import { useDialog, type Dialog } from '../ui/dialogState';
import { explainAutoSize } from '../model/autoBeam';
import type { Beam, Column, FrameSection, Grid, JointLoad, LoadPattern, Material, Model, Pt, Slab, SlabSection, Story } from '../model/types';
import { describeFrameLoad, describeJointLoad, describeShellLoad } from '../model/loads';

export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
  t: number;
  cat: string;
  text: string;
  level: LogLevel;
}

const MAX = 5000;

/** Everything done in this session, oldest first. In memory only: a reload starts a new session. */
export const useLog = create<{ entries: LogEntry[]; open: boolean }>(() => ({ entries: [], open: false }));

export function log(cat: string, text: string, level: LogLevel = 'info') {
  useLog.setState((s) => ({ entries: [...(s.entries.length >= MAX ? s.entries.slice(1 - MAX) : s.entries), { t: Date.now(), cat, text, level }] }));
}

export const clearLog = () => useLog.setState({ entries: [] });
export const toggleLog = () => useLog.setState((s) => ({ open: !s.open }));

const time = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
export const formatEntry = (e: LogEntry) => `${time(e.t)}  ${e.cat.padEnd(7)} ${e.level === 'info' ? '' : e.level.toUpperCase() + ': '}${e.text}`;
export const logText = (entries = useLog.getState().entries) => entries.map(formatEntry).join('\n');

export function downloadLog() {
  const blob = new Blob([logText() + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `session-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

type Keyed = { id?: string; name?: string; story?: string; section?: string };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`.replace(/ys$/, 'ies');

const mm = (v: number) => String(Math.round(v));
const pt = (x: number, y: number) => `(${mm(x)}, ${mm(y)})`;
const metres = (v: number) => `${(v / 1000).toFixed(2)} m`;
const area = (p: Pt[]) => {
  const a = p.reduce((s, q, i) => s + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0);
  return `${(Math.abs(a) / 2e6).toFixed(2)} m²`;
};
const beamLen = (b: Beam) => Math.hypot(b.x2 - b.x1, b.y2 - b.y1);

/** "on Story2 (B300x500)": the stories and section shared by the items, if few enough to name. */
function where(items: Keyed[]) {
  const st = [...new Set(items.map((x) => x.story).filter(Boolean))];
  const sec = [...new Set(items.map((x) => x.section).filter(Boolean))];
  return (st.length ? ` on ${st.length <= 3 ? st.join(', ') : plural(st.length, 'story')}` : '') + (sec.length === 1 ? ` (${sec[0]})` : '');
}

/** How to write one kind of item: in full, and what changed between two versions of it ("section A → B"). */
type Words<T> = { describe: (x: T) => string; compare: (a: T, b: T) => string[] };

/** "moved by (dx, dy)" when every point shifted by the same amount, else null. */
function moved(pa: Pt[], pb: Pt[]): string | null {
  if (pa.length !== pb.length || !pa.length) return null;
  const dx = pb[0].x - pa[0].x;
  const dy = pb[0].y - pa[0].y;
  if (!dx && !dy) return null;
  return pa.every((q, i) => Math.abs(pb[i].x - q.x - dx) < 0.5 && Math.abs(pb[i].y - q.y - dy) < 0.5) ? `moved by ${pt(dx, dy)}` : null;
}
const field = (label: string, a: unknown, b: unknown, unit = '') => (a !== b ? [`${label} ${a}${unit} → ${b}${unit}`] : []);
/** "loads now: …" when the loads an element carries changed */
function loadsField<L extends { pattern: string }>(a: L[] | undefined, b: L[] | undefined, say: (l: L) => string): string[] {
  if (JSON.stringify(a ?? []) === JSON.stringify(b ?? [])) return [];
  return [b?.length ? `loads now ${b.map((l) => `${l.pattern} ${say(l)}`).join('; ')}` : 'loads removed'];
}

const columnWords: Words<Column> = {
  describe: (c) => `column ${c.section} on ${c.base ? `${c.base}–${c.story}` : c.story} at ${pt(c.x, c.y)}${c.angle ? `, rotated ${c.angle}°` : ''}`,
  compare: (a, b) => [
    ...field('story', a.story, b.story),
    ...field('base story', a.base ?? a.story, b.base ?? b.story),
    ...field('section', a.section, b.section),
    ...(a.x !== b.x || a.y !== b.y ? [`moved ${pt(a.x, a.y)} → ${pt(b.x, b.y)}`] : []),
    ...field('angle', a.angle, b.angle, '°'),
    ...loadsField(a.loads, b.loads, describeFrameLoad),
  ],
};
const beamWords: Words<Beam> = {
  describe: (b) => `beam ${b.section} on ${b.story} from ${pt(b.x1, b.y1)} to ${pt(b.x2, b.y2)}, ${metres(beamLen(b))} long`,
  compare: (a, b) => {
    const ends = (x: Beam) => [{ x: x.x1, y: x.y1 }, { x: x.x2, y: x.y2 }];
    const geo = a.x1 !== b.x1 || a.y1 !== b.y1 || a.x2 !== b.x2 || a.y2 !== b.y2;
    return [
      ...field('story', a.story, b.story),
      ...field('section', a.section, b.section),
      ...(geo ? [moved(ends(a), ends(b)) ?? `now ${pt(b.x1, b.y1)} to ${pt(b.x2, b.y2)}, length ${metres(beamLen(a))} → ${metres(beamLen(b))}`] : []),
      ...loadsField(a.loads, b.loads, describeFrameLoad),
    ];
  },
};
const slabWords: Words<Slab> = {
  describe: (s) => `slab ${s.section} on ${s.story}, ${s.pts.length} corners, ${area(s.pts)}`,
  compare: (a, b) => [
    ...field('story', a.story, b.story),
    ...field('section', a.section, b.section),
    ...(JSON.stringify(a.pts) !== JSON.stringify(b.pts) ? [moved(a.pts, b.pts) ?? `reshaped to ${b.pts.length} corners, area ${area(a.pts)} → ${area(b.pts)}`] : []),
    ...loadsField(a.loads, b.loads, describeShellLoad),
  ],
};
const gridAt = (g: Grid) => (g.dir === 'X' ? `x = ${mm(g.x1)}` : g.dir === 'Y' ? `y = ${mm(g.y1)}` : `${pt(g.x1, g.y1)} to ${pt(g.x2, g.y2)}`);
const gridWords: Words<Grid> = {
  describe: (g) => `grid ${g.label} (${g.dir === 'G' ? 'general' : g.dir}) at ${gridAt(g)}`,
  compare: (a, b) => [
    ...field('label', a.label, b.label),
    ...field('direction', a.dir, b.dir),
    ...(gridAt(a) !== gridAt(b) ? [`moved ${gridAt(a)} → ${gridAt(b)}`] : []),
    ...field('bubble', a.bubble, b.bubble),
  ],
};
const storyWords: Words<Story> = {
  describe: (s) => `story ${s.name}, ${mm(s.height)} mm high${s.isMaster ? ', master' : s.similarTo ? `, similar to ${s.similarTo}` : ''}`,
  compare: (a, b) => [
    ...field('height', a.height, b.height, ' mm'),
    ...field('master', a.isMaster, b.isMaster),
    ...field('similar to', a.similarTo || 'none', b.similarTo || 'none'),
  ],
};
const frameWords: Words<FrameSection> = {
  describe: (f) => `frame section ${f.name} (${f.shape === 'Circle' ? `Ø${mm(f.t3)}` : `${mm(f.t2)}×${mm(f.t3)}`} mm, ${f.material})`,
  compare: (a, b) => [...field('shape', a.shape, b.shape), ...field('depth', a.t3, b.t3, ' mm'), ...field('width', a.t2, b.t2, ' mm'), ...field('material', a.material, b.material)],
};
const slabSecWords: Words<SlabSection> = {
  describe: (s) => `slab section ${s.name} (${mm(s.thickness)} mm, ${s.material})`,
  compare: (a, b) => [...field('thickness', a.thickness, b.thickness, ' mm'), ...field('material', a.material, b.material)],
};
const patternWords: Words<LoadPattern> = {
  describe: (p) => `load pattern ${p.name} (${p.type}, self-weight ×${p.selfWeight})`,
  compare: (a, b) => [...field('type', a.type, b.type), ...field('self-weight', a.selfWeight, b.selfWeight)],
};
const jointLoadWords: Words<JointLoad> = {
  describe: (j) => `joint load ${j.pattern} ${describeJointLoad(j.f)} on ${j.story} at ${pt(j.x, j.y)}`,
  compare: (a, b) => [
    ...field('pattern', a.pattern, b.pattern),
    ...(JSON.stringify(a.f) !== JSON.stringify(b.f) ? [`now ${describeJointLoad(b.f)}`] : []),
    ...(a.x !== b.x || a.y !== b.y || a.story !== b.story ? [`moved to ${b.story} ${pt(b.x, b.y)}`] : []),
  ],
};
const materialWords: Words<Material> = {
  describe: (m) => `material ${m.name} (${m.type})`,
  compare: (a, b) => field('type', a.type, b.type),
};

/** Up to this many items are written out one by one; more are summarised by story and section. */
const DETAIL = 4;

function diffList<T extends Keyed>(a: T[], b: T[], word: string, key: (x: T) => string, w: Words<T>): string[] {
  if (a === b) return [];
  const before = new Map(a.map((x) => [key(x), x]));
  const after = new Map(b.map((x) => [key(x), x]));
  const added = b.filter((x) => !before.has(key(x)));
  const removed = a.filter((x) => !after.has(key(x)));
  const changed = b.filter((x) => {
    const o = before.get(key(x));
    return o && o !== x && JSON.stringify(o) !== JSON.stringify(x);
  });
  const out: string[] = [];
  const list = (l: T[]) => (l.length <= DETAIL ? ': ' + l.map(w.describe).join(' | ') : where(l));

  // one edit that both removes and adds columns, beams or slabs is a split, a join or a replacement
  if (added.length && removed.length && (word === 'column' || word === 'beam' || word === 'slab')) {
    const verb = removed.length === 1 && added.length > 1 ? 'Split' : added.length < removed.length ? (word === 'slab' ? 'Merged' : 'Joined') : 'Replaced';
    out.push(`${verb} ${plural(removed.length, word)}${list(removed)} → into ${plural(added.length, word)}${list(added)}`);
  } else {
    if (added.length) out.push(`Added ${plural(added.length, word)}${list(added)}`);
    if (removed.length) out.push(`Deleted ${plural(removed.length, word)}${list(removed)}`);
  }
  if (changed.length) {
    const what = changed.map((x) => w.compare(before.get(key(x))!, x).join(', ') || 'edited');
    const name = (x: T) => (x.name !== undefined ? x.name : w.describe(before.get(key(x))!));
    if (changed.length === 1) out.push(`Changed ${name(changed[0])}: ${what[0]}`);
    else if (what.every((s) => s === what[0])) out.push(`Changed ${plural(changed.length, word)}${where(changed)}: ${what[0]}`);
    else if (changed.length <= DETAIL) out.push(`Changed ${plural(changed.length, word)}: ${changed.map((x, i) => `${name(x)}: ${what[i]}`).join(' | ')}`);
    else out.push(`Changed ${plural(changed.length, word)}${where(changed)}`);
  }
  return out;
}

/** Human description of what changed between two models, one line per kind of change. */
export function diffModel(a: Model, b: Model): string[] {
  const id = (x: { id: string }) => x.id;
  const name = (x: { name: string }) => x.name;
  const out = [
    ...diffList(a.grids, b.grids, 'grid', id, gridWords),
    ...diffList(a.columns, b.columns, 'column', id, columnWords),
    ...diffList(a.beams, b.beams, 'beam', id, beamWords),
    ...diffList(a.slabs, b.slabs, 'slab', id, slabWords),
    ...diffList(a.stories, b.stories, 'story', name, storyWords),
    ...diffList(a.frameSections, b.frameSections, 'frame section', name, frameWords),
    ...diffList(a.slabSections, b.slabSections, 'slab section', name, slabSecWords),
    ...diffList(a.materials, b.materials, 'material', name, materialWords),
    ...diffList(a.loadPatterns ?? [], b.loadPatterns ?? [], 'load pattern', name, patternWords),
    ...diffList(a.jointLoads ?? [], b.jointLoads ?? [], 'joint load', id, jointLoadWords),
  ];
  if (a.stories !== b.stories && a.stories.map(name).join() !== b.stories.map(name).join() && a.stories.length === b.stories.length && !out.some((s) => s.includes('stor')))
    out.push(`Reordered stories (bottom → top): ${b.stories.map(name).join(', ')}`);
  if (a.baseElevation !== b.baseElevation) out.push(`Base elevation ${mm(a.baseElevation)} → ${mm(b.baseElevation)} mm`);
  if (JSON.stringify(a.foundation) !== JSON.stringify(b.foundation)) {
    const f = b.foundation;
    out.push(f ? `Foundation inputs: founding depth ${mm(f.foundingDepth)} mm, footing ${mm(f.footingThickness)} mm, plinth ${mm(f.plinthHeight)} mm` : 'Foundation inputs cleared');
  }
  if (a.pushedIds !== b.pushedIds && !out.length) out.push(`${plural(b.pushedIds.length, 'element')} marked as pushed to ETABS`);
  return out;
}

const TOOL_NAMES: Record<ToolName, string> = {
  select: 'Select',
  grid: 'Draw grid',
  column: 'Place column',
  beam: 'Draw beam',
  beamOffset: 'Offset beam',
  slab: 'Slab (click a bay)',
  slabDraw: 'Draw slab outline',
  measure: 'Measure distance',
  angle: 'Measure angle',
  area: 'Measure area',
  panel: 'Panel size & type',
  region: 'Define story region',
  calibrate: 'Calibrate underlay',
  origin: 'Set origin',
};
const DIALOG_NAMES: Record<Dialog['kind'], string> = {
  region: 'Story region',
  regionStories: 'Region stories',
  grids: 'Grids',
  replicate: 'Replicate',
  move: 'Move',
  selectBy: 'Select by',
  sections: 'Sections',
  stories: 'Stories',
  underlay: 'Underlay',
  etabs: 'ETABS',
  rotate: 'Rotate',
  loadPatterns: 'Load patterns',
  frameLoad: 'Frame load',
  shellLoad: 'Shell load',
  jointLoad: 'Joint load',
};
const SHOW_NAMES: Record<keyof ShowFlags, string> = {
  sectionLabels: 'section labels',
  gridLabels: 'grid labels',
  gridDims: 'grid dimensions',
  ghostBelow: 'story below (ghosted)',
  underlay: 'underlay',
  columns: 'columns',
  beams: 'beams',
  slabs: 'slabs',
  nodes: 'nodes',
  loads: 'loads',
};
const PANEL_NAMES = { plan: 'plan view only', '3d': '3D view only', split: 'plan and 3D side by side', elev: 'elevation view' };

/** The elements `ids` picks out: one in full, several as "3 beams on Story2 (B300x500), 1 column on Story2". */
function describeIds(m: Model, ids: string[]) {
  const set = new Set(ids);
  const cols = m.columns.filter((x) => set.has(x.id));
  const beams = m.beams.filter((x) => set.has(x.id));
  const slabs = m.slabs.filter((x) => set.has(x.id));
  const grids = m.grids.filter((x) => set.has(x.id));
  if (cols.length + beams.length + slabs.length + grids.length === 1)
    return cols.length ? columnWords.describe(cols[0]) : beams.length ? beamWords.describe(beams[0]) : slabs.length ? slabWords.describe(slabs[0]) : gridWords.describe(grids[0]);
  const parts: [Keyed[], string][] = [[cols, 'column'], [beams, 'beam'], [slabs, 'slab'], [grids, 'grid']];
  return parts.filter(([l]) => l.length).map(([l, w]) => plural(l.length, w) + where(l)).join(', ') || plural(ids.length, 'element');
}

/** Up to this many auto-sized beams get their reasons written out. */
const EXPLAIN = 30;

/** Log why the Auto rules gave each of the beams `ids` in `m` its section, `base` being the active beam section. */
export function logAutoSizes(m: Model, ids: string[], base: string) {
  const set = new Set(ids);
  const beams = m.beams.filter((b) => set.has(b.id));
  for (const b of beams.slice(0, EXPLAIN)) log('auto', `${beamWords.describe(b)}. ${explainAutoSize(m, b, base)}`);
  if (beams.length > EXPLAIN) log('auto', `…and ${plural(beams.length - EXPLAIN, 'more beam')} sized by the same rules (reasons not written out)`);
}

let started = false;
/** Start recording app activity. Safe to call more than once. */
export function startSessionLog() {
  if (started) return;
  started = true;
  log('session', `Started ${new Date().toLocaleString()}`);

  let selTimer = 0;
  useApp.subscribe((s, p) => {
    if (s.model !== p.model) {
      const m = s.model;
      // setModel with a fresh history (new, open, restore) leaves both stacks empty; a commit never does
      if (!s.past.length && !s.future.length)
        log(
          'model',
          `Model loaded: ${plural(m.stories.length, 'story')} (${m.stories.map((x) => x.name).join(', ')}), ${plural(m.grids.length, 'grid')}, ` +
            `${plural(m.columns.length, 'column')}, ${plural(m.beams.length, 'beam')}, ${plural(m.slabs.length, 'slab')}, ` +
            `${plural(m.frameSections.length + m.slabSections.length, 'section')}`
        );
      else {
        const how = m === p.past[p.past.length - 1] ? 'Undo, reverting: ' : m === p.future[0] ? 'Redo: ' : '';
        const d = diffModel(p.model, m);
        if (d.length) d.forEach((line) => log('model', how + line));
        else log('model', how + 'no element changes');
      }
    }
    if (s.tool !== p.tool) log('tool', `${TOOL_NAMES[s.tool] ?? s.tool} tool (was ${TOOL_NAMES[p.tool] ?? p.tool})`);
    if (s.activeStory !== p.activeStory) log('view', `Active story ${p.activeStory || 'none'} → ${s.activeStory}`);
    if (s.alsoStories !== p.alsoStories) log('view', s.alsoStories.length ? `Drawing also applies to ${s.alsoStories.join(', ')}` : 'Drawing applies to the active story only');
    if (s.panel !== p.panel) log('view', `Showing ${PANEL_NAMES[s.panel]}`);
    if (s.ortho !== p.ortho) log('setting', `Ortho ${s.ortho ? 'on: lines snap to horizontal/vertical' : 'off: lines at any angle'}`);
    if (s.autoBeam !== p.autoBeam) log('setting', `Auto beam size ${s.autoBeam ? 'on: new beams sized from span and supports' : `off: new beams use ${s.active.beam}`}`);
    if (s.autoSplitSlabs !== p.autoSplitSlabs) log('setting', `Split slabs at new beams ${s.autoSplitSlabs ? 'on' : 'off'}`);
    if (s.loadPattern !== p.loadPattern) log('setting', `Active load pattern ${p.loadPattern} → ${s.loadPattern}`);
    if (s.colorBySection !== p.colorBySection) log('setting', `Colour by section ${s.colorBySection ? 'on' : 'off'}`);
    if (s.active !== p.active)
      for (const k of ['column', 'beam', 'slab'] as const) if (s.active[k] !== p.active[k]) log('setting', `Active ${k} section ${p.active[k]} → ${s.active[k]}`);
    if (s.show !== p.show)
      for (const k of Object.keys(s.show) as (keyof ShowFlags)[]) if (s.show[k] !== p.show[k]) log('view', `${s.show[k] ? 'Showing' : 'Hiding'} ${SHOW_NAMES[k] ?? k}`);
    if (s.hidden !== p.hidden && (s.hidden.length || p.hidden.length)) {
      if (!s.hidden.length) log('view', `Showing all elements again (${plural(p.hidden.length, 'element')} had been hidden)`);
      else {
        const was = new Set(p.hidden);
        const now = new Set(s.hidden);
        const hid = s.hidden.filter((id) => !was.has(id));
        const back = p.hidden.filter((id) => !now.has(id));
        if (hid.length) log('view', `Hid ${describeIds(s.model, hid)} (${s.hidden.length} hidden in all)`);
        if (back.length) log('view', `Unhid ${describeIds(s.model, back)} (${s.hidden.length} still hidden)`);
      }
    }
    if (s.toast && s.toast !== p.toast) log('message', s.toast, /error|fail|cannot|invalid/i.test(s.toast) ? 'error' : 'info');
    if (s.selection !== p.selection && (s.selection.length || p.selection.length)) {
      clearTimeout(selTimer);
      selTimer = window.setTimeout(() => {
        const st = useApp.getState();
        log('select', st.selection.length ? `Selected ${describeIds(st.model, st.selection)}` : 'Selection cleared');
      }, 250);
    }
  });

  useDialog.subscribe((s, p) => {
    if (s.d && s.d !== p.d) log('dialog', `Opened ${DIALOG_NAMES[s.d.kind] ?? s.d.kind} dialog`);
    else if (!s.d && p.d) log('dialog', `Closed ${DIALOG_NAMES[p.d.kind] ?? p.d.kind} dialog`);
  });

  window.addEventListener('error', (e) => log('error', e.message || String(e.error), 'error'));
  window.addEventListener('unhandledrejection', (e) => log('error', e.reason?.message ?? String(e.reason), 'error'));
}
