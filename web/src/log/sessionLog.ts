import { create } from 'zustand';
import { useApp } from '../model/store';
import { useDialog } from '../ui/dialogState';
import type { Model } from '../model/types';

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

/** "on Story2 (B300x500)": the stories and section shared by the items, if few enough to name. */
function where(items: Keyed[]) {
  const st = [...new Set(items.map((x) => x.story).filter(Boolean))];
  const sec = [...new Set(items.map((x) => x.section).filter(Boolean))];
  return (st.length ? ` on ${st.length <= 3 ? st.join(', ') : plural(st.length, 'story')}` : '') + (sec.length === 1 ? ` (${sec[0]})` : '');
}

function diffList<T extends Keyed>(a: T[], b: T[], word: string, key: (x: T) => string): string[] {
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
  const names = (l: T[]) => (l.length <= 5 && l[0]?.name !== undefined ? ': ' + l.map((x) => x.name).join(', ') : '');
  if (added.length) out.push(`+${plural(added.length, word)}${where(added)}${names(added)}`);
  if (removed.length) out.push(`−${plural(removed.length, word)}${where(removed)}${names(removed)}`);
  if (changed.length) out.push(`~${plural(changed.length, word)} changed${where(changed)}${names(changed)}`);
  return out;
}

/** Human summary of what changed between two models, one line per kind of change. */
export function diffModel(a: Model, b: Model): string[] {
  const id = (x: { id: string }) => x.id;
  const name = (x: { name: string }) => x.name;
  const out = [
    ...diffList(a.grids, b.grids, 'grid', id),
    ...diffList(a.columns, b.columns, 'column', id),
    ...diffList(a.beams, b.beams, 'beam', id),
    ...diffList(a.slabs, b.slabs, 'slab', id),
    ...diffList(a.stories, b.stories, 'story', name),
    ...diffList(a.frameSections, b.frameSections, 'frame section', name),
    ...diffList(a.slabSections, b.slabSections, 'slab section', name),
    ...diffList(a.materials, b.materials, 'material', name),
  ];
  if (a.stories !== b.stories && a.stories.map(name).join() === b.stories.map(name).join() && !out.some((s) => s.includes('stor'))) out.push('stories reordered');
  if (a.baseElevation !== b.baseElevation) out.push(`base elevation ${a.baseElevation} → ${b.baseElevation}`);
  if (JSON.stringify(a.foundation) !== JSON.stringify(b.foundation)) out.push('foundation inputs changed');
  if (a.pushedIds !== b.pushedIds && !out.length) out.push(`${plural(b.pushedIds.length, 'element')} marked as pushed to ETABS`);
  return out;
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
        log('model', `Model loaded: ${plural(m.stories.length, 'story')}, ${plural(m.grids.length, 'grid')}, ${plural(m.columns.length, 'column')}, ${plural(m.beams.length, 'beam')}, ${plural(m.slabs.length, 'slab')}`);
      else {
        const how = m === p.past[p.past.length - 1] ? 'Undo: ' : m === p.future[0] ? 'Redo: ' : '';
        const d = diffModel(p.model, m);
        log('model', how + (d.length ? d.join('; ') : 'no element changes'));
      }
    }
    if (s.tool !== p.tool) log('tool', s.tool);
    if (s.activeStory !== p.activeStory) log('view', `Active story ${s.activeStory}`);
    if (s.alsoStories !== p.alsoStories) log('view', s.alsoStories.length ? `Also drawing on ${s.alsoStories.join(', ')}` : 'Drawing on active story only');
    if (s.panel !== p.panel) log('view', `Panel ${s.panel}`);
    if (s.ortho !== p.ortho) log('setting', `Ortho ${s.ortho ? 'on' : 'off'}`);
    if (s.autoBeam !== p.autoBeam) log('setting', `Auto beam size ${s.autoBeam ? 'on' : 'off'}`);
    if (s.colorBySection !== p.colorBySection) log('setting', `Colour by section ${s.colorBySection ? 'on' : 'off'}`);
    if (s.active !== p.active)
      for (const k of ['column', 'beam', 'slab'] as const) if (s.active[k] !== p.active[k]) log('setting', `Active ${k} section ${s.active[k]}`);
    if (s.show !== p.show)
      for (const k of Object.keys(s.show) as (keyof typeof s.show)[]) if (s.show[k] !== p.show[k]) log('view', `Show ${k} ${s.show[k] ? 'on' : 'off'}`);
    if (s.hidden !== p.hidden && (s.hidden.length || p.hidden.length)) log('view', s.hidden.length ? `${plural(s.hidden.length, 'element')} hidden` : 'All elements shown');
    if (s.toast && s.toast !== p.toast) log('message', s.toast, /error|fail|cannot|invalid/i.test(s.toast) ? 'error' : 'info');
    if (s.selection !== p.selection && (s.selection.length || p.selection.length)) {
      clearTimeout(selTimer);
      selTimer = window.setTimeout(() => {
        const st = useApp.getState();
        const sel = new Set(st.selection);
        if (!sel.size) return log('select', 'Selection cleared');
        const parts = (['columns', 'beams', 'slabs', 'grids'] as const).map((k) => plural(st.model[k].filter((x) => sel.has(x.id)).length, k.slice(0, -1))).filter((x) => !x.startsWith('0 '));
        log('select', `Selected ${parts.join(', ')}`);
      }, 250);
    }
  });

  useDialog.subscribe((s, p) => {
    if (s.d && s.d !== p.d) log('dialog', `Opened ${s.d.kind}`);
    else if (!s.d && p.d) log('dialog', `Closed ${p.d.kind}`);
  });

  window.addEventListener('error', (e) => log('error', e.message || String(e.error), 'error'));
  window.addEventListener('unhandledrejection', (e) => log('error', e.reason?.message ?? String(e.reason), 'error'));
}
