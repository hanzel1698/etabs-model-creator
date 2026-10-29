import { useEffect, useRef, useState } from 'react';
import { fmt } from '../model/geom';

export interface Mark {
  name: string;
  at: number; // mm along the slider's axis (elevation, x or y)
}

const HIDE_MS = 3500;
const SNAP_PX = 6;

// Two-handle range slider over a set of marks (stories or grid lines), docked to one edge of the
// 3D canvas. Right/left sliders run bottom→top, the bottom one left→right. Collapses into a round
// button in a canvas corner when idle; the button lights up while a cut is active.
export default function SectionSlider({ side, title, marks, lo, hi, onChange }: { side: 'right' | 'left' | 'bottom'; title: string; marks: Mark[]; lo: number; hi: number; onChange: (lo: number, hi: number) => void }) {
  const [open, setOpen] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<'lo' | 'hi' | null>(null);
  const hover = useRef(false);
  const timer = useRef(0);
  const vert = side !== 'bottom';
  const min = marks[0]?.at ?? 0;
  const max = marks[marks.length - 1]?.at ?? 1;
  const span = Math.max(1, max - min);
  const active = lo > min || hi < max;
  // % from the top (vertical) or from the left (horizontal)
  const pct = (v: number) => (vert ? (max - v) / span : (v - min) / span) * 100;
  const posStyle = (v: number) => (vert ? { top: pct(v) + '%' } : { left: pct(v) + '%' });

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

  const valueAt = (ev: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    const len = vert ? r.height : r.width;
    const t = Math.min(1, Math.max(0, vert ? (ev.clientY - r.top) / len : (ev.clientX - r.left) / len));
    let v = vert ? max - t * span : min + t * span;
    // snap to a mark when close to it
    const pxPerMm = len / span;
    for (const m of marks) if (Math.abs(m.at - v) * pxPerMm < SNAP_PX) v = m.at;
    return v;
  };

  const move = (ev: React.PointerEvent) => {
    const v = valueAt(ev);
    const gap = span * 0.005;
    if (drag.current === 'hi') onChange(lo, Math.max(v, lo + gap));
    else if (drag.current === 'lo') onChange(Math.min(v, hi - gap), hi);
  };

  const grab = (which: 'lo' | 'hi') => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    (ev.target as Element).setPointerCapture(ev.pointerId);
    drag.current = which;
  };
  const onMove = (ev: React.PointerEvent) => {
    if (drag.current) move(ev);
  };
  const release = () => {
    drag.current = null;
    scheduleHide();
  };
  // click on the track moves whichever handle is nearer
  const trackDown = (ev: React.PointerEvent) => {
    const v = valueAt(ev);
    drag.current = Math.abs(v - hi) < Math.abs(v - lo) ? 'hi' : 'lo';
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    move(ev);
  };
  // click on a mark's name snaps the nearer handle to it
  const pickMark = (at: number) => (ev: React.PointerEvent) => {
    ev.stopPropagation();
    if (Math.abs(at - hi) <= Math.abs(at - lo)) {
      if (at > lo) onChange(lo, at);
    } else if (at < hi) onChange(at, hi);
  };

  // thin out names that would overlap; ticks stay
  const len = (vert ? track.current?.clientHeight : track.current?.clientWidth) ?? 300;
  const minGap = vert ? 12 : 22;
  let last = -Infinity;
  const shown = new Set<Mark>();
  for (const m of [...marks].sort((a, b) => pct(a.at) - pct(b.at))) {
    const p = (pct(m.at) / 100) * len;
    if (p - last >= minGap) {
      shown.add(m);
      last = p;
    }
  }

  return (
    <>
      <button className={`sec-btn ${side}` + (active ? ' active' : '') + (open ? ' hidden' : '')} title={title} onClick={() => setOpen(true)}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden style={vert ? undefined : { transform: 'rotate(90deg)' }}>
          <path d="M10 2v16" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 6h10M5 14h10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </button>
      <div
        className={`sec-panel ${side} ${vert ? 'v' : 'h'}` + (open ? ' open' : '')}
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
          <div className="sec-range" style={vert ? { top: pct(hi) + '%', bottom: 100 - pct(lo) + '%' } : { left: pct(lo) + '%', right: 100 - pct(hi) + '%' }} />
          {marks.map((m, i) => (
            <div key={i} className={'sec-level' + (m.at > hi + 1e-6 || m.at < lo - 1e-6 ? ' out' : '')} style={posStyle(m.at)}>
              {shown.has(m) && (
                <span className="sec-name" title={`Snap to ${m.name} (${fmt(m.at)})`} onPointerDown={pickMark(m.at)}>
                  {m.name}
                </span>
              )}
              <span className="sec-tick" />
            </div>
          ))}
          {(['hi', 'lo'] as const).map((k) => {
            const v = k === 'hi' ? hi : lo;
            return (
              <div key={k} className={'sec-handle ' + k} style={posStyle(v)} onPointerDown={grab(k)} onPointerMove={onMove} onPointerUp={release} onPointerCancel={release}>
                <span className="sec-val">{fmt(v)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
