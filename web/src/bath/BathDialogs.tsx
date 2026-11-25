// Sink and upstand dialogs for the bathroom section check (app-only; nothing here reaches ETABS).
import { useState } from 'react';
import { Modal } from '../ui/Dialogs';
import { closeDialog } from '../ui/dialogState';
import { useApp } from '../model/store';
import { fmt } from '../model/geom';
import { addUpstand, removeUpstands, setBeamSink, setSlabSink } from './sections';

export function SinkDialog({ target, ids }: { target: 'beam' | 'slab'; ids: string[] }) {
  const m = useApp((s) => s.model);
  const items = target === 'beam' ? m.beams.filter((b) => ids.includes(b.id)) : m.slabs.filter((s) => ids.includes(s.id));
  const cur = new Set(items.map((x) => x.sink ?? 0));
  const [v, setV] = useState(cur.size === 1 ? String([...cur][0]) : '');
  const n = Number(v);
  const ok = v.trim() !== '' && Number.isFinite(n);
  const save = () => {
    useApp.getState().commit((mm) => (target === 'beam' ? setBeamSink(mm, ids, n) : setSlabSink(mm, ids, n)));
    closeDialog();
  };
  const what = `${items.length} ${target}${items.length === 1 ? '' : 's'}`;
  return (
    <Modal title={`Bathroom sink: ${what}`} footer={<><button onClick={closeDialog}>Cancel</button><button className="primary" disabled={!ok} onClick={save}>Set</button></>}>
      <div className="small muted">How far the top sits below the story level, for the bathroom section check only. Not pushed to ETABS. 0 is flush; negative is an upstand above the level.</div>
      <label className="row">
        <span>Sink (mm)</span>
        <input type="number" autoFocus value={v} placeholder={cur.size > 1 ? 'varies' : ''} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && save()} />
      </label>
    </Modal>
  );
}

export function UpstandDialog({ beamId }: { beamId: string }) {
  const m = useApp((s) => s.model);
  const b = m.beams.find((x) => x.id === beamId);
  const L = b ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) : 0;
  const has = (m.upstands ?? []).filter((u) => u.beamId === beamId);
  const [from, setFrom] = useState('0');
  const [to, setTo] = useState(String(Math.round(L)));
  const [depth, setDepth] = useState('150');
  const [f, t, d] = [Number(from), Number(to), Number(depth)];
  const ok = L > 0 && d > 0 && Number.isFinite(f) && Number.isFinite(t) && Math.abs(t - f) > 0;
  const save = () => {
    useApp.getState().commit((mm) => addUpstand(mm, beamId, f / L, t / L, d));
    closeDialog();
  };
  return (
    <Modal
      title={`Upstand on ${b?.section ?? 'beam'}`}
      footer={
        <>
          {has.length > 0 && (
            <button className="danger" onClick={() => (useApp.getState().commit((mm) => removeUpstands(mm, beamId)), closeDialog())}>
              Remove {has.length} upstand{has.length === 1 ? '' : 's'}
            </button>
          )}
          <button onClick={closeDialog}>Cancel</button>
          <button className="primary" disabled={!ok} onClick={save}>Add</button>
        </>
      }
    >
      <div className="small muted">A nib cast on top of the beam, for the bathroom section check only (not pushed to ETABS). Distances are from the beam's start; the beam is {fmt(L)} mm long.</div>
      <label className="row"><span>From (mm)</span><input type="number" autoFocus value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="row"><span>To (mm)</span><input type="number" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label className="row"><span>Height (mm)</span><input type="number" value={depth} onChange={(e) => setDepth(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && save()} /></label>
    </Modal>
  );
}
