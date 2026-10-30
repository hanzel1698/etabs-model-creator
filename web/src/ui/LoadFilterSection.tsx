import { useMemo } from 'react';
import { useApp } from '../model/store';
import { ACTIVE_PATTERN, ALL_PATTERNS, LOAD_KINDS, defaultLoadFilter, loadPeaks, type LoadKind } from '../model/loadFilter';
import { activePattern } from './LoadDialogs';

const n = (v: number) => String(Math.round(v * 1000) / 1000);

// a number typed in applies on Enter or leaving the field, so a half-typed "-" doesn't reset the bound
function Bound({ value, onSet }: { value: number; onSet: (v: number) => void }) {
  const apply = (el: HTMLInputElement) => {
    const v = parseFloat(el.value);
    if (isFinite(v)) onSet(v);
    else el.value = n(value);
  };
  return <input key={n(value)} type="number" step="any" defaultValue={n(value)} onBlur={(e) => apply(e.currentTarget)} onKeyDown={(e) => e.key === 'Enter' && apply(e.currentTarget)} />;
}

/** Filter for the loads the 3D wireframe draws: pattern, kind and a min–max range on each load's peak value. */
export function LoadFilterSection() {
  const on = useApp((s) => s.loads3d);
  const model = useApp((s) => s.model);
  const active = useApp(activePattern);
  const f = useApp((s) => s.loadFilter);
  const set = useApp((s) => s.setLoadFilter);
  const peaks = useMemo(() => loadPeaks(model, f, active), [model, f.pattern, f.kinds, active]);
  if (!on) return null;

  const min = peaks.length ? Math.min(...peaks) : 0,
    max = peaks.length ? Math.max(...peaks) : 0;
  const lo = Math.min(Math.max(f.lo ?? min, min), max),
    hi = Math.max(Math.min(f.hi ?? max, max), lo);
  const shown = peaks.filter((p) => p >= lo - 1e-9 && p <= hi + 1e-9).length;
  const span = max - min;
  const pct = (v: number) => (span > 0 ? ((v - min) / span) * 100 : 0);
  // a bound at the end of the range is open, so it follows the loads as they change
  const setLo = (v: number) => set({ lo: !isFinite(v) || v <= min ? null : Math.min(v, hi) });
  const setHi = (v: number) => set({ hi: !isFinite(v) || v >= max ? null : Math.max(v, lo) });
  const toggleKind = (k: LoadKind) => set({ kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] });

  return (
    <div className="section load-filter">
      <h4>
        Load filter <button onClick={() => set(defaultLoadFilter())} title="Show every load of the active pattern">Reset</button>
      </h4>
      <div className="row">
        <span>Pattern</span>
        <select value={f.pattern} onChange={(e) => set({ pattern: e.target.value, lo: null, hi: null })}>
          <option value={ACTIVE_PATTERN}>Active ({active})</option>
          {model.loadPatterns.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
          <option value={ALL_PATTERNS}>All patterns</option>
        </select>
      </div>
      <div className="chips" style={{ marginBottom: 6 }}>
        {LOAD_KINDS.map(({ kind, name, title }) => (
          <button key={kind} className={f.kinds.includes(kind) ? 'on' : ''} title={title} onClick={() => toggleKind(kind)}>
            {name}
          </button>
        ))}
      </div>
      <div className="small muted" title="Each load's largest-magnitude value, with its sign: kN/m for frame distributed loads, kN for point and joint loads, kN/m² for slabs">
        Value (peak of each load)
      </div>
      <div className="dual-range" aria-disabled={span <= 0}>
        <div className="rail" />
        <div className="fill" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
        <input type="range" aria-label="Minimum value" min={min} max={max} step={span / 200 || 1} value={lo} disabled={span <= 0} onChange={(e) => setLo(+e.target.value)} />
        <input type="range" aria-label="Maximum value" min={min} max={max} step={span / 200 || 1} value={hi} disabled={span <= 0} onChange={(e) => setHi(+e.target.value)} />
      </div>
      <div className="row">
        <span>Min</span>
        <Bound value={lo} onSet={setLo} />
        <span>Max</span>
        <Bound value={hi} onSet={setHi} />
      </div>
      <div className="small muted">
        {peaks.length ? `${shown} of ${peaks.length} loads shown · range ${n(min)} to ${n(max)}` : 'No loads of this pattern and type.'}
      </div>
    </div>
  );
}
