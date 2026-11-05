import { useApp, viewModel } from '../model/store';
import { storyElevations } from '../model/types';
import { fmt } from '../model/geom';
import { setTool } from '../plan/tools';
import { deleteStair, renameStair } from '../stair/regions';

/** Left panel list of stair boxes: draw one, open one to design it, rename, delete. */
export function StairsList() {
  const stairs = useApp((s) => s.model.stairs);
  const tool = useApp((s) => s.tool);
  return (
    <div className="section">
      <h4>
        Stairs{' '}
        <button className={tool === 'stairBox' ? 'on' : ''} title="Draw a box around a stair on any plan; it gets a name like STAIR-01" onClick={() => setTool('stairBox')}>
          + Box
        </button>
      </h4>
      {!stairs.length && <div className="small muted">No stairs yet. Draw a box around one on the plan.</div>}
      {stairs.map((r) => (
        <div key={r.id} className="row stair-row">
          <span className="stair-name">{r.name}</span>
          <button className="primary" title="Design this stair" onClick={() => useApp.getState().enterStair(r.id)}>Open</button>
          <button title="Rename" aria-label={`Rename ${r.name}`} onClick={() => renameStair(r.id)}>✎</button>
          <button className="danger" title="Delete this stair and everything drawn in it" aria-label={`Delete ${r.name}`} onClick={() => deleteStair(r.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

/** Left panel while designing a stair: its stories (read-only building levels in its box) and the way back. */
export function StairSide() {
  const st = useApp.getState();
  const r = useApp((s) => s.model.stairs.find((x) => x.id === s.activeStair));
  const m = useApp(viewModel);
  const active = useApp((s) => s.activeStory);
  if (!r) return null;
  const el = storyElevations(m);
  return (
    <div className="side">
      <div className="section">
        <h4>
          {r.name} <button onClick={st.exitStair}>Back to model</button>
        </h4>
        <div className="small muted">
          Box {fmt(r.x2 - r.x1)} × {fmt(r.y2 - r.y1)} mm. The building's grids, columns and beams in it are shown read-only; edit them in the model.
        </div>
      </div>
      <div className="section">
        <h4>Stories</h4>
        <div className="stories">
          {[...m.stories].reverse().map((s) => (
            <div key={s.name} className={'story ' + (s.name === active ? 'active' : '')} onClick={() => st.setActiveStory(s.name)}>
              {s.name}
              <span className="elev">{fmt(el[s.name].top)}</span>
            </div>
          ))}
          <div className="story muted small">
            Base <span className="elev">{fmt(m.baseElevation)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
