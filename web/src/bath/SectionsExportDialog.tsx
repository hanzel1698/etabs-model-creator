// File > Export Bathroom Sections: tick the saved section cuts and get them all in one PDF (one A4, else A3 sheets).
import { useState } from 'react';
import { Modal } from '../ui/Dialogs';
import { closeDialog } from '../ui/dialogState';
import { useApp, toast } from '../model/store';
import { log } from '../log/sessionLog';
import { pickExportFolder, writeToFolder } from '../model/persist';
import { sectionsPdf, sheetFor } from './sectionPdf';

export function SectionsExportDialog() {
  const model = useApp((s) => s.model);
  const cuts = model.sectionLines ?? [];
  // start with the sections ticked in the right panel's Bath sections list
  const [picked, setPicked] = useState<boolean[]>(() => cuts.map((c) => !c.hidden));
  const [ex, setEx] = useState(1);
  const [busy, setBusy] = useState(false);
  const chosen = cuts.filter((_, i) => picked[i] ?? true);

  const run = async () => {
    setBusy(true);
    try {
      // pick before building the PDF: the picker needs the click's user activation
      const dir = await pickExportFolder();
      if (dir === undefined) return;
      const { doc, paper, pages } = await sectionsPdf(chosen.map((c) => sheetFor(model, c, ex)));
      const name = 'bathroom-sections.pdf';
      if (dir) await writeToFolder(dir, name, doc.output('blob'));
      else doc.save(name);
      const what = `${chosen.length} section${chosen.length === 1 ? '' : 's'} on ${pages} ${paper} page${pages === 1 ? '' : 's'}`;
      log('file', `Exported ${name}${dir ? ` to ${dir.name}` : ''} (${what})`);
      toast(`Saved ${name}: ${what}`);
      closeDialog();
    } catch (e) {
      toast(`PDF export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export bathroom sections (PDF)"
      footer={
        <>
          <button onClick={closeDialog}>Cancel</button>
          <button className="primary" disabled={busy || !chosen.length} onClick={run}>
            {busy ? 'Exporting…' : `Export ${chosen.length} section${chosen.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="small muted">All ticked sections go on one sheet: an A4 if they fit, otherwise an A3, otherwise as many A3 sheets as needed.</div>
      {cuts.length ? (
        <>
          <div className="row">
            <button onClick={() => setPicked(cuts.map(() => true))}>Select all</button>
            <button onClick={() => setPicked(cuts.map(() => false))}>None</button>
            <button onClick={() => setPicked(cuts.map((_, i) => !(picked[i] ?? true)))}>Invert</button>
            <span className="small muted">{chosen.length} of {cuts.length} selected</span>
          </div>
          <div className="bath-export-list">
            {cuts.map((c, i) => (
              <label key={c.id}>
                <input type="checkbox" checked={picked[i] ?? true} onChange={(e) => setPicked(cuts.map((_, j) => (j === i ? e.target.checked : picked[j] ?? true)))} /> {c.label} <span className="muted">· {c.story}</span>
              </label>
            ))}
          </div>
          <label className="sheet-orient">
            Level exaggeration
            <select value={ex} onChange={(e) => setEx(Number(e.target.value))}>
              {[1, 2, 5].map((x) => (
                <option key={x} value={x}>{x}×</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="muted small">No bathroom sections yet. Pick the Cut section tool (X) and click the two ends of a cut on a story plan.</div>
      )}
    </Modal>
  );
}
