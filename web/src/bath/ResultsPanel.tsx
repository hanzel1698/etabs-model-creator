/**
 * The answer: for every beam the section cuts, does it catch the slabs beside
 * it, and if not how deep would it need to be.
 *
 * Two faces are checked on every beam, so every beam gets two rows: the top,
 * which the slab bears on, and the soffit, which has to reach under it. A beam
 * fails if either row does — a sink deep enough for the slab on one side often
 * strands the slab on the other, and that only shows on the top row.
 *
 * A third row appears only when the beam's ENDS are not caught. That is a
 * separate fault with a separate fix — it is answered by putting something under
 * the end, not by re-levelling the beam — so it gets its own row rather than
 * being folded into the two face rows, whose Level/Slab/Margin columns say
 * nothing about it. The plan carries the same finding as a leader and text box
 * against the offending end.
 */

import { Fragment } from 'react';
import type { BeamCheck } from './engine/checks';
import { summarise } from './engine/checks';
import type { SectionRun } from './engine/types';

interface Props {
  checks: BeamCheck[];
  run: SectionRun;
}

const signed = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value)}`;

export function ResultsPanel({ checks, run }: Props) {
  const { total, failing } = summarise(checks);
  const uncaught = checks.reduce((n, c) => n + c.endBearing.filter((e) => !e.pass).length, 0);

  return (
    <div className="results">
      <header className="results-header">
        <h2>Catch check</h2>
        {total > 0 && (
          <span className={failing === 0 ? 'verdict verdict--pass' : 'verdict verdict--fail'}>
            {failing === 0 ? `${total} beam${total === 1 ? '' : 's'} OK` : `${failing} of ${total} fail`}
          </span>
        )}
        {uncaught > 0 && (
          <span className="verdict verdict--fail">
            {uncaught} end{uncaught === 1 ? '' : 's'} uncaught
          </span>
        )}
      </header>

      {run.warnings.map((warning) => (
        <p key={warning} className="warning">
          {warning}
        </p>
      ))}

      {total === 0 ? (
        <p className="empty-note">No beams on this section line.</p>
      ) : (
        <table className="results-table">
          <thead>
            <tr>
              <th>Beam</th>
              <th>Face</th>
              <th>Level</th>
              <th>Slab</th>
              <th>Margin</th>
              <th>Needs</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => {
              // The two faces can be governed by different sides: the flush slab
              // usually decides the top, the sunken one the soffit.
              const top = check.sides.find((s) => s.side === check.governingTopSide);
              const soffit = check.sides.find((s) => s.side === check.governingSide);
              const rowClass = check.pass ? '' : 'row--fail';
              const topFails = check.sides.some((s) => !s.topPass);
              const tooShallow = Math.round(check.requiredDepth) > Math.round(check.depth);
              const badEnds = check.endBearing.filter((e) => !e.pass);
              const rows = badEnds.length > 0 ? 3 : 2;

              return (
                <Fragment key={`${check.beamId}-${check.d0}`}>
                  <tr className={`row--face-top ${rowClass}`}>
                    <td rowSpan={rows}>
                      <strong>{check.label}</strong>
                      {check.sides.length > 0 && (
                        <span className="sides">
                          {check.sides.map((s) => s.slabLabel).join(' | ')}
                        </span>
                      )}
                    </td>
                    <td>Top</td>
                    <td>{check.topLevel}</td>
                    <td>{top ? top.slabTop : '—'}</td>
                    <td className={top ? (top.topPass ? 'ok' : 'bad') : ''}>
                      {top ? signed(top.topMargin) : '—'}
                    </td>
                    <td rowSpan={2}>
                      {check.pass ? (
                        '—'
                      ) : (
                        <>
                          {topFails && (
                            <span className="needs-line">top {check.requiredTopLevel}</span>
                          )}
                          {tooShallow && (
                            <span className="needs-line">{Math.round(check.requiredDepth)} deep</span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                  <tr className={`${rowClass} ${rows === 3 ? 'row--joined' : ''}`}>
                    <td>Soffit</td>
                    <td>{check.soffitLevel}</td>
                    <td>{soffit ? soffit.slabSoffit : '—'}</td>
                    <td className={soffit ? (soffit.soffitPass ? 'ok' : 'bad') : ''}>
                      {soffit ? signed(soffit.margin) : '—'}
                    </td>
                  </tr>
                  {badEnds.length > 0 && (
                    <tr className="row--fail row--ends">
                      <td>Ends</td>
                      <td className="bad" colSpan={4}>
                        {badEnds
                          .map(
                            (e) =>
                              `${e.which === 'start' ? 'first end' : 'far end'}: ${e.note}` +
                              (e.supports.length
                                ? ` (on ${e.supports.map((s) => s.label).join(' + ')})`
                                : ''),
                          )
                          .join(' · ')}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      {checks.some((c) => c.warnings.length + c.bearingWarnings.length > 0) && (
        <div className="check-warnings">
          {[...new Set(checks.flatMap((c) => [...c.warnings, ...c.bearingWarnings]))].map(
            (warning) => (
              <p key={warning} className="warning">
                {warning}
              </p>
            ),
          )}
        </div>
      )}

      <p className="legend">
        Levels are millimetres below the general floor slab structural concrete top.
        The soffit margin is how far the beam soffit reaches past the slab soffit; the
        top margin is how far the beam top sits above the slab top. Either one negative
        means the beam cannot catch that slab — <em>top</em> is the level it must come
        back up to, <em>deep</em> the overall depth it then needs. The <em>Ends</em> row
        is the other half of the check: a column catches any beam, but a beam or an
        upstand catches only the depth it has itself, so it is flagged when part of the
        beam landing on it has nothing under it.
      </p>
    </div>
  );
}
