import { lazy, memo, Suspense, useEffect, useRef } from 'react';
import { useApp, usePreview } from './model/store';
import { PlanView, fitAll } from './plan/PlanView';
import { setTool, onCancel, onInput, finishPolygon, resetTool } from './plan/tools';
import { LeftPanel } from './ui/LeftPanel';
import { RightPanel } from './ui/RightPanel';
import { Dialogs } from './ui/Dialogs';
import { openDialog } from './ui/dialogState';
import { deleteIds } from './model/ops';
import { restoreModel, startAutosave, downloadProject, openProject } from './model/persist';
import { loadDxfFile, loadPdfFile, restoreUnderlay } from './underlay/store';
import { columnOn, emptyModel } from './model/types';
import { fmt } from './model/geom';
import { startSessionLog, log, toggleLog, useLog } from './log/sessionLog';
import { LogPanel } from './ui/LogPanel';
import { IssueBadge, watchIssues } from './ui/Checks';
import { ElevView } from './elev/ElevView';
import { PatternPicker } from './ui/LoadDialogs';
import { MainMenu, TOOLS, MEASURE } from './ui/MenuBar';

const View3D = lazy(() => import('./view3d/View3D'));

const VIEWS = [
  { p: 'plan', label: 'Plan' },
  { p: 'split', label: 'Split' },
  { p: '3d', label: '3D' },
  { p: 'elev', label: 'Elev', title: 'Elevation along a grid line' },
] as const;

export function App() {
  const tool = useApp((s) => s.tool);
  const panel = useApp((s) => s.panel);
  const toast = useApp((s) => s.toast);
  const ortho = useApp((s) => s.ortho);
  const fileRef = useRef<HTMLInputElement>(null);
  const ulRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    startSessionLog();
    const unwatch = watchIssues();
    (async () => {
      await restoreModel();
      await restoreUnderlay();
      startAutosave();
      requestAnimationFrame(() => fitAll());
    })();
    return unwatch;
  }, []);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
      const st = useApp.getState();
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !inInput) return e.preventDefault(), st.undo();
      if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')) && !inInput) return e.preventDefault(), st.redo();
      if (e.ctrlKey && e.key.toLowerCase() === 's') return e.preventDefault(), downloadProject();
      if (e.ctrlKey && e.key.toLowerCase() === 'p' && !inInput) return e.preventDefault(), st.restoreSelection();
      if (e.key === 'F8') return e.preventDefault(), st.toggleOrtho();
      if (e.key === '`' && !inInput) return e.preventDefault(), toggleLog();
      if (e.key === 'Escape') {
        (document.activeElement as HTMLElement)?.blur?.();
        usePreview.getState().set({ input: '' });
        return onCancel();
      }
      if (inInput) return;
      if (e.key === 'Delete' && st.selection.length) {
        st.commit((m) => deleteIds(m, st.selection));
        st.setSelection([]);
        return;
      }
      if (e.key === 'Enter') {
        if (st.tool === 'slabDraw' || st.tool === 'area') finishPolygon();
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      // typing a number/@ starts the command line
      if (/^[\d@.\-]$/.test(e.key) && st.tool !== 'select') {
        e.preventDefault();
        usePreview.getState().set({ input: e.key });
        document.getElementById('cmd')?.focus();
        return;
      }
      const k = e.key.toUpperCase();
      const hit = [...TOOLS, ...MEASURE].find((x) => x.key === k);
      if (hit) return setTool(hit.t);
      if (k === 'F') return fitAll();
      if (k === 'E' && st.selection.length) return openDialog({ kind: 'replicate' });
      if (k === 'H' && st.selection.length) return st.hideIds(st.selection);
      if (k === 'I' && st.selection.length) return st.showOnlyIds(st.selection);
      if (k === 'U') return st.showAll();
    };
    window.addEventListener('keydown', kd);
    return () => window.removeEventListener('keydown', kd);
  }, []);

  const loadUnderlay = async (f: File) => {
    log('file', `Underlay ${f.name}`);
    try {
      if (/\.dxf$/i.test(f.name)) await loadDxfFile(f);
      else if (/\.pdf$/i.test(f.name)) await loadPdfFile(f, useApp.getState().model.stories.map((s) => s.name));
      else throw new Error('Choose a .dxf or .pdf file');
      useApp.getState().setToast(/\.dxf$/i.test(f.name) ? 'DXF loaded. Use “Define story region” to box each story plan.' : 'PDF loaded. Assign pages to stories, then calibrate each page.');
      openDialog({ kind: 'underlay' });
      requestAnimationFrame(() => fitAll());
    } catch (e: any) {
      useApp.getState().setToast('Underlay error: ' + e.message);
    }
  };

  return (
    <div className="app">
      <div className="topbar">
        <MainMenu
          onNew={() => confirm('Start a new model? Unsaved work is lost.') && (log('file', 'New model'), useApp.getState().setModel(emptyModel()), resetTool())}
          onOpen={() => fileRef.current?.click()}
          onUnderlay={() => ulRef.current?.click()}
        />
        <div className="toolbar">
          {TOOLS.map((x) => (
            <button key={x.t} className={'tool ' + (tool === x.t ? 'on' : '')} onClick={() => setTool(x.t)} title={`${x.label} (${x.key})`}>
              {x.label} <kbd>{x.key}</kbd>
            </button>
          ))}
          <span className="sep" />
          {MEASURE.map((x) => (
            <button key={x.t} className={'tool ' + (tool === x.t ? 'on' : '')} onClick={() => setTool(x.t)} title={`${x.label} (${x.key})`}>
              {x.label}
            </button>
          ))}
          <span className="sep hist" />
          <button className="hist" onClick={() => useApp.getState().undo()} title="Undo (Ctrl+Z)">Undo</button>
          <button className="hist" onClick={() => useApp.getState().redo()} title="Redo (Ctrl+Y)">Redo</button>
          <span className="spacer" />
          <StoryStepper />
          <span className="seg" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.p} className={panel === v.p ? 'on' : ''} onClick={() => useApp.getState().setPanel(v.p)} title={'title' in v ? v.title : undefined}>
                {v.label}
              </button>
            ))}
          </span>
          <PatternPicker />
          <button className="primary" onClick={() => openDialog({ kind: 'etabs' })}>ETABS…</button>
        </div>
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) log('file', `Open ${f.name}`), openProject(f).then(() => fitAll()).catch((er) => useApp.getState().setToast(er.message));
          }} />
        <input ref={ulRef} type="file" accept=".dxf,.pdf" hidden onChange={(e) => (e.target.files?.[0] && loadUnderlay(e.target.files[0]), (e.target.value = ''))} />
      </div>

      <LeftPanel />
      <div className="main">
        {(panel === 'plan' || panel === 'split') && <PlanView />}
        {panel === 'elev' && <ElevView />}
        {(panel === '3d' || panel === 'split') && (
          <Suspense fallback={<div className="view3d muted" style={{ padding: 20 }}>Loading 3D…</div>}>
            <View3D />
          </Suspense>
        )}
        {toast && <div className="toast">{toast}</div>}
        <MeasureBox />
        <LogPanel />
      </div>
      <RightPanel />
      <StatusBar ortho={ortho} />
      <Dialogs />
    </div>
  );
}

/** Step the active story up or down (stories are stored bottom to top). */
function StoryStepper() {
  const stories = useApp((s) => s.model.stories);
  const active = useApp((s) => s.activeStory);
  const i = stories.findIndex((s) => s.name === active);
  const up = stories[i + 1]?.name,
    down = i > 0 ? stories[i - 1].name : undefined;
  return (
    <>
      <button disabled={!up} onClick={() => up && useApp.getState().setActiveStory(up)} title={up ? `Story up: ${up}` : 'Top story'}>▲</button>
      <button disabled={!down} onClick={() => down && useApp.getState().setActiveStory(down)} title={down ? `Story down: ${down}` : 'Bottom story'}>▼</button>
      <span className="story-step">{active}</span>
    </>
  );
}

function MeasureBox() {
  const m = usePreview((s) => s.measure);
  if (!m?.text) return null;
  return <div className="measure-box">{m.text}</div>;
}

/** Element counts on the active story, with model totals. Kept apart from the status bar so it only re-renders on model changes. */
const Counts = memo(function Counts({ story }: { story: string }) {
  const m = useApp((s) => s.model);
  const n = (arr: { story: string }[]) => [arr.filter((x) => x.story === story).length, arr.length];
  const [c, ct] = [m.columns.filter((x) => columnOn(m, x, story)).length, m.columns.length],
    [b, bt] = n(m.beams),
    [s, st] = n(m.slabs);
  return (
    <span className="counts" title={`Totals in the model: ${ct} columns, ${bt} beams, ${st} slabs`}>
      <b>{story}</b>
      <span>Columns {c}</span>
      <span>Beams {b}</span>
      <span>Slabs {s}</span>
      <span className="muted">· all stories {ct} / {bt} / {st}</span>
    </span>
  );
});

function LogButton() {
  const open = useLog((s) => s.open);
  const n = useLog((s) => s.entries.length);
  return (
    <button className={open ? 'on' : ''} onClick={toggleLog} title="Session log of everything done since the app was opened (`)">
      Log <span className="muted">{n}</span>
    </button>
  );
}

function StatusBar({ ortho }: { ortho: boolean }) {
  const hint = usePreview((s) => s.hint);
  const input = usePreview((s) => s.input);
  const cursor = usePreview((s) => s.snap?.p ?? s.cursor);
  const story = useApp((s) => s.activeStory);
  return (
    <div className="status">
      <div className="cmd">
        <span className="muted">Input</span>
        <input
          id="cmd"
          type="text"
          value={input}
          placeholder="dx,dy  @d<a  length"
          onChange={(e) => usePreview.getState().set({ input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (input.trim()) log('input', input.trim());
              onInput(input);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      <span className="hint">{hint}</span>
      <button className={ortho ? 'on' : ''} onClick={() => useApp.getState().toggleOrtho()} title="F8">Ortho</button>
      <IssueBadge />
      <Counts story={story} />
      <LogButton />
      <span className="coords">{cursor ? `X ${fmt(cursor.x)}  Y ${fmt(cursor.y)} mm` : ''}</span>
    </div>
  );
}
