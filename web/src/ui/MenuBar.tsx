import { useEffect, useRef, useState } from 'react';
import { useApp, COLOR_BY, type ToolName } from '../model/store';
import { setTool } from '../plan/tools';
import { fitAll } from '../plan/PlanView';
import { downloadProject } from '../model/persist';
import { deleteIds } from '../model/ops';
import { toggleLog, useLog } from '../log/sessionLog';
import { openDialog } from './dialogState';
import { activePattern, useLoadTargets } from './LoadDialogs';

export const TOOLS: { t: ToolName; label: string; key: string }[] = [
  { t: 'select', label: 'Select', key: 'V' },
  { t: 'grid', label: 'Grid', key: 'G' },
  { t: 'column', label: 'Column', key: 'C' },
  { t: 'beam', label: 'Beam', key: 'B' },
  { t: 'beamOffset', label: 'Offset beam', key: 'O' },
  { t: 'slab', label: 'Slab (bay)', key: 'S' },
  { t: 'slabDraw', label: 'Draw slab', key: 'P' },
];
export const MEASURE: { t: ToolName; label: string; key: string }[] = [
  { t: 'measure', label: 'Distance', key: 'M' },
  { t: 'angle', label: 'Angle', key: 'A' },
  { t: 'area', label: 'Area', key: 'R' },
  { t: 'panel', label: 'Panel Size & Type', key: 'T' },
];

type Entry = { label: string; kbd?: string; run?: () => void; disabled?: boolean; checked?: boolean; title?: string; sub?: Item[] };
type Item = Entry | 'sep';
type Menu = { label: string; items: Item[] };

const Check = () => (
  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
    <path d="M2.5 6.2 5 8.6 9.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Chevron = () => (
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
    <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const live = (items: Item[]) => items.map((x, i) => (x !== 'sep' && !x.disabled ? i : -1)).filter((i) => i >= 0);
const step = (items: Item[], from: number, d: 1 | -1) => {
  const ok = live(items);
  if (!ok.length) return -1;
  const at = ok.indexOf(from);
  return at < 0 ? ok[d > 0 ? 0 : ok.length - 1] : ok[(at + d + ok.length) % ok.length];
};

/** Desktop-style menu bar: click to open, hover to switch, arrows/Enter/Esc while open. */
function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [hi, setHi] = useState(-1);
  const [sub, setSub] = useState<{ at: number; hi: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const state = useRef({ open, hi, sub, menus });
  state.current = { open, hi, sub, menus };

  const close = () => (setOpen(null), setHi(-1), setSub(null));
  const show = (i: number, h = -1) => (setOpen(i), setHi(h), setSub(null));
  const run = (e: Entry) => {
    if (e.disabled || !e.run) return;
    close();
    e.run();
  };

  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    // capture phase on window runs before the app's global shortcuts, so keys stay inside the open menu
    const key = (e: KeyboardEvent) => {
      const { open, hi, sub, menus } = state.current;
      if (open === null) return;
      e.preventDefault();
      e.stopPropagation();
      const items = menus[open].items;
      const cur = items[hi];
      const subItems = sub && (items[sub.at] as Entry).sub!;
      if (e.key === 'Escape') return sub ? setSub(null) : close();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const d = e.key === 'ArrowDown' ? 1 : -1;
        return sub ? setSub({ ...sub, hi: step(subItems!, sub.hi, d) }) : setHi(step(items, hi, d));
      }
      if (e.key === 'ArrowRight') {
        if (!sub && cur && cur !== 'sep' && cur.sub && !cur.disabled) return setSub({ at: hi, hi: step(cur.sub, -1, 1) });
        return show((open + 1) % menus.length, step(menus[(open + 1) % menus.length].items, -1, 1));
      }
      if (e.key === 'ArrowLeft') {
        if (sub) return setSub(null);
        const j = (open - 1 + menus.length) % menus.length;
        return show(j, step(menus[j].items, -1, 1));
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const target = sub ? subItems![sub.hi] : cur;
        if (!target || target === 'sep') return;
        if (!sub && target.sub) return setSub({ at: hi, hi: step(target.sub, -1, 1) });
        return run(target);
      }
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => (window.removeEventListener('mousedown', down), window.removeEventListener('keydown', key, true));
  }, [open === null]);

  const list = (items: Item[], h: number, onHover: (i: number) => void, nested: boolean) => (
    <div className={'menu' + (nested ? ' nested' : '')} role="menu">
      {items.map((x, i) =>
        x === 'sep' ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <div
            key={i}
            role={x.checked !== undefined ? 'menuitemradio' : 'menuitem'}
            aria-checked={x.checked}
            aria-disabled={x.disabled || undefined}
            aria-haspopup={x.sub ? 'menu' : undefined}
            className={'menu-item' + (i === h ? ' hi' : '') + (x.disabled ? ' off' : '')}
            title={x.title}
            onMouseEnter={() => onHover(i)}
            onClick={(e) => (e.stopPropagation(), x.sub ? !x.disabled && setSub({ at: i, hi: -1 }) : run(x))}
          >
            <span className="menu-check">{x.checked && <Check />}</span>
            <span>{x.label}</span>
            <span className="menu-kbd">{x.sub ? <Chevron /> : x.kbd}</span>
            {!nested && x.sub && sub?.at === i && list(x.sub, sub.hi, (j) => setSub({ at: i, hi: j }), true)}
          </div>
        ),
      )}
    </div>
  );

  return (
    <div className="menubar" ref={ref} role="menubar">
      <span className="brand">ETABS Model Creator</span>
      {menus.map((m, i) => (
        <div key={m.label} className="menu-root">
          <button
            className={'menu-top' + (open === i ? ' open' : '')}
            aria-haspopup="menu"
            aria-expanded={open === i}
            onMouseDown={(e) => (e.preventDefault(), open === i ? close() : show(i))}
            onMouseEnter={() => open !== null && open !== i && show(i)}
          >
            {m.label}
          </button>
          {open === i &&
            list(m.items, hi, (j) => {
              setHi(j);
              const x = m.items[j];
              setSub(x !== 'sep' && x.sub && !x.disabled ? { at: j, hi: -1 } : null);
            }, false)}
        </div>
      ))}
    </div>
  );
}

/** The app's main menu. File actions that need the hidden file inputs come in from App. */
export function MainMenu({ onNew, onOpen, onUnderlay }: { onNew: () => void; onOpen: () => void; onUnderlay: () => void }) {
  const tool = useApp((s) => s.tool);
  const panel = useApp((s) => s.panel);
  const ortho = useApp((s) => s.ortho);
  const sel = useApp((s) => s.selection);
  const prevSel = useApp((s) => s.prevSelection.length);
  const hidden = useApp((s) => s.hidden.length);
  const stories = useApp((s) => s.model.stories);
  const active = useApp((s) => s.activeStory);
  const patterns = useApp((s) => s.model.loadPatterns);
  const pat = useApp((s) => activePattern(s));
  const logOpen = useLog((s) => s.open);
  const colorBy = useApp((s) => s.colorBy);
  const { frames, slabs, joints } = useLoadTargets();
  const st = useApp.getState;
  const none = !sel.length;
  const si = stories.findIndex((s) => s.name === active);
  const up = stories[si + 1]?.name,
    down = si > 0 ? stories[si - 1].name : undefined;
  const toolItem = (x: (typeof TOOLS)[number]): Entry => ({ label: x.label, kbd: x.key, checked: tool === x.t, run: () => setTool(x.t) });
  const tools = Object.fromEntries(TOOLS.map((x) => [x.t, toolItem(x)]));
  const view = (p: 'plan' | 'split' | '3d' | 'elev', label: string): Entry => ({ label, checked: panel === p, run: () => st().setPanel(p) });

  const menus: Menu[] = [
    {
      label: 'File',
      items: [
        { label: 'New', run: onNew },
        { label: 'Open…', run: onOpen },
        { label: 'Save', kbd: 'Ctrl+S', run: downloadProject },
        'sep',
        { label: 'Load underlay…', run: onUnderlay, title: 'Load a DXF (all stories in model space) or a PDF (one page per story)' },
        { label: 'Underlay setup…', run: () => openDialog({ kind: 'underlay' }) },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', kbd: 'Ctrl+Z', run: () => st().undo() },
        { label: 'Redo', kbd: 'Ctrl+Y', run: () => st().redo() },
        'sep',
        { label: 'Select by…', run: () => openDialog({ kind: 'selectBy' }) },
        { label: 'Get previous selection', kbd: 'Ctrl+P', disabled: !prevSel, title: 'Bring back the selection before the last click or change replaced it', run: () => st().restoreSelection() },
        { label: 'Replicate…', kbd: 'E', disabled: none, run: () => openDialog({ kind: 'replicate' }) },
        { label: 'Move…', disabled: none, run: () => openDialog({ kind: 'move' }) },
        { label: 'Delete', kbd: 'Del', disabled: none, run: () => (st().commit((m) => deleteIds(m, sel)), st().setSelection([])) },
        'sep',
        { label: 'Hide selected', kbd: 'H', disabled: none, run: () => st().hideIds(sel) },
        { label: 'Show only selected', kbd: 'I', disabled: none, run: () => st().showOnlyIds(sel) },
        { label: 'Show all', kbd: 'U', disabled: !hidden, run: () => st().showAll() },
      ],
    },
    {
      label: 'Draw',
      items: [
        tools.select,
        'sep',
        tools.grid,
        { label: 'Generate grids…', run: () => openDialog({ kind: 'grids' }) },
        'sep',
        tools.column,
        tools.beam,
        tools.beamOffset,
        'sep',
        tools.slab,
        tools.slabDraw,
        'sep',
        { label: 'Stories…', run: () => openDialog({ kind: 'stories' }) },
        { label: 'Reference planes…', title: 'Horizontal planes at any elevation, pushed to ETABS as reference planes', run: () => openDialog({ kind: 'refPlanes' }) },
        { label: 'Sections…', run: () => openDialog({ kind: 'sections' }) },
      ],
    },
    { label: 'Measure', items: MEASURE.map(toolItem) },
    {
      label: 'View',
      items: [
        view('plan', 'Plan'),
        view('split', 'Split (plan + 3D)'),
        view('3d', '3D'),
        view('elev', 'Elevation'),
        'sep',
        { label: 'View by', title: 'Colour columns, beams and slabs in the plan and elevation by…', sub: COLOR_BY.map(([k, l]) => ({ label: l, checked: colorBy === k, run: () => st().setColorBy(k) })) },
        'sep',
        { label: 'Fit all', kbd: 'F', run: () => fitAll() },
        { label: up ? `Story up (${up})` : 'Story up', disabled: !up, run: () => up && st().setActiveStory(up) },
        { label: down ? `Story down (${down})` : 'Story down', disabled: !down, run: () => down && st().setActiveStory(down) },
        'sep',
        { label: 'Ortho', kbd: 'F8', checked: ortho, run: () => st().toggleOrtho() },
        { label: 'Session log', kbd: '`', checked: logOpen, run: toggleLog },
      ],
    },
    {
      label: 'Loads',
      items: [
        { label: 'Load patterns…', run: () => openDialog({ kind: 'loadPatterns' }) },
        { label: 'Active pattern', sub: patterns.map((p) => ({ label: p.name, checked: p.name === pat, run: () => st().setLoadPattern(p.name) })) },
        'sep',
        { label: 'Frame load…', disabled: !frames, title: 'Assign a distributed or point load to the selected beams and columns', run: () => openDialog({ kind: 'frameLoad' }) },
        { label: 'Shell load…', disabled: !slabs, title: 'Assign a uniform load to the selected slabs', run: () => openDialog({ kind: 'shellLoad' }) },
        { label: 'Joint load…', disabled: !joints, title: 'Assign a force or moment to the selected nodes (Alt+drag selects nodes)', run: () => openDialog({ kind: 'jointLoad' }) },
      ],
    },
    { label: 'ETABS', items: [{ label: 'ETABS link…', title: 'Connect to ETABS, push the model or import from it', run: () => openDialog({ kind: 'etabs' }) }] },
  ];
  return <MenuBar menus={menus} />;
}
