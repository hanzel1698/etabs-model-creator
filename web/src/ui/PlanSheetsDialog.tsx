import { useMemo, useState } from 'react';
import { Modal } from './Dialogs';
import { closeDialog } from './dialogState';
import { useApp, toast } from '../model/store';
import { useUnderlay } from '../underlay/store';
import { log } from '../log/sessionLog';
import { buildDrawings, paginate, suggestOrient, type Orient } from '../export/sheets';
import { plansPdf } from '../export/pdf';

/** Export framing, column layout, line-load and shell-load plans of every story region as an A2 PDF. */
export function PlanSheetsDialog() {
  const model = useApp((s) => s.model);
  const u = useUnderlay();
  const drawings = useMemo(() => buildDrawings(model, { dxf: u.kind === 'dxf' ? u.dxf : null, regions: u.regions, showText: u.showText }), [model, u.dxf, u.kind, u.regions, u.showText]);
  const [orient, setOrient] = useState<Orient[]>(() => drawings.map(suggestOrient));
  const [picked, setPicked] = useState<boolean[]>(() => drawings.map(() => true));
  const [busy, setBusy] = useState(false);
  const items = drawings.map((item, i) => ({ item, o: orient[i] ?? 'L' })).filter((_, i) => picked[i] ?? true);
  const pages = paginate(items).length;

  const run = async () => {
    setBusy(true);
    try {
      const doc = await plansPdf(items);
      doc.save('plan-sheets.pdf');
      log('file', `Exported plan-sheets.pdf (${items.length} drawings on ${pages} A2 pages)`);
      closeDialog();
    } catch (e) {
      toast(`PDF export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Export plan sheets (A2 PDF)"
      wide
      footer={
        <>
          <button onClick={closeDialog}>Cancel</button>
          <button className="primary" disabled={busy || !items.length} onClick={run}>
            {busy ? 'Exporting…' : `Export ${pages} page${pages === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <div className="small muted">
        Two A3 drawings per A2 page: landscape A3s stacked on a portrait A2, portrait A3s side by side on a landscape A2. Each row starts with the orientation that gives the larger plan.
        {u.kind === 'pdf' && ' The PDF underlay is not exported; only a DXF underlay is drawn.'}
      </div>
      {drawings.length ? (
        <>
        <div className="row">
          <button onClick={() => setPicked(drawings.map(() => true))}>Select all</button>
          <button onClick={() => setPicked(drawings.map(() => false))}>None</button>
          <button onClick={() => setPicked(drawings.map((_, i) => !(picked[i] ?? true)))}>Invert</button>
          <span className="small muted">{items.length} of {drawings.length} selected</span>
        </div>
        <table className="grid">
          <thead>
            <tr><th></th><th>Drawing</th><th>Story region</th><th>A3</th></tr>
          </thead>
          <tbody>
            {drawings.map((d, i) => (
              <tr key={i}>
                <td>
                  <input type="checkbox" aria-label={`Export ${d.title} – ${d.region}`} checked={picked[i] ?? true} onChange={(e) => setPicked(drawings.map((_, j) => (j === i ? e.target.checked : picked[j] ?? true)))} />
                </td>
                <td>{d.title}</td>
                <td>{d.region}</td>
                <td>
                  <select value={orient[i]} onChange={(e) => setOrient(orient.map((o, j) => (j === i ? (e.target.value as Orient) : o)))}>
                    <option value="L">Landscape</option>
                    <option value="P">Portrait</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      ) : (
        <div className="muted small">No beams or slabs to draw yet.</div>
      )}
    </Modal>
  );
}
