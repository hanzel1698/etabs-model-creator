// Sink and upstand dialogs for the bathroom section check (app-only; nothing here reaches ETABS).
import { useEffect, useState } from 'react';
import { Modal } from '../ui/Dialogs';
import { closeDialog, useFramePick } from '../ui/dialogState';
import { endFramePick, picking, startFramePick } from '../plan/tools';
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
  const hidden = useFramePick((s) => !!s.done);
  // closing the dialog some other way while picking must not leave the plan in pick mode
  useEffect(() => () => void (picking() && endFramePick()), []);
  // the picker reads the nearest selected beam, so this beam alone is selected (and must be on the plan's story)
  const pick = (set: (v: string) => void, hint: string, then?: () => void) => {
    const st = useApp.getState();
    if (b && b.story !== st.activeStory) st.setActiveStory(b.story);
    st.setSelection([beamId]);
    startFramePick((tt, len) => (set(String(Math.round(tt * len))), then?.()), hint);
  };
  const pickFrom = (then?: () => void) => pick(setFrom, 'Upstand start: click where it begins along the beam.', then);
  const pickTo = () => pick(setTo, 'Upstand end: click where it stops along the beam.');
  const pickBtn = (run: () => void, what: string) => (
    <button title={`Pick on plan: click a point along the beam; its distance from the beam start fills ${what}`} onClick={run}>
      ⌖ Pick
    </button>
  );
  const save = () => {
    useApp.getState().commit((mm) => addUpstand(mm, beamId, f / L, t / L, d));
    closeDialog();
  };
  return (
    <Modal
      hidden={hidden}
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
      <div className="small muted">A nib cast on top of the beam, for the bathroom section check only (not pushed to ETABS). All values in mm; From and To are measured from the beam's start (it is {fmt(L)} mm long).</div>
      <div className="row"><span id="up-from">From</span><input aria-labelledby="up-from" type="number" autoFocus value={from} onChange={(e) => setFrom(e.target.value)} />{pickBtn(() => pickFrom(), 'From')}</div>
      <div className="row"><span id="up-to">To</span><input aria-labelledby="up-to" type="number" value={to} onChange={(e) => setTo(e.target.value)} />{pickBtn(pickTo, 'To')}</div>
      <div className="row"><span /><button title="Pick on plan: click the start, then the end, along the beam" onClick={() => pickFrom(pickTo)}>⌖ Pick start and end</button></div>
      <label className="row"><span>Height</span><input type="number" value={depth} onChange={(e) => setDepth(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && save()} /></label>
    </Modal>
  );
}
