import { useEffect, useState } from 'react';
import { useApp } from '../model/store';
import { storyElevations } from '../model/types';
import { openDialog } from './dialogState';
import { SectionOptions } from './sectionGroups';
import { autoBeamsOnGrids } from '../model/ops';
import { fitAll } from '../plan/PlanView';
import { fmt } from '../model/geom';

export function LeftPanel() {
  const model = useApp((s) => s.model);
  const active = useApp((s) => s.activeStory);
  const also = useApp((s) => s.alsoStories);
  const act = useApp((s) => s.active);
  const angle = useApp((s) => s.columnAngle);
  const tool = useApp((s) => s.tool);
  const st = useApp.getState();
  const el = storyElevations(model);
  const stories = [...model.stories].reverse();

  return (
    <div className="side">
      <div className="section">
        <h4>
          Stories <button onClick={() => openDialog({ kind: 'stories' })}>Edit</button>
        </h4>
        <div className="stories">
          {stories.map((s) => (
            <div key={s.name} className={'story ' + (s.name === active ? 'active' : '')} onClick={() => st.setActiveStory(s.name)}>
              <input
                type="checkbox"
                title="Also draw on this story"
                checked={s.name === active || also.includes(s.name)}
                disabled={s.name === active}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => st.setAlsoStories(e.target.checked ? [...also, s.name] : also.filter((x) => x !== s.name))}
              />
              {s.name}
              <span className="elev">{fmt(el[s.name].top)}</span>
            </div>
          ))}
          <div className="story muted small">
            Base <span className="elev">{fmt(model.baseElevation)}</span>
          </div>
        </div>
        <div className="row small muted" style={{ marginTop: 4 }}>
          Ticked stories also receive new elements.
        </div>
        <div className="chips">
          <button onClick={() => st.setAlsoStories(model.stories.map((s) => s.name))}>Tick all</button>
          <button onClick={() => st.setAlsoStories(model.stories.filter((s) => s.similarTo === active || s.name === active).map((s) => s.name))}>Similar</button>
          <button onClick={() => st.setAlsoStories([])}>None</button>
        </div>
      </div>

      <div className="section">
        <h4>
          Active sections <button onClick={() => openDialog({ kind: 'sections' })}>Manage</button>
        </h4>
        <div className="row">
          <span>Column</span>
          <select value={act.column} onChange={(e) => st.setActive('column', e.target.value)}>
            <SectionOptions sections={model.frameSections} prefer="Columns" />
          </select>
        </div>
        <div className="row">
          <span>Angle°</span>
          <input type="number" value={angle} step={15} onChange={(e) => st.setColumnAngle(+e.target.value || 0)} />
        </div>
        {tool === 'column' && <ColumnAlign />}
        <div className="row">
          <span>Beam</span>
          <select value={act.beam} onChange={(e) => st.setActive('beam', e.target.value)}>
            <SectionOptions sections={model.frameSections} prefer="Beams" />
          </select>
        </div>
        <div className="row">
          <span>Slab</span>
          <select value={act.slab} onChange={(e) => st.setActive('slab', e.target.value)}>
            {model.slabSections.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="section">
        <h4>Quick build</h4>
        <div className="chips">
          <button onClick={() => openDialog({ kind: 'grids' })}>Generate grids…</button>
          <button
            title="Beams along grid lines between consecutive columns on the active story"
            onClick={() => {
              for (const s of [active, ...also]) st.commit((m) => autoBeamsOnGrids(m, s, act.beam));
            }}
          >
            Beams on grids
          </button>
        </div>
      </div>

      <div className="section">
        <h4>View</h4>
        <ViewControls />
      </div>
    </div>
  );
}

/** Column tool option: keep new columns on a vertical/horizontal line through a picked point. */
function ColumnAlign() {
  const al = useApp((s) => s.colAlign);
  const set = useApp((s) => s.setColAlign);
  const faces = al.mode === 'y' ? (['Bottom face', 'Top face'] as const) : (['Left face', 'Right face'] as const);
  return (
    <div style={{ borderLeft: '2px solid #ff9f43', paddingLeft: 6, marginBottom: 6 }}>
      <div className="row">
        <span>Align</span>
        <select value={al.mode} onChange={(e) => set({ mode: e.target.value as any })}>
          <option value="off">Off</option>
          <option value="x">Vertical (same X)</option>
          <option value="y">Horizontal (same Y)</option>
        </select>
      </div>
      {al.mode !== 'off' && (
        <>
          <div className="row">
            <span>On line</span>
            <select value={al.anchor} onChange={(e) => set({ anchor: e.target.value as any })}>
              <option value="center">Centre</option>
              <option value="min">{faces[0]}</option>
              <option value="max">{faces[1]}</option>
            </select>
          </div>
          <div className="row small">
            <button className={al.picking ? 'on' : ''} onClick={() => set({ picking: !al.picking })} title="Then click a point on the plan (snaps to underlay, grids, columns...)">
              {al.picking ? 'Click a point…' : al.ref ? 'Re-pick point' : 'Pick point'}
            </button>
            <span className="muted" style={{ width: 'auto' }}>
              {al.ref ? `${al.mode === 'x' ? 'X' : 'Y'} = ${fmt(al.mode === 'x' ? al.ref.x : al.ref.y)}` : 'no point yet'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** Grid bubble diameter in mm: slider for quick changes, number box for an exact size (applied on Enter/blur). */
function BubbleSize() {
  const d = useApp((s) => s.gridBubble);
  const set = useApp((s) => s.setGridBubble);
  const [draft, setDraft] = useState(String(d));
  useEffect(() => setDraft(String(d)), [d]);
  return (
    <div className="row" title="Grid bubble diameter (mm). The label text scales with it.">
      <span>Grid Ø</span>
      <input type="range" min={100} max={3000} step={50} value={d} style={{ minWidth: 0, width: 0 }} onChange={(e) => set(+e.target.value)} />
      <input
        type="number"
        style={{ width: 62, flex: 'none' }}
        min={50}
        step={50}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => set(+draft)}
        onKeyDown={(e) => e.key === 'Enter' && set(+draft)}
      />
    </div>
  );
}

function ViewControls() {
  const show = useApp((s) => s.show);
  const rot = useApp((s) => s.viewRotation);
  const ts = useApp((s) => s.textScale);
  const colorBy = useApp((s) => s.colorBySection);
  const st = useApp.getState();
  const toggles: [keyof typeof show, string][] = [
    ['sectionLabels', 'Section labels'],
    ['gridLabels', 'Grid bubbles'],
    ['ghostBelow', 'Story below (ghost)'],
    ['underlay', 'Underlay'],
    ['slabs', 'Slabs'],
  ];
  return (
    <>
      {toggles.map(([k, l]) => (
        <label key={k} className="small">
          <input type="checkbox" checked={show[k]} onChange={() => st.toggleShow(k)} /> {l}
        </label>
      ))}
      <label className="small">
        <input type="checkbox" checked={colorBy} onChange={st.toggleColorBySection} /> Colour by section
      </label>
      <div className="row" style={{ marginTop: 6 }}>
        <span>Text size</span>
        <input type="range" min={0.4} max={3} step={0.1} value={ts} onChange={(e) => st.setTextScale(+e.target.value)} />
      </div>
      <BubbleSize />

      <div className="row">
        <span>Rotate°</span>
        <input type="number" value={rot} step={15} onChange={(e) => st.setViewRotation(+e.target.value || 0)} />
      </div>
      <div className="chips">
        <button onClick={() => st.setViewRotation(rot - 90)}>⟲ 90</button>
        <button onClick={() => st.setViewRotation(rot + 90)}>⟳ 90</button>
        <button
          title="Align the view to the selected grid/beam"
          onClick={() => {
            const m = st.model;
            const id = st.selection[0];
            const g = m.grids.find((x) => x.id === id) ?? m.beams.find((x) => x.id === id);
            if (!g) return st.setToast('Select a grid or beam to align the view to.');
            const a = (Math.atan2(g.y2 - g.y1, g.x2 - g.x1) * 180) / Math.PI;
            st.setViewRotation(-a);
          }}
        >
          Align to selection
        </button>
        <button onClick={() => st.setViewRotation(0)}>Reset</button>
        <button onClick={() => fitAll()} title="F">Fit</button>
      </div>
    </>
  );
}
