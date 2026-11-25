// The Section view: one bathroom section cut, drawn, with its two-face catch check beside it.
import { useMemo, useState } from 'react';
import { useApp } from '../model/store';
import { openDialog } from '../ui/dialogState';
import { cutSection, mirrorRun, shouldMirrorForDisplay } from './engine/cut';
import { checkRun } from './engine/checks';
import { toPlanModel, toSectionLine } from './toPlan';
import { patchSection, removeSection, useBath } from './sections';
import { SectionView } from './SectionView';
import { ResultsPanel } from './ResultsPanel';
import { sectionPdf } from './sectionPdf';
import { pickExportFolder, writeToFolder } from '../model/persist';
import { toast } from '../model/store';
import { log } from '../log/sessionLog';

const EXAGGERATIONS = [1, 2, 5];

export function SectionPane() {
  const model = useApp((s) => s.model);
  // only the sections ticked in the right panel's Bath sections list
  const all = model.sectionLines ?? [];
  const cuts = all.filter((c) => !c.hidden);
  const activeId = useBath((s) => s.active);
  const cut = cuts.find((c) => c.id === activeId) ?? cuts[cuts.length - 1] ?? null;
  const [ex, setEx] = useState(1);
  const [busy, setBusy] = useState(false);

  const story = cut?.story;
  const sp = useMemo(() => (story ? toPlanModel(model, story) : null), [model, story]);
  const run = useMemo(() => {
    if (!cut || !sp) return null;
    const line = toSectionLine(cut, sp.origin);
    const r = cutSection(sp.plan, line);
    return shouldMirrorForDisplay(line) ? mirrorRun(r) : r;
  }, [cut, sp]);
  const checks = useMemo(() => (sp && run ? checkRun(sp.plan, run) : []), [sp, run]);

  if (!cut || !sp || !run)
    return (
      <div className="bath-pane">
        <p className="muted bath-empty">
          {all.length ? (
            <>{all.length === 1 ? 'The bathroom section is' : `All ${all.length} bathroom sections are`} hidden. Tick the ones to see in <b>Bath sections</b> in the right panel.</>
          ) : (
            <>No bathroom sections yet. Pick <b>Bath section</b> (X) and click the two ends of a cut on a story plan.</>
          )}
        </p>
      </div>
    );

  const commit = useApp.getState().commit;
  const remove = () => {
    const i = cuts.indexOf(cut);
    commit((m) => removeSection(m, cut.id));
    useBath.getState().setActive(cuts[i + 1]?.id ?? cuts[i - 1]?.id ?? null);
  };
  const exportPdf = async () => {
    setBusy(true);
    try {
      // pick before building the PDF: the folder picker needs the click's user activation
      const dir = await pickExportFolder();
      if (dir === undefined) return;
      const doc = await sectionPdf({ plan: sp.plan, run, checks, label: cut.label, story: cut.story, exaggeration: ex });
      const name = `section-${cut.label}-${cut.story}.pdf`.replace(/[\/:*?"<>|\s]+/g, '_');
      if (dir) await writeToFolder(dir, name, doc.output('blob'));
      else doc.save(name);
      log('file', `Exported ${name}${dir ? ` to ${dir.name}` : ''}`);
      toast(`Saved ${name}${dir ? ` in ${dir.name}` : ''}`);
    } catch (e) {
      toast(`PDF export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="bath-pane">
      <div className="bath-drawing">
        <div className="bar">
          <label>
            <span className="muted">Section </span>
            <select value={cut.id} onChange={(e) => useBath.getState().setActive(e.target.value)}>
              {cuts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {c.story}
                </option>
              ))}
            </select>
          </label>
          <span className="seg" role="group" aria-label="Level exaggeration">
            {EXAGGERATIONS.map((x) => (
              <button key={x} className={ex === x ? 'on' : ''} onClick={() => setEx(x)} title="Exaggerate levels (the drawing only; numbers are untouched)">
                {x}×
              </button>
            ))}
          </span>
          <button title="Flip which way the section is viewed" onClick={() => commit((m) => patchSection(m, cut.id, { reversed: !cut.reversed || undefined }))}>
            Flip view ⇆
          </button>
          <button disabled={busy} title="Export this section and its catch check as an A3 PDF (vector)" onClick={exportPdf}>
            {busy ? 'Exporting…' : 'Export PDF'}
          </button>
          <button className="danger" onClick={remove}>Delete</button>
          <span className="muted small">Right-click a beam to set its sink</span>
        </div>
        <SectionView model={sp.plan} run={run} checks={checks} exaggeration={ex} onEditBeamSink={(id) => openDialog({ kind: 'bathSink', target: 'beam', ids: [id] })} />
      </div>
      <ResultsPanel checks={checks} run={run} />
    </div>
  );
}
