import { useState } from 'react';
import { designModel, toast, useApp } from '../model/store';
import { applyStairLoads, defaultPattern, hasStairLoads, stairLoadRows, type PushRow } from '../stair/push';
import { closeDialog } from './dialogState';
import { log } from '../log/sessionLog';
import { startMovePick } from '../plan/tools';
import { beamEndsZ, storyElevations, type Beam, type Flight, type Landing, type StairModel as Model, type Span, type StairParams, type StairRegion } from '../model/types';
import { commitStair } from '../stair/regions';
import { Modal } from './Dialogs';
import { analyze, beamFlipped, beamLoads, beamName, frame, gridRef, suggestWaist, withWaist, type Transfer } from '../stair/stair';
import { beamLoadSvg, bearingSvg, flightSvg, planSvg, spanLoadSvg, spanSectionSvg, unitWeightsHtml } from '../stair/drawings';

type Field<T> = [keyof T & string, string, ('text' | 'num' | string[])?];

const FLIGHT: Field<Flight>[] = [
  ['name', 'Name', 'text'],
  ['dir', 'Up direction', ['+x', '-x', '+y', '-y']],
  ['n', 'Risers'],
  ['R', 'Riser (mm)'],
  ['T', 'Tread (mm)'],
  ['t', 'Waist (mm)'],
  ['width', 'Width (mm)'],
  ['z0', 'Bottom level (mm)'],
  ['x', 'X min corner (mm)'],
  ['y', 'Y min corner (mm)'],
];
const LANDING: Field<Landing>[] = [
  ['name', 'Name', 'text'],
  ['z', 'Top level (mm)'],
  ['t', 'Thickness (mm)'],
  ['x', 'X min (mm)'],
  ['y', 'Y min (mm)'],
  ['w', 'Size along X (mm)'],
  ['h', 'Size along Y (mm)'],
];
const SPAN: Field<Span>[] = [
  ['name', 'Name', 'text'],
  ['width', 'Strip width (mm)'],
  ['x1', 'X1'],
  ['y1', 'Y1'],
  ['x2', 'X2'],
  ['y2', 'Y2'],
];
export const PARAMS: Field<StairParams>[] = [
  ['fck', 'Concrete fck (MPa)', ['15', '20', '25', '30', '35', '40']],
  ['fy', 'Steel fy (MPa)', ['250', '415', '500', '550']],
  ['cover', 'Clear cover (mm)'],
  ['bar', 'Main bar Ø (mm)', ['8', '10', '12', '16', '20']],
  ['dbar', 'Distribution bar Ø (mm)', ['8', '10', '12']],
  ['ff', 'Floor finish (kN/m²)'],
  ['ll', 'Live load (kN/m²)'],
  ['gc', 'Concrete unit wt (kN/m³)'],
  ['gf', 'Load factor γf'],
  ['T', 'Default tread (mm)'],
  ['R', 'Target riser (mm)'],
  ['width', 'Default flight width (mm)'],
  ['t', 'Default waist (mm)'],
  ['tl', 'Default landing t (mm) — kept = waist'],
];

function Form<T extends object>({ obj, fields, onSet }: { obj: T; fields: Field<T>[]; onSet: (k: keyof T, v: string | number) => void }) {
  return (
    <div className="stair-form">
      {fields.map(([k, label, ty]) => {
        const v = obj[k] as unknown as string | number;
        const set = (raw: string) => {
          const num = ty !== 'text' && !(Array.isArray(ty) && isNaN(+raw));
          if (num && !Number.isFinite(+raw)) return;
          onSet(k, num ? +raw : raw);
        };
        return (
          <label key={k}>
            <span>{label}</span>
            {Array.isArray(ty) ? (
              <select value={String(v)} onChange={(e) => set(e.target.value)}>
                {ty.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              // key on the value so an undo or another edit refreshes the field
              <input key={String(v)} type={ty === 'text' ? 'text' : 'number'} defaultValue={v} onBlur={(e) => e.target.value !== String(v) && set(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
            )}
          </label>
        );
      })}
    </div>
  );
}

const patch = <K extends 'flights' | 'landings' | 'spans'>(kind: K, id: string, k: string, v: string | number) =>
  commitStair((m) => ({ ...m, [kind]: (m[kind] as { id: string }[]).map((x) => (x.id === id ? { ...x, [k]: k === 'n' ? Math.max(2, Math.round(+v)) : v, ...(kind === 'spans' ? { auto: false } : {}) } : x)) }));

function pickWidth(id: string) {
  const panel = useApp.getState().panel;
  if (panel !== 'plan' && panel !== 'split') return toast('Switch to the plan view to pick the width.');
  startMovePick((dx, dy) => patch('spans', id, 'width', Math.round(Math.hypot(dx, dy))));
  toast('Strip width: click two edge points in the plan (e.g. the two sides of the flight). Esc cancels.');
}

/** Properties of one selected flight, landing or span of the open stair. */
export function StairProps() {
  const m = useApp(designModel);
  const sel = useApp((s) => s.selection);
  if (!m || sel.length !== 1) return null;
  const id = sel[0];
  const f = m.flights.find((x) => x.id === id),
    l = m.landings.find((x) => x.id === id),
    sp = m.spans.find((x) => x.id === id);
  if (f) {
    const F = frame(f);
    return (
      <div className="section">
        <h4>Flight {f.name}</h4>
        <Form obj={f} fields={FLIGHT} onSet={(k, v) => patch('flights', id, k, v)} />
        <div className="small muted">
          Going {F.L.toFixed(0)} · rise {F.H.toFixed(0)} · top +{(f.z0 + F.H).toFixed(0)} · slope {((Math.atan(f.R / f.T) * 180) / Math.PI).toFixed(1)}° · 2R+T = {(2 * f.R + f.T).toFixed(0)}
        </div>
      </div>
    );
  }
  if (l)
    return (
      <div className="section">
        <h4>Landing {l.name}</h4>
        <Form obj={l} fields={LANDING} onSet={(k, v) => patch('landings', id, k, v)} />
      </div>
    );
  if (sp) {
    const A = analyze(m, sp);
    return (
      <div className="section">
        <h4>Span {sp.name}</h4>
        <Form obj={sp} fields={SPAN} onSet={(k, v) => patch('spans', id, k, v)} />
        <button onClick={() => pickWidth(id)} title="Click two points in the plan (e.g. the two edges of the flight); the distance between them becomes the strip width">⌖ Pick strip width on plan</button>
        {A && (
          <div className="small muted">
            Span {A.L.toFixed(3)} m · supports {A.sup.map((s) => (s.beam ? beamName(m, s.beam) : s.span ? `on ${s.span.name}` : '—')).join(' → ')}{A.tr.length ? ` · carries ${A.tr.map((t) => t.from.name).join(', ')}` : ''} · Mu {A.U.M.toFixed(2)} kNm/m{sp.auto ? ' · auto (editing makes it manual)' : ''}
          </div>
        )}
      </div>
    );
  }
  return null;
}

export function StairParamsDialog() {
  const p = useApp((s) => designModel(s)?.stair);
  if (!p) return null;
  return (
    <Modal title="Stair design parameters">
      <Form obj={p} fields={PARAMS} onSet={(k, v) => commitStair((m) => ({ ...m, stair: { ...m.stair, ...(k === 't' || k === 'tl' ? { t: +v, tl: +v } : { [k]: +v }) } }))} />
      <button onClick={() => commitStair((m) => withWaist(m, m.stair.t))} title="Set every flight waist and landing thickness in the model to the default waist">
        Apply {p.t} mm to all flights &amp; landings
      </button>
    </Modal>
  );
}

// ---------- results report (IS 456) ----------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f2 = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const okS = (b: boolean) => (b ? '<span class="ok">OK</span>' : '<span class="ng">NOT OK</span>');

function beamTag(m: Model, b: Beam) {
  const z = [...beamEndsZ(storyElevations(m), b)!];
  if (beamFlipped(b)) z.reverse();
  return `${beamName(m, b)} ${b.section}`.trim() + (Math.abs(z[1] - z[0]) > 1 ? ` (+${z[0].toFixed(0)} → +${z[1].toFixed(0)})` : ` (+${z[0].toFixed(0)})`);
}

/** How each Stair Dead / Live line load on a beam comes out of its span's support reaction. */
function beamTrail(m: Model, out: ReturnType<typeof beamLoads>['out']) {
  let h = `<h3>Calculation trail — Stair Dead and Live loads on beams</h3>
<div class="info">Each span is a simply supported strip analysed per metre width. For every load piece i on the strip: w_i = intensity (kN/m² = kN/m per m width), a_i, b_i = start / end from support A (m), W_i = resultant (kN/m), x̄_i = its distance from A (m). Moments about A give R_B; vertical equilibrium gives R_A. The reaction (kN/m per m width) is applied to the beam as a UDL over the strip width b_st.</div>`;
  for (const [b, rows] of out) {
    if (!rows.length) continue;
    h += `<div class="card"><h4>${esc(beamTag(m, b))}</h4>`;
    for (const r of rows) {
      const A = analyze(m, r.sp)!,
        R = r.e ? 'R_B' : 'R_A',
        K = r.e ? 'RB' : 'RA',
        pieces = [
          ...A.segs.map((s) => ({ n: `${s.it.name} (${'n' in s.it ? 'flight' : 'landing'})`, a: s.a, b: s.b, dl: s.dl, ll: s.ll, g: s.ld.dl, q: s.ld.ll, k: s.k, tr: null as Transfer | null })),
          ...A.tr.map((t) => ({ n: `reaction of span ${t.from.name}`, a: t.a, b: t.b, dl: t.dl, ll: t.ll, g: t.dl, q: t.ll, k: 1, tr: t as Transfer | null })),
        ];
      let t = `<b>Span ${r.sp.name}</b>: effective span L = ${f2(A.L, 3)} m, strip width b_st = ${r.sp.width} mm; the ${r.e ? 'end B' : 'start A'} of this span bears on this beam, so the beam load is ${R}.\n`;
      for (const q of pieces)
        if (q.tr) {
          const o = analyze(m, q.tr.from)!,
            RK = q.tr.end ? 'RB' : 'RA',
            lb = q.tr.b - q.tr.a;
          t += `\nPiece "${q.n}" — reaction of another span spread over its bearing on this strip:\n  Formula:  w = R_o × b_o / (b_st × l_b)     (R_o = reaction of span ${q.tr.from.name} per m, b_o = its strip width, l_b = bearing length)\n`;
          t += `          w_D = ${f2(o.D[RK], 3)} × ${q.tr.from.width} / (${r.sp.width} × ${f2(lb, 3)}) = ${f2(q.dl, 3)} kN/m²\n          w_L = ${f2(o.LL[RK], 3)} × ${q.tr.from.width} / (${r.sp.width} × ${f2(lb, 3)}) = ${f2(q.ll, 3)} kN/m²\n`;
        } else if (q.k !== 1)
          t += `\nPiece "${q.n}" is common to two spans at right angles (IS 456 cl 33.2):\n  Formula:  w_i = k × g;  k × q\n          w_D = ${q.k} × ${f2(q.g, 3)} = ${f2(q.dl, 3)} kN/m²;  w_L = ${q.k} × ${f2(q.q, 3)} = ${f2(q.ll, 3)} kN/m²\n`;
      for (const [c, k] of [['Dead', 'dl'], ['Live', 'll']] as const) {
        const S = k === 'dl' ? A.D : A.LL;
        let sm = 0;
        t += `\n<b>Stair ${c}</b> (per m width of strip, w_i = ${k === 'dl' ? 'g' : 'q'} of each piece)\n  Formulas:  W_i = w_i × (b_i − a_i);   x̄_i = (a_i + b_i) / 2;   M_A,i = W_i × x̄_i\n`;
        pieces.forEach((q, i) => {
          const W = q[k] * (q.b - q.a),
            x = (q.a + q.b) / 2;
          sm += W * x;
          t += `  ${i + 1}. ${q.n}:\n       W_${i + 1} = ${f2(q[k], 3)} × (${f2(q.b, 3)} − ${f2(q.a, 3)}) = ${f2(W, 3)} kN/m\n       x̄_${i + 1} = (${f2(q.a, 3)} + ${f2(q.b, 3)}) / 2 = ${f2(x, 3)} m\n       M_A,${i + 1} = ${f2(W, 3)} × ${f2(x, 3)} = ${f2(W * x, 3)} kNm/m\n`;
        });
        t += `  Formula:  ΣW = W_1 + … + W_${pieces.length}\n          ΣW = ${pieces.map((q) => f2(q[k] * (q.b - q.a), 3)).join(' + ')} = ${f2(S.W, 3)} kN/m\n`;
        t += `  Formula:  R_B = Σ(W_i × x̄_i) / L        (moments about A)\n          R_B = ${f2(sm, 3)} / ${f2(A.L, 3)} = ${f2(S.RB, 3)} kN/m\n`;
        t += `  Formula:  R_A = ΣW − R_B               (vertical equilibrium)\n          R_A = ${f2(S.W, 3)} − ${f2(S.RB, 3)} = ${f2(S.RA, 3)} kN/m\n`;
        t += `  → Stair ${c} on beam w_${k === 'dl' ? 'D' : 'L'} = ${R} = <b>${f2(S[K])} kN/m</b>, from ${f2(r.a / 1000)} to ${f2(r.b / 1000)} m along the beam (b_st = ${f2(r.sp.width / 1000)} m centred on the bearing)\n`;
      }
      t += `\nFormula:  w_u,beam = γf × (w_D + w_L)\n          w_u,beam = ${p2(m.stair.gf)} × (${f2(r.dl)} + ${f2(r.ll)}) = <b>${f2(r.fu)} kN/m</b>`;
      h += `<div class="calc">${esc(t).replace(/&lt;(\/?)b&gt;/g, '<$1b>')}</div>`;
    }
    h += '</div>';
  }
  return h;
}
const p2 = (v: number) => String(+v.toFixed(2));

function suggestHtml(m: Model, act: boolean) {
  const s = suggestWaist(m);
  if (!s) return '';
  const same = [...m.flights, ...m.landings].every((x) => x.t === s.t);
  return `<div class="info">Suggested slab thickness: <b>${s.t} mm</b> — the least that passes flexure, shear and deflection on every span (thumb rule L/20 of the longest span = ${s.thumb} mm). ${act && !same ? `<button data-t="${s.t}">Use ${s.t} mm for all flights &amp; landings</button>` : ''}</div>`;
}

/** In-app only: deflection failures up front. */
function deflAlert(m: Model) {
  const bad = m.spans.flatMap((sp) => {
    const d = analyze(m, sp)?.des;
    return d && !d.defl ? [`<li>${esc(sp.name)}: L/d = ${f2(d.ld, 2)} &gt; (L/d)_allow = ${f2(d.ldAllow, 2)} (waist ${d.D} mm)</li>`] : [];
  });
  if (!bad.length) return '';
  return `<div class="card"><b class="ng">Deflection fails on ${bad.length} span${bad.length > 1 ? 's' : ''}</b><ul>${bad.join('')}</ul></div>`;
}

const NOTATION: [string, string, string][] = [
  ['R', 'riser height', 'mm'],
  ['T', 'tread (horizontal going of one step)', 'mm'],
  ['n', 'number of risers in a flight', '—'],
  ['t', 'waist / landing thickness (waist measured square to the soffit)', 'mm'],
  ['θ', 'slope of the flight, tan⁻¹(R/T)', '°'],
  ['h', 'sloping length of one step, √(R² + T²)', 'mm'],
  ['t_v', 'vertical thickness of the waist, t·secθ', 'mm'],
  ['A_s', 'area of one step triangle, ½·R·T', 'mm²'],
  ['t_s', 'mean thickness of the steps over one tread, A_s/T = R/2', 'mm'],
  ['γc', 'unit weight of reinforced concrete', 'kN/m³'],
  ['w_w', 'self weight of the waist / landing slab per m² of plan', 'kN/m²'],
  ['w_s', 'self weight of the steps per m² of plan', 'kN/m²'],
  ['w_ff', 'floor finish load', 'kN/m²'],
  ['g', 'dead load intensity (DL)', 'kN/m²'],
  ['q', 'imposed / live load intensity (LL)', 'kN/m²'],
  ['γf', 'partial safety factor for loads', '—'],
  ['w_u', 'factored load intensity, γf·(g + q)', 'kN/m²'],
  ['k', 'load share of a landing common to two spans (cl 33.2); in shear, depth factor (cl 40.2.1.1)', '—'],
  ['L', 'effective span, c/c of supports measured horizontally (cl 33.1)', 'm'],
  ['b_st', 'width of the design strip (span width)', 'mm'],
  ['a_i, b_i', 'start / end of load piece i, measured from support A', 'm'],
  ['W_i, x̄_i', 'resultant of load piece i and its distance from A', 'kN/m, m'],
  ['R_A, R_B', 'support reactions per m width at A (start) and B (end)', 'kN/m'],
  ['R_o, b_o, l_b', 'reaction and strip width of a span resting on this one, and its bearing length', 'kN/m, mm, m'],
  ['w_D, w_L', 'Stair Dead / Stair Live line load on a beam', 'kN/m'],
  ['b', 'design width of the slab strip = 1000', 'mm'],
  ['D', 'overall depth of the slab = waist t', 'mm'],
  ['c', 'clear cover', 'mm'],
  ['φ, φ_d', 'main / distribution bar diameter', 'mm'],
  ['d', 'effective depth, D − c − φ/2', 'mm'],
  ['fck, fy', 'characteristic cube strength of concrete / yield strength of steel', 'MPa'],
  ['Es', 'modulus of elasticity of steel = 200 000', 'MPa'],
  ['M_u, V_u', 'factored bending moment / shear force per m width', 'kNm/m, kN/m'],
  ['x_u,max', 'limiting depth of the neutral axis', 'mm'],
  ['Q', 'limiting moment factor, 0.36·fck·(x_u,max/d)·(1 − 0.42·x_u,max/d)', 'MPa'],
  ['M_u,lim', 'limiting moment of resistance, Q·b·d²', 'kNm/m'],
  ['A_st', 'area of tension steel (req = required, prov = provided)', 'mm²/m'],
  ['a_φ, a_φd', 'area of one main / distribution bar, π·φ²/4', 'mm²'],
  ['s, s_d', 'spacing of main / distribution bars', 'mm'],
  ['τ_v', 'nominal shear stress, V_u/(b·d)', 'MPa'],
  ['τ_c, τ_c,max', 'design shear strength of concrete (Table 19) / maximum shear stress (Table 20)', 'MPa'],
  ['p_t', 'tension steel percentage, 100·A_st,prov/(b·d)', '%'],
  ['f_s', 'steel stress at service, 0.58·fy·A_st,req/A_st,prov', 'MPa'],
  ['k_t', 'modification factor for tension steel (Fig. 4)', '—'],
];

function notationHtml() {
  return `<h2>Notation</h2><table class="notation"><tr><th>Symbol</th><th>Meaning</th><th>Unit</th></tr>${NOTATION.map(([a, b, c]) => `<tr><td><b>${esc(a)}</b></td><td style="text-align:left">${esc(b)}</td><td>${esc(c)}</td></tr>`).join('')}</table>`;
}

/** IS 456 slab design of one span, each step as formula, then values, then result. */
function designCalc(m: Model, A: NonNullable<ReturnType<typeof analyze>>) {
  const p = m.stair,
    d = A.des,
    xu = d.xr,
    ab = (Math.PI * p.bar ** 2) / 4,
    abd = (Math.PI * p.dbar ** 2) / 4,
    rho = p.fy > 250 ? 0.0012 : 0.0015,
    gd = [15, 20, 25, 30, 35, 40].filter((g) => g <= p.fck).pop() || 15;
  return `<b>Given</b>
  b = ${d.b} mm;  D = t = ${d.D} mm (thinnest waist on the span);  c = ${p.cover} mm;  φ = ${p.bar} mm;  φ_d = ${p.dbar} mm
  fck = ${p.fck} MPa;  fy = ${p.fy} MPa;  Es = 200000 MPa;  L = ${f2(A.L, 3)} m;  γf = ${p.gf}

<b>1. Effective depth</b>
  Formula:  d = D − c − φ/2
          d = ${d.D} − ${p.cover} − ${p.bar}/2 = ${f2(d.d, 1)} mm

<b>2. Design actions</b> (factored, per m width — see the loading, SFD and BMD figure)
  Formula:  M_u = max over x of [R_A,u·x − Σ w_u,i·l_i(x)·(x − x̄_i(x))]   (l_i(x) = part of piece i left of x)
          M_u = ${f2(d.Mu, 3)} kNm/m at x = ${f2(A.U.x, 3)} m from A
  Formula:  V_u = max(R_A,u, R_B,u)
          V_u = max(${f2(A.U.RA, 3)}, ${f2(A.U.RB, 3)}) = ${f2(d.Vu, 3)} kN/m

<b>3. Limiting moment</b> (IS 456 cl 38.1, Annex G)
  Formula:  x_u,max/d = 0.0035 / (0.0055 + 0.87·fy/Es)
          x_u,max/d = 0.0035 / (0.0055 + 0.87 × ${p.fy} / 200000) = ${f2(xu, 4)}
  Formula:  Q = 0.36·fck·(x_u,max/d)·(1 − 0.42·x_u,max/d)
          Q = 0.36 × ${p.fck} × ${f2(xu, 4)} × (1 − 0.42 × ${f2(xu, 4)}) = ${f2(d.Q, 4)} MPa
  Formula:  M_u,lim = Q·b·d² / 10⁶
          M_u,lim = ${f2(d.Q, 4)} × ${d.b} × ${f2(d.d, 1)}² / 10⁶ = ${f2(d.Mlim, 3)} kNm/m
  Check:    M_u = ${f2(d.Mu, 3)} ≤ M_u,lim = ${f2(d.Mlim, 3)}  → ${okS(d.flex)}${
    d.flex
      ? '  (singly reinforced, under-reinforced)'
      : `
  Formula:  d_req = √(M_u·10⁶ / (Q·b))
          d_req = √(${f2(d.Mu, 3)} × 10⁶ / (${f2(d.Q, 4)} × ${d.b})) = ${f2(d.dReq, 1)} mm  → increase the waist`
  }

<b>4. Main (tension) steel</b> (Annex G-1.1 b)
  Formula:  A_st = (0.5·fck/fy)·[1 − √(1 − 4.6·M_u·10⁶ / (fck·b·d²))]·b·d
          A_st = (0.5 × ${p.fck} / ${p.fy}) × [1 − √(1 − 4.6 × ${f2(d.Mu, 3)} × 10⁶ / (${p.fck} × ${d.b} × ${f2(d.d, 1)}²))] × ${d.b} × ${f2(d.d, 1)} = ${f2(d.Ast, 1)} mm²/m
  Formula:  A_st,min = ${p2(rho * 100)}%·b·D      (cl 26.5.2.1, ${p.fy > 250 ? 'HYSD bars' : 'mild steel'})
          A_st,min = ${rho} × ${d.b} × ${d.D} = ${f2(d.Amin, 1)} mm²/m
  Formula:  A_st,req = max(A_st, A_st,min)
          A_st,req = max(${f2(d.Ast, 1)}, ${f2(d.Amin, 1)}) = ${f2(d.Areq, 1)} mm²/m
  Formula:  a_φ = π·φ²/4
          a_φ = π × ${p.bar}² / 4 = ${f2(ab)} mm²
  Formula:  s = 1000·a_φ / A_st,req
          s = 1000 × ${f2(ab)} / ${f2(d.Areq, 1)} = ${f2((1000 * ab) / d.Areq, 1)} mm
  Formula:  s_max = min(3·d, 300)                 (cl 26.3.3 b-1)
          s_max = min(3 × ${f2(d.d, 1)}, 300) = ${f2(d.sMax, 1)} mm
  Adopt:    s = ${d.s} mm  (lesser of s and s_max, rounded down to 10 mm)
  Formula:  A_st,prov = 1000·a_φ / s
          A_st,prov = 1000 × ${f2(ab)} / ${d.s} = ${f2(d.Aprov, 1)} mm²/m ≥ A_st,req = ${f2(d.Areq, 1)}  → ${okS(d.Aprov >= d.Areq - 0.5)}

<b>5. Distribution steel</b> (cl 26.5.2.1)
  Formula:  a_φd = π·φ_d²/4
          a_φd = π × ${p.dbar}² / 4 = ${f2(abd)} mm²
  Formula:  s_d = 1000·a_φd / A_st,min
          s_d = 1000 × ${f2(abd)} / ${f2(d.Amin, 1)} = ${f2((1000 * abd) / d.Amin, 1)} mm
  Formula:  s_d,max = min(5·d, 450)               (cl 26.3.3 b-2)
          s_d,max = min(5 × ${f2(d.d, 1)}, 450) = ${f2(d.sdMax, 1)} mm
  Adopt:    s_d = ${d.sd} mm
  Formula:  A_d,prov = 1000·a_φd / s_d
          A_d,prov = 1000 × ${f2(abd)} / ${d.sd} = ${f2(d.Adprov, 1)} mm²/m

<b>6. Shear</b> (cl 40)
  Formula:  τ_v = V_u·10³ / (b·d)
          τ_v = ${f2(d.Vu, 3)} × 10³ / (${d.b} × ${f2(d.d, 1)}) = ${f2(d.tv, 4)} MPa
  Formula:  p_t = 100·A_st,prov / (b·d)
          p_t = 100 × ${f2(d.Aprov, 1)} / (${d.b} × ${f2(d.d, 1)}) = ${f2(d.pt, 4)} %
  Table 19 (M${gd}, p_t = ${f2(d.pt, 3)} %, linear interpolation):  τ_c = ${f2(d.tc, 4)} MPa
  Formula:  k = 1.3 − 0.3·(D − 150)/150,  1.0 ≤ k ≤ 1.3   (cl 40.2.1.1, solid slabs)
          k = 1.3 − 0.3 × (${d.D} − 150) / 150 = ${f2(d.k, 3)}
  Check:    τ_v = ${f2(d.tv, 4)} ≤ k·τ_c = ${f2(d.k, 3)} × ${f2(d.tc, 4)} = ${f2(d.k * d.tc, 4)} MPa  → ${okS(d.shear)}${d.shear ? '  (no shear reinforcement required)' : ''}
  Table 20 (M${gd}):  τ_c,max = ${f2(d.tcmax)} MPa
  Check:    τ_v = ${f2(d.tv, 4)} ≤ 0.5·τ_c,max = ${f2(d.tcmax / 2, 3)} MPa  (cl 40.2.1.1)  → ${okS(d.shearMax)}

<b>7. Deflection</b> (cl 23.2.1)
  Formula:  f_s = 0.58·fy·A_st,req / A_st,prov
          f_s = 0.58 × ${p.fy} × ${f2(d.Areq, 1)} / ${f2(d.Aprov, 1)} = ${f2(d.fs, 1)} MPa
  Formula:  k_t = 1 / (0.225 + 0.00322·f_s + 0.625·log₁₀ p_t) ≤ 2.0    (Fig. 4)
          k_t = 1 / (0.225 + 0.00322 × ${f2(d.fs, 1)} + 0.625 × log₁₀ ${f2(d.pt, 4)}) = ${f2(d.kt, 3)}
  Formula:  (L/d)_allow = 20·k_t                  (basic value 20, simply supported)
          (L/d)_allow = 20 × ${f2(d.kt, 3)} = ${f2(d.ldAllow, 2)}
  Formula:  L/d = L·1000 / d
          L/d = ${f2(A.L, 3)} × 1000 / ${f2(d.d, 1)} = ${f2(d.ld, 2)}
  Check:    L/d = ${f2(d.ld, 2)} ≤ (L/d)_allow = ${f2(d.ldAllow, 2)}  → ${okS(d.defl)}`;
}

/** `act`: include the "use suggested waist" buttons (the in-app modal, not the print). */
export function resultsHtml(m: Model, act = false) {
  const p = m.stair,
    { out, warn } = beamLoads(m),
    fig = { n: 2 };
  let h = suggestHtml(m, act) + (act ? deflAlert(m) : '');
  h += `<h2>Stair layout</h2>${planSvg(m)}${notationHtml()}`;
  if (m.flights.length) h += '<h2>Flight elevations</h2>' + m.flights.map((f) => flightSvg(f, fig.n++)).join('');
  h += unitWeightsHtml(m, fig);
  h += `<h2>Stair loads on beams</h2>
<div class="info">Unfactored line loads (kN/m) to apply as uniform distributed loads on each beam, in two load cases: <b>Stair Dead</b> (waist / landing self weight + steps + finishes) and <b>Stair Live</b>. Distances in m from the beam's left end (bottom end for a vertical beam). A cranked beam is listed piece by piece.</div>
<table><tr><th>Beam</th><th>Grid</th><th>Length (m)</th><th>From span</th><th>Start (m)</th><th>End (m)</th><th>Dead (kN/m)</th><th>Live (kN/m)</th><th>Factored (kN/m)</th></tr>`;
  for (const [b, rows] of out) {
    const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 1000;
    if (!rows.length) {
      h += `<tr><td>${esc(beamTag(m, b))}</td><td>${esc(gridRef(m, b))}</td><td>${f2(L)}</td><td colspan="6" class="info">No stair load — no span bears on this beam</td></tr>`;
      continue;
    }
    rows.forEach((r, i) => (h += `<tr><td>${i ? '' : esc(beamTag(m, b))}</td><td>${i ? '' : esc(gridRef(m, b))}</td><td>${i ? '' : f2(L)}</td><td>${esc(r.sp.name)}</td><td>${f2(r.a / 1000)}</td><td>${f2(r.b / 1000)}</td><td>${f2(r.dl)}</td><td>${f2(r.ll)}</td><td>${f2(r.fu)}</td></tr>`));
  }
  h += '</table>';
  for (const [b, rows] of out) h += beamLoadSvg(m, b, rows, rows.length ? fig.n++ : 0);
  h += beamTrail(m, out);
  if (warn.length) h += '<div class="card"><b class="ng">Warnings</b><ul>' + warn.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul></div>';
  h += `<h2>Slab design — IS 456:2000</h2><div class="info">M${p.fck} / Fe${p.fy}, clear cover ${p.cover} mm, main Ø${p.bar}, distribution Ø${p.dbar}, finishes ${p.ff} kN/m², live ${p.ll} kN/m², γc ${p.gc} kN/m³, γf ${p.gf}. Each span is a 1 m wide simply supported strip; effective span = c/c of supports measured horizontally (cl 33.1); depth = waist normal to the soffit (cl 33.3).</div>`;
  for (const sp of m.spans) {
    const A = analyze(m, sp);
    if (!A) {
      h += `<div class="card">${esc(sp.name)}: too short.</div>`;
      continue;
    }
    const d = A.des;
    h += `<div class="card"><h4>${esc(sp.name)} — effective span ${f2(A.L, 3)} m, strip width ${f2(sp.width / 1000)} m</h4>
<div class="info">Supports: ${A.sup.map((s) => (s.beam ? esc(beamTag(m, s.beam)) : s.span ? `rests on span ${esc(s.span.name)} at ${f2(s.at!)} m` : 'none (wall/other)')).join(' → ')}</div>
${spanSectionSvg(m, sp, fig.n++)}${A.tr.length ? bearingSvg(m, sp, fig.n++) : ''}${spanLoadSvg(m, sp, fig.n++)}
<table><tr><th>Element</th><th>From (m)</th><th>To (m)</th><th>l_i (m)</th><th>w_w</th><th>w_s</th><th>w_ff</th><th>Share k</th><th>k·g (kN/m²)</th><th>k·q (kN/m²)</th><th>w_u (kN/m²)</th></tr>`;
    for (const s of A.segs) h += `<tr><td>${esc(s.it.name)} (${'n' in s.it ? 'flight' : 'landing'}, t=${s.it.t})</td><td>${f2(s.a)}</td><td>${f2(s.b)}</td><td>${f2(s.b - s.a)}</td><td>${f2(s.ld.ws)}</td><td>${f2(s.ld.st)}</td><td>${f2(s.ld.ff)}</td><td>${s.k === 1 ? '100%' : '50% (cl 33.2)'}</td><td>${f2(s.dl)}</td><td>${f2(s.ll)}</td><td>${f2(p.gf * (s.dl + s.ll))}</td></tr>`;
    for (const t of A.tr) h += `<tr><td>Reaction of span ${esc(t.from.name)} (${t.end ? 'end' : 'start'})</td><td>${f2(t.a)}</td><td>${f2(t.b)}</td><td>${f2(t.b - t.a)}</td><td>—</td><td>—</td><td>—</td><td>100%</td><td>${f2(t.dl)}</td><td>${f2(t.ll)}</td><td>${f2(p.gf * (t.dl + t.ll))}</td></tr>`;
    h += `</table><table><tr><th>Per m width</th><th>Dead</th><th>Live</th><th>Factored</th></tr>
<tr><td>Reaction at start (kN/m)</td><td>${f2(A.D.RA)}</td><td>${f2(A.LL.RA)}</td><td>${f2(A.U.RA)}</td></tr>
<tr><td>Reaction at end (kN/m)</td><td>${f2(A.D.RB)}</td><td>${f2(A.LL.RB)}</td><td>${f2(A.U.RB)}</td></tr>
<tr><td>Max moment (kNm/m)</td><td>${f2(A.D.M)}</td><td>${f2(A.LL.M)}</td><td>${f2(A.U.M)} at x = ${f2(A.U.x)} m</td></tr></table>
<div class="calc">${designCalc(m, A)}</div>
<b>Provide:</b> ${d.D} mm waist, Ø${p.bar} @ ${d.s} c/c main, Ø${p.dbar} @ ${d.sd} c/c distribution ${d.flex && d.shear && d.shearMax && d.defl ? '<span class="ok">— all checks OK</span>' : '<span class="ng">— revise</span>'}</div>`;
  }
  if (!m.spans.length) h += '<div class="info">No spans yet — draw spans or use Stair → Auto spans.</div>';
  h += '<h2>Flight geometry</h2><table><tr><th>Flight</th><th>Risers</th><th>R (mm)</th><th>T (mm)</th><th>2R+T</th><th>Going (m)</th><th>Rise (m)</th><th>Levels (mm)</th></tr>';
  for (const f of m.flights) {
    const F = frame(f),
      c = 2 * f.R + f.T;
    h += `<tr><td>${esc(f.name)}</td><td>${f.n}</td><td>${f.R}</td><td>${f.T}</td><td>${c.toFixed(0)} ${c < 550 || c > 700 ? '<span class="ng">(550–700)</span>' : ''}</td><td>${f2(F.L / 1000)}</td><td>${f2(F.H / 1000, 3)}</td><td>${f.z0.toFixed(0)} → ${(f.z0 + F.H).toFixed(0)}</td></tr>`;
  }
  return h + '</table>';
}

/** Applies a suggested waist; the dialog re-renders the results from the new model. */
function applyWaist(e: { target: EventTarget }) {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-t]');
  if (!btn) return;
  commitStair((m) => withWaist(m, +btn.dataset.t!));
}

export function StairResultsDialog() {
  const m = useApp(designModel);
  if (!m) return null;
  return (
    <Modal wide title="Stair design results" footer={<><button onClick={() => downloadCsv(m)}>Beam loads CSV</button><button onClick={() => printReport(m)}>Print report</button></>}>
      <div className="report-inline report" style={{ position: 'static', maxHeight: '70vh' }} onClick={applyWaist} dangerouslySetInnerHTML={{ __html: resultsHtml(m, true) }} />
    </Modal>
  );
}

function download(name: string, txt: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadCsv(m: Model) {
  const { out } = beamLoads(m),
    L = ['Beam,Section,Grid,Load case,Start (m),End (m),Load (kN/m),Span'];
  for (const [b, rows] of out)
    for (const r of rows)
      for (const [c, v] of [
        ['Stair Dead', r.dl],
        ['Stair Live', r.ll],
      ] as const)
        L.push([beamName(m, b), b.section, `"${gridRef(m, b)}"`, c, f2(r.a / 1000, 3), f2(r.b / 1000, 3), f2(v, 3), r.sp.name].join(','));
  download('stair-beam-loads.csv', L.join('\n'), 'text/csv');
}

function printReport(m: Model) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><title>Stair design report</title><style>body{font:12px system-ui;margin:20px}table{border-collapse:collapse;margin:6px 0}th,td{border:1px solid #999;padding:2px 6px;text-align:right}td:first-child,th:first-child{text-align:left}.calc{font-family:monospace;white-space:pre-wrap}.ok{color:#15803d}.ng{color:#c62828}.card{border:1px solid #ccc;padding:8px;margin:8px 0}.info{color:#555}figure.dwg{margin:10px 0;break-inside:avoid}figure.dwg figcaption{font-size:11px;color:#333;margin-top:3px}svg{max-width:100%;height:auto}h2{break-after:avoid}</style>${resultsHtml(m)}`);
  w.document.close();
  w.print();
}

// ---------- pushing stair loads to the main model ----------

type Ov = NonNullable<StairRegion['overrides']>;
const openRegion = (s: { model: { stairs: StairRegion[] }; activeStair: string | null }) => s.model.stairs.find((r) => r.id === s.activeStair);

/** Overrides kept: only values that differ from the calculated ones. */
function overridesOf(rows: PushRow[], v: Record<string, { dl: number; ll: number }>): Ov {
  const out: Ov = {};
  for (const r of rows) {
    const e = v[r.key],
      o: { dl?: number; ll?: number } = {};
    if (Math.abs(e.dl - r.calc.dl) > 1e-6) o.dl = e.dl;
    if (Math.abs(e.ll - r.calc.ll) > 1e-6) o.ll = e.ll;
    if (o.dl !== undefined || o.ll !== undefined) out[r.key] = o;
  }
  return out;
}

/** Stair › Push loads to model: one editable row per beam stretch, then one commit into the main model. */
export function StairPushDialog() {
  const m = useApp(designModel);
  const region = useApp(openRegion);
  const pats = useApp((s) => s.model.loadPatterns);
  const pushed = useApp((s) => !!region && hasStairLoads(s.model, region.id));
  const rows = m && region ? stairLoadRows(m, region.overrides) : [];
  const [v, setV] = useState<Record<string, { dl: number; ll: number }>>({});
  const [dlp, setDlp] = useState(() => defaultPattern(pats, 'dl', region?.dlPattern));
  const [llp, setLlp] = useState(() => defaultPattern(pats, 'll', region?.llPattern));
  if (!m || !region) return null;
  const val = (r: PushRow) => v[r.key] ?? { dl: r.dl, ll: r.ll };
  const set = (r: PushRow, k: 'dl' | 'll', x: number) => setV({ ...v, [r.key]: { ...val(r), [k]: x } });
  const push = () => {
    const vals = Object.fromEntries(rows.map((r) => [r.key, val(r)]));
    const out = rows.map((r) => ({ ...r, ...vals[r.key] }));
    useApp.getState().commit((mm) => applyStairLoads({ ...mm, stairs: mm.stairs.map((x) => (x.id === region.id ? { ...x, overrides: overridesOf(rows, vals), dlPattern: dlp, llPattern: llp } : x)) }, region.id, out, dlp, llp), { main: true });
    log('Stair', `${region.name}: pushed ${out.length} stair load stretch(es) to ${new Set(out.map((r) => r.name)).size} beam(s), DL on ${dlp}, LL on ${llp}`);
    toast(`${region.name}: loads pushed to the model's beams.`);
    closeDialog();
  };
  const remove = () => {
    useApp.getState().commit((mm) => applyStairLoads(mm, region.id, [], dlp, llp), { main: true });
    log('Stair', `${region.name}: removed its pushed loads from the model`);
    closeDialog();
  };
  const num = (r: PushRow, k: 'dl' | 'll') => {
    const x = val(r)[k],
      c = r.calc[k],
      edited = Math.abs(x - c) > 1e-6;
    return (
      <td>
        <input type="number" step="0.01" min="0" style={{ width: 70 }} value={+x.toFixed(3)} onChange={(e) => set(r, k, Math.max(0, +e.target.value || 0))} aria-label={`${r.name} ${r.span} ${k === 'dl' ? 'dead' : 'live'}`} />
        <span className="hint" style={{ marginLeft: 4, opacity: edited ? 1 : 0.5 }}>{edited ? `calc ${c.toFixed(2)}` : 'calc'}</span>
      </td>
    );
  };
  const pick = (value: string, on: (x: string) => void, label: string) => (
    <label className="row">
      <span>{label}</span>
      <select value={value} onChange={(e) => on(e.target.value)}>
        {pats.map((p) => <option key={p.name}>{p.name}</option>)}
      </select>
    </label>
  );
  return (
    <Modal
      wide
      title={`Push ${region.name} loads to the model`}
      footer={
        <>
          {pushed && <button onClick={remove} title="Take this stair's pushed loads off the model's beams">Remove pushed loads</button>}
          <button onClick={closeDialog}>Cancel</button>
          <button className="primary" disabled={!rows.length || !dlp || !llp} onClick={push}>{pushed ? 'Push again (replaces)' : 'Push'}</button>
        </>
      }
    >
      <p className="hint">Unfactored stair reactions as uniform gravity loads (kN/m) on the stretch of each beam the span bears on. Edited values are kept for this stair; pushing again replaces this stair's earlier loads.</p>
      {pick(dlp, setDlp, 'Stair dead →')}
      {pick(llp, setLlp, 'Stair live →')}
      {rows.length ? (
        <table className="grid">
          <thead>
            <tr><th>Beam</th><th>Span</th><th>From–to (mm from beam start)</th><th>DL kN/m</th><th>LL kN/m</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.name}</td>
                <td>{r.span}</td>
                <td>{r.d1.toFixed(0)} – {r.d2.toFixed(0)}</td>
                {num(r, 'dl')}
                {num(r, 'll')}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No span bears on a beam yet. Draw spans (or Stair › Auto spans) that end on the model's beams.</p>
      )}
    </Modal>
  );
}

/** Stair › Set stair loads: one DL/LL for every calculated stretch on the selected beams (blank keeps the calculated value). */
export function StairSetLoadsDialog() {
  const m = useApp(designModel);
  const region = useApp(openRegion);
  const sel = useApp((s) => s.selection);
  const [dl, setDl] = useState('');
  const [ll, setLl] = useState('');
  if (!m || !region) return null;
  const ids = new Set(sel);
  const rows = stairLoadRows(m, region.overrides).filter((r) => ids.has(r.beam.id));
  const beams = m.beams.filter((b) => ids.has(b.id));
  const skipped = beams.filter((b) => !rows.some((r) => r.beam === b));
  const save = (fn: (ov: Ov) => void) =>
    useApp.getState().commit((mm) => ({
      ...mm,
      stairs: mm.stairs.map((x) => {
        if (x.id !== region.id) return x;
        const ov = { ...(x.overrides ?? {}) };
        fn(ov);
        return { ...x, overrides: ov };
      }),
    }));
  const apply = () => {
    save((ov) => {
      for (const r of rows) ov[r.key] = { ...ov[r.key], ...(dl.trim() ? { dl: +dl } : {}), ...(ll.trim() ? { ll: +ll } : {}) };
    });
    closeDialog();
  };
  const clear = () => {
    save((ov) => rows.forEach((r) => delete ov[r.key]));
    closeDialog();
  };
  const bad = (x: string) => x.trim() !== '' && !(+x >= 0);
  return (
    <Modal
      title="Set stair loads on selected beams"
      footer={
        <>
          <button onClick={clear} disabled={!rows.length} title="Back to the calculated values">Clear</button>
          <button onClick={closeDialog}>Cancel</button>
          <button className="primary" disabled={!rows.length || (!dl.trim() && !ll.trim()) || bad(dl) || bad(ll)} onClick={apply}>Set</button>
        </>
      }
    >
      <p className="hint">{rows.length} calculated stretch(es) on {beams.length - skipped.length} beam(s). Each keeps its extent; only the value changes. Blank keeps the calculated value. Use Push loads to model to send them.</p>
      {skipped.length > 0 && <p className="hint">Skipped, no stair span bears on them: {skipped.map((b) => beamName(m, b)).join(', ')}</p>}
      <label className="row">
        <span>Stair dead (kN/m)</span>
        <input type="number" step="0.01" min="0" value={dl} placeholder="calculated" onChange={(e) => setDl(e.target.value)} />
      </label>
      <label className="row">
        <span>Stair live (kN/m)</span>
        <input type="number" step="0.01" min="0" value={ll} placeholder="calculated" onChange={(e) => setLl(e.target.value)} />
      </label>
      {rows.length > 0 && (
        <table className="grid">
          <thead>
            <tr><th>Beam</th><th>Span</th><th>From–to (mm)</th><th>DL</th><th>LL</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.name}</td>
                <td>{r.span}</td>
                <td>{r.d1.toFixed(0)} – {r.d2.toFixed(0)}</td>
                <td>{r.dl.toFixed(2)}{r.dl !== r.calc.dl && ' (set)'}</td>
                <td>{r.ll.toFixed(2)}{r.ll !== r.calc.ll && ' (set)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
