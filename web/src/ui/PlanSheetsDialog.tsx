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
  // '' = per-drawing suggestion (the orientation that gives the larger plan)
  const [orient, setOrient] = useState<'' | Orient>('');
  const [picked, setPicked] = useState<boolean[]>(() => drawings.map(() => true));
  const [busy, setBusy] = useState(false);
  const items = drawings.map((item) => ({ item, o: orient || suggestOrient(item) })).filter((_, i) => picked[i] ?? true);
  const titles = [...new Set(drawings.map((d) => d.title))];
  const regions = [...new Set(drawings.map((d) => d.region))];
  const pages = paginate(items).length;
  // apply f to every drawing, or only to drawings with title t
  const pick = (f: (v: boolean) => boolean, t?: string) => setPicked(drawings.map((d, i) => (t === undefined || d.title === t ? f(picked[i] ?? true) : picked[i] ?? true)));

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
        Two A3 drawings per A2 page: landscape A3s stacked on a portrait A2, portrait A3s side by side on a landscape A2. Auto picks, per drawing, the orientation that gives the larger plan.
        {u.kind === 'pdf' && ' The PDF underlay is not exported; only a DXF underlay is drawn.'}
      </div>
      {drawings.length ? (
        <>
          <div className="row">
            <button onClick={() => pick(() => true)}>Select all</button>
            <button onClick={() => pick(() => false)}>None</button>
            <button onClick={() => pick((v) => !v)}>Invert</button>
            <span className="small muted">{items.length} of {drawings.length} selected</span>
          </div>
          <table className="grid sheet-matrix">
            <thead>
              <tr>
                {titles.map((t) => (
                  <th key={t}>
                    {t}
                    <div className="sheet-col-btns">
                      <button onClick={() => pick(() => true, t)}>All</button>
                      <button onClick={() => pick(() => false, t)}>None</button>
                      <button onClick={() => pick((v) => !v, t)}>Invert</button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r}>
                  {titles.map((t) => {
                    const i = drawings.findIndex((d) => d.title === t && d.region === r);
                    return (
                      <td key={t}>
                        {i >= 0 && (
                          <label>
                            <input type="checkbox" checked={picked[i] ?? true} onChange={(e) => setPicked(drawings.map((_, j) => (j === i ? e.target.checked : picked[j] ?? true)))} /> {r}
                          </label>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <label className="sheet-orient">
            A3 orientation
            <select value={orient} onChange={(e) => setOrient(e.target.value as '' | Orient)}>
              <option value="">Auto (per drawing)</option>
              <option value="L">Landscape</option>
              <option value="P">Portrait</option>
            </select>
          </label>
        </>
      ) : (
        <div className="muted small">No beams or slabs to draw yet.</div>
      )}
    </Modal>
  );
}
