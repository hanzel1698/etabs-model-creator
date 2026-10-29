import { useState } from 'react';
import { toast, useApp } from '../model/store';
import { issueKey, modelIssues, type Issue, type IssueKind } from '../model/checks';
import { log } from '../log/sessionLog';
import { viewport } from '../plan/viewport';
import type { Model, Pt } from '../model/types';

const LABEL: Record<IssueKind, string> = { duplicate: 'Duplicate', overlap: 'Overlap', degenerate: 'Zero size', section: 'Section', story: 'Story', load: 'Load' };

export const useIssues = () => useApp((s) => modelIssues(s.model));

/** Warn (toast + session log) whenever an edit, undo or file open brings in issues that weren't there before. */
export function watchIssues() {
  let known = new Set(modelIssues(useApp.getState().model).map(issueKey));
  return useApp.subscribe((s, prev) => {
    if (s.model === prev.model) return;
    const issues = modelIssues(s.model);
    const fresh = issues.filter((i) => !known.has(issueKey(i)));
    known = new Set(issues.map(issueKey));
    if (!fresh.length) return;
    fresh.forEach((i) => log('check', (i.story ? i.story + ': ' : '') + i.text, 'warn'));
    const first = fresh[0];
    toast(`⚠ ${first.story ? first.story + ': ' : ''}${first.text}${fresh.length > 1 ? ` (+${fresh.length - 1} more, see Model check)` : ''}`);
  });
}

function elementPts(m: Model, ids: Set<string>): Pt[] {
  return [
    ...m.columns.filter((c) => ids.has(c.id)),
    ...m.beams.filter((b) => ids.has(b.id)).flatMap((b) => [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 }]),
    ...m.slabs.filter((s) => ids.has(s.id)).flatMap((s) => s.pts),
  ];
}

/** Show an issue: go to its story, select the elements involved (unhiding them) and zoom to them. */
export function goToIssue(i: Issue) {
  const st = useApp.getState();
  if (i.story && i.story !== st.activeStory && st.model.stories.some((s) => s.name === i.story)) st.setActiveStory(i.story);
  const ids = new Set(i.ids);
  useApp.setState((s) => ({ hidden: s.hidden.filter((id) => !ids.has(id)), selection: i.ids }));
  if (st.panel === '3d' || st.panel === 'elev') st.setPanel('split');
  const pts = elementPts(st.model, ids);
  if (!pts.length) pts.push(i.at);
  const pad = 2000;
  requestAnimationFrame(() => {
    const el = document.getElementById('plan-host');
    viewport.fit(Math.min(...pts.map((p) => p.x)) - pad, Math.min(...pts.map((p) => p.y)) - pad, Math.max(...pts.map((p) => p.x)) + pad, Math.max(...pts.map((p) => p.y)) + pad, el?.clientWidth ?? 800, el?.clientHeight ?? 600);
  });
}

/** Right-panel list of everything the model check found. */
export function ChecksSection() {
  const issues = useIssues();
  const story = useApp((s) => s.activeStory);
  const [onlyStory, setOnlyStory] = useState(false);
  const shown = onlyStory ? issues.filter((i) => i.story === story || !i.story) : issues;
  return (
    <div className="section">
      <h4>
        Model check <span className={issues.length ? 'warn-count' : 'muted'}>{issues.length || 'OK'}</span>
      </h4>
      {!issues.length ? (
        <div className="muted small">No duplicate, overlapping or zero-size elements, and every section and story exists.</div>
      ) : (
        <>
          <label className="small">
            <input type="checkbox" checked={onlyStory} onChange={() => setOnlyStory(!onlyStory)} /> Only {story}
          </label>
          <div className="issues">
            {shown.map((i) => (
              <button key={issueKey(i)} className="issue" onClick={() => goToIssue(i)} title="Go to it and select the elements involved">
                <span className={'issue-kind ' + i.kind}>{LABEL[i.kind]}</span>
                {i.story && <b>{i.story}</b>} {i.text}
              </button>
            ))}
            {!shown.length && <div className="muted small">Nothing on {story}.</div>}
          </div>
        </>
      )}
    </div>
  );
}

/** Status-bar count; each click jumps to the next issue. */
export function IssueBadge() {
  const issues = useIssues();
  const [n, setN] = useState(0);
  if (!issues.length) return null;
  return (
    <button
      className="issue-badge"
      title={`${issues.length} model check warning${issues.length === 1 ? '' : 's'}: click to step through them`}
      onClick={() => {
        goToIssue(issues[n % issues.length]);
        setN(n + 1);
      }}
    >
      ⚠ {issues.length}
    </button>
  );
}
