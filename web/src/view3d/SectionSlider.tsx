import { useEffect, useRef, useState } from 'react';
import { fmt } from '../model/geom';

export interface Level {
  name: string;
  elev: number; // mm
}

const HIDE_MS = 3500;
const SNAP_PX = 6;
const LABEL_GAP_PX = 12;

// Vertical two-handle range slider over the story elevations. Collapses into a round button
// in the canvas corner when idle; the button lights up while a cut is active.
export default function SectionSlider({ levels, lo, hi, onChange }: { levels: Level[]; lo: number; hi: number; onChange: (lo: number, hi: number) => void }) {
  const [open, setOpen] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<'lo' | 'hi' | null>(null);
  const hover = useRef(false);
  const timer = useRef(0);
  const min = levels[0]?.elev ?? 0;
  const max = levels[levels.length - 1]?.elev ?? 1;
  const span = Math.max(1, max - min);
  const active = lo > min || hi < max;
  const pct = (e: number) => ((max - e) / span) * 100; // % from top

  const scheduleHide = () => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!drag.current && !hover.current) setOpen(false);
    }, HIDE_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (open) scheduleHide();
  }, [open]);

  const elevAt = (clientY: number) => {
    const r = track.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    let e = max - t * span;
    // snap to a story level when close to it
    const pxPerMm = r.height / span;
    for (const l of levels) if (Math.abs(l.elev - e) * pxPerMm < SNAP_PX) e = l.elev;
    return e;
  };

  const move = (clientY: number) => {
    const e = elevAt(clientY);
    const gap = span * 0.005;
    if (drag.current === 'hi') onChange(lo, Math.max(e, lo + gap));
    else if (drag.current === 'lo') onChange(Math.min(e, hi - gap), hi);
  };

  const grab = (which: 'lo' | 'hi') => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    (ev.target as Element).setPointerCapture(ev.pointerId);
    drag.current = which;
  };
  const onMove = (ev: React.PointerEvent) => {
    if (drag.current) move(ev.clientY);
  };
  const release = () => {
    drag.current = null;
    scheduleHide();
  };
  // click on the track moves whichever handle is nearer
  const trackDown = (ev: React.PointerEvent) => {
    const e = elevAt(ev.clientY);
    drag.current = Math.abs(e - hi) < Math.abs(e - lo) ? 'hi' : 'lo';
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    move(ev.clientY);
  };

  // thin out labels that would overlap; ticks stay
  const h = track.current?.clientHeight ?? 300;
  let lastY = -Infinity;
  const shown = new Set<string>();
  for (const l of [...levels].reverse()) {
    const y = (pct(l.elev) / 100) * h;
    if (y - lastY >= LABEL_GAP_PX) {
      shown.add(l.name);
      lastY = y;
    }
  }

  return (
    <>
      <button
        className={'sec-btn' + (active ? ' active' : '') + (open ? ' hidden' : '')}
        title="Section by elevation"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
          <path d="M10 2v16" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 6h10M5 14h10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
      <div
        className={'sec-panel' + (open ? ' open' : '')}
        onPointerEnter={() => {
          hover.current = true;
          clearTimeout(timer.current);
        }}
        onPointerLeave={() => {
          hover.current = false;
          scheduleHide();
        }}
      >
        <div className="sec-head">
          <button title="Reset" disabled={!active} onClick={() => onChange(min, max)}>
            ⟲
          </button>
          <button title="Hide" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <div className="sec-track" ref={track} onPointerDown={trackDown} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release}>
          <div className="sec-rail" />
          <div className="sec-range" style={{ top: pct(hi) + '%', bottom: 100 - pct(lo) + '%' }} />
          {levels.map((l) => (
            <div key={l.name} className={'sec-level' + (l.elev > hi + 1e-6 || l.elev < lo - 1e-6 ? ' out' : '')} style={{ top: pct(l.elev) + '%' }}>
              {shown.has(l.name) && <span className="sec-name">{l.name}</span>}
              <span className="sec-tick" />
            </div>
          ))}
          {(['hi', 'lo'] as const).map((k) => {
            const v = k === 'hi' ? hi : lo;
            return (
              <div key={k} className={'sec-handle ' + k} style={{ top: pct(v) + '%' }} onPointerDown={grab(k)} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release}>
                <span className="sec-val">{fmt(v)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
