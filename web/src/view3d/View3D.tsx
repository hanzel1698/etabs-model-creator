import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useApp, sectionColor, visibleModel } from '../model/store';
import { columnOn, columnSpan, levelZ, storyElevations, type Column, type Model } from '../model/types';
import { describeJointLoad, shortFrameLoad } from '../model/loads';
import { activePattern } from '../ui/LoadDialogs';
import SectionSlider, { type Mark } from './SectionSlider';

const S = 0.001; // mm → m in the scene
const OPEN = 1e9; // clip-plane constant that clips nothing
const LOAD_COLOR = '#ff9f43'; // --load, as in the plan

export type LabelKind = 'column' | 'beam' | 'slab' | 'load';
const LABEL_KINDS: { kind: LabelKind; name: string }[] = [
  { kind: 'column', name: 'Columns' },
  { kind: 'beam', name: 'Beams' },
  { kind: 'slab', name: 'Slabs' },
  { kind: 'load', name: 'Loads' },
];

const LABEL_PX = 14; // label height on screen at the orbit target, as of the last Fit
const labelGeo = new THREE.PlaneGeometry(1, 1);

// a name tag drawn on a canvas, as a plane mesh laid along its member: the text runs along
// `axis`; frames turn only about their own axis to face the camera, slabs (`flat`) lie in their plane,
// and a `null` axis (a joint) faces the camera square on. `shift` moves the tag across its text by that
// many tag heights, so a load tag sits clear of the section tag on the same member.
function label(text: string, color: string, at: THREE.Vector3, axis: THREE.Vector3 | null, flat: boolean, shift = 0): THREE.Mesh {
  const px = 40,
    pad = 12;
  const cv = document.createElement('canvas');
  const c2 = cv.getContext('2d')!;
  const font = `${px * 0.7}px system-ui, sans-serif`;
  c2.font = font;
  cv.width = Math.ceil(c2.measureText(text).width) + 2 * pad;
  cv.height = px;
  c2.font = font;
  c2.fillStyle = 'rgba(21, 24, 29, 0.78)';
  c2.strokeStyle = color;
  c2.lineWidth = 3;
  c2.beginPath();
  c2.roundRect(1.5, 1.5, cv.width - 3, cv.height - 3, 8);
  c2.fill();
  c2.stroke();
  c2.fillStyle = '#e6ebf2';
  c2.textAlign = 'center';
  c2.textBaseline = 'middle';
  c2.fillText(text, cv.width / 2, cv.height / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const o = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  o.renderOrder = 10;
  o.position.copy(at);
  o.raycast = () => {}; // labels are never picked
  o.userData = { label: true, aspect: cv.width / cv.height, axis: axis?.normalize() ?? null, flat, at: at.clone(), shift };
  return o;
}

const _u = new THREE.Vector3(),
  _v = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _r = new THREE.Vector3(),
  _up = new THREE.Vector3(),
  _fw = new THREE.Vector3(),
  _m = new THREE.Matrix4();

// per frame: face each label toward the camera without leaving its member's orientation, keep the
// text reading left to right (bottom to top when it runs straight up the screen). Labels are `h`
// tall in the scene, so they grow and shrink with zoom like the members do.
function orientLabels(group: THREE.Group | null, camera: THREE.PerspectiveCamera, h: number, clip: THREE.Plane[]) {
  if (!group) return;
  camera.updateMatrixWorld();
  _r.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);
  _fw.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  for (const o of group.children) {
    if (!o.userData.label) continue;
    // hide labels of members cut away by the section planes
    const at = o.userData.at as THREE.Vector3;
    o.visible = clip.every((p) => p.distanceToPoint(at) >= -1e-6);
    if (!o.visible) continue;
    _n.subVectors(camera.position, at);
    if (!o.userData.axis) _u.copy(_r), _n.copy(_fw).negate();
    else if (o.userData.flat) _u.copy(o.userData.axis), _n.set(0, Math.sign(_n.y) || 1, 0);
    else {
      _u.copy(o.userData.axis);
      _n.addScaledVector(_u, -_u.dot(_n));
      if (_n.lengthSq() < 1e-12) _n.copy(_fw).negate();
      _n.normalize();
    }
    const ur = _u.dot(_r);
    if (ur < -1e-3 || (Math.abs(ur) <= 1e-3 && _u.dot(_up) < 0)) _u.negate();
    _v.crossVectors(_n, _u);
    o.quaternion.setFromRotationMatrix(_m.makeBasis(_u, _v, _n));
    o.scale.set(h * o.userData.aspect, h, 1);
    o.position.copy(at).addScaledVector(_v, o.userData.shift * h);
  }
}

// wireframe draws every member as its centreline (slabs as their outline) instead of solids
function buildWire(m: Model, sel: Set<string>, onlyStory: string | null, clip: THREE.Plane[], labels: Set<LabelKind>, pattern: string): THREE.Group {
  const g = new THREE.Group();
  const el = storyElevations(m);
  const mats = new Map<string, THREE.LineBasicMaterial>();
  const mat = (key: string, color: string) => {
    if (!mats.has(key)) mats.set(key, new THREE.LineBasicMaterial({ color: new THREE.Color(color), clippingPlanes: clip }));
    return mats.get(key)!;
  };
  const selMat = mat('__sel', '#39ff9a');
  const fills = new Map<string, THREE.MeshBasicMaterial>();
  const vis = (story: string) => !onlyStory || story === onlyStory;
  const colVis = (c: Column) => !onlyStory || columnOn(m, c, onlyStory);
  const line =(pts: THREE.Vector3[], m: THREE.Material, id: string, loop = false) => {
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const o = loop ? new THREE.LineLoop(geo, m) : new THREE.Line(geo, m);
    if (loop) o.renderOrder = -1; // slab outlines first, so beams on the same edges draw over them
    o.userData.id = id;
    g.add(o);
  };
  // the active pattern's loads, tagged as in the plan; below the section tag when that's shown too
  const loads = labels.has('load');
  const mine = <L extends { pattern: string }>(ls?: L[]) => (loads ? (ls ?? []).filter((l) => l.pattern === pattern) : []);
  const loadTag = (text: string, kind: LabelKind, at: THREE.Vector3, axis: THREE.Vector3 | null, flat = false) =>
    g.add(label(text, LOAD_COLOR, at, axis, flat, labels.has(kind) ? -1.15 : 0));

  for (const c of m.columns) {
    const e = columnSpan(el, c);
    if (!e || !colVis(c)) continue;
    const x = c.x * S,
      z = -c.y * S;
    line([new THREE.Vector3(x, e.bottom * S, z), new THREE.Vector3(x, e.top * S, z)], sel.has(c.id) ? selMat : mat('c' + c.section, sectionColor(c.section)), c.id);
    const mid = new THREE.Vector3(x, (e.bottom + e.top) * 0.5 * S, z);
    if (labels.has('column')) g.add(label(c.section, sectionColor(c.section), mid, new THREE.Vector3(0, 1, 0), false));
    const cl = mine(c.loads);
    if (cl.length) loadTag(cl.map(shortFrameLoad).join(' + '), 'column', mid, new THREE.Vector3(0, 1, 0));
  }
  for (const b of m.beams) {
    const z = levelZ(el, b);
    if (z === null || !vis(b.story)) continue;
    const y = z * S;
    line([new THREE.Vector3(b.x1 * S, y, -b.y1 * S), new THREE.Vector3(b.x2 * S, y, -b.y2 * S)], sel.has(b.id) ? selMat : mat('b' + b.section, sectionColor(b.section)), b.id);
    const mid = new THREE.Vector3(((b.x1 + b.x2) / 2) * S, y, (-(b.y1 + b.y2) / 2) * S),
      ax = new THREE.Vector3(b.x2 - b.x1, 0, -(b.y2 - b.y1));
    if (labels.has('beam')) g.add(label(b.section, sectionColor(b.section), mid, ax.clone(), false));
    const bl = mine(b.loads);
    if (bl.length) loadTag(bl.map(shortFrameLoad).join(' + '), 'beam', mid, ax);
  }
  for (const sl of m.slabs) {
    const z = levelZ(el, sl);
    if (z === null || !vis(sl.story) || !sl.pts.length) continue;
    const y = z * S;
    const color = sel.has(sl.id) ? '#39ff9a' : sectionColor(sl.section);
    line(
      sl.pts.map((p) => new THREE.Vector3(p.x * S, y, -p.y * S)),
      sel.has(sl.id) ? selMat : mat('s' + sl.section, color),
      sl.id,
      true,
    );
    // translucent plane at the story level; no depth write so lines behind it stay visible
    const key = (sel.has(sl.id) ? '__sel' : sl.section) + ' fill';
    if (!fills.has(key)) fills.set(key, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: clip }));
    const geo = new THREE.ShapeGeometry(new THREE.Shape(sl.pts.map((p) => new THREE.Vector2(p.x * S, p.y * S))));
    geo.rotateX(-Math.PI / 2);
    const plane = new THREE.Mesh(geo, fills.get(key)!);
    plane.position.y = y;
    plane.userData.id = sl.id;
    g.add(plane);
    const sll = mine(sl.loads);
    if (labels.has('slab') || sll.length) {
      const cx = sl.pts.reduce((a, p) => a + p.x, 0) / sl.pts.length,
        cy = sl.pts.reduce((a, p) => a + p.y, 0) / sl.pts.length;
      // text runs along the slab's longest edge
      let ax = new THREE.Vector3(1, 0, 0),
        best = 0;
      sl.pts.forEach((p, i) => {
        const q = sl.pts[(i + 1) % sl.pts.length],
          len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len > best) (best = len), (ax = new THREE.Vector3(q.x - p.x, 0, -(q.y - p.y)));
      });
      const at = new THREE.Vector3(cx * S, y, -cy * S);
      if (labels.has('slab')) g.add(label(sl.section, sectionColor(sl.section), at, ax.clone(), true));
      if (sll.length) loadTag(`${sll.map((l) => Math.round(l.value * 1000) / 1000).join(' + ')} kN/m²`, 'slab', at, ax, true);
    }
  }
  for (const j of loads ? m.jointLoads : []) {
    const z = levelZ(el, j);
    if (z === null || j.pattern !== pattern || !vis(j.story)) continue;
    g.add(label(`↓ ${describeJointLoad(j.f)}`, LOAD_COLOR, new THREE.Vector3(j.x * S, z * S, -j.y * S), null, false));
  }
  return g;
}

function build(m: Model, sel: Set<string>, onlyStory: string | null, clip: THREE.Plane[]): THREE.Group {
  const g = new THREE.Group();
  const el = storyElevations(m);
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  const slabSecs = new Map(m.slabSections.map((s) => [s.name, s]));
  const mats = new Map<string, THREE.Material>();
  const mat = (key: string, color: string, opacity = 1) => {
    if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color: new THREE.Color(color), transparent: opacity < 1, opacity, clippingPlanes: clip }));
    return mats.get(key)!;
  };
  const selMat = mat('__sel', '#39ff9a');
  const vis = (story: string) => !onlyStory || story === onlyStory;
  const colVis = (c: Column) => !onlyStory || columnOn(m, c, onlyStory);

  for (const c of m.columns) {
    const e = columnSpan(el, c);
    if (!e || !colVis(c)) continue;
    const s = secs.get(c.section);
    const h = (e.top - e.bottom) * S;
    let geo: THREE.BufferGeometry;
    if (s?.shape === 'Circle') geo = new THREE.CylinderGeometry((s.t3 / 2) * S, (s.t3 / 2) * S, h, 20);
    else geo = new THREE.BoxGeometry((s?.t3 || 400) * S, h, (s?.t2 || 400) * S);
    const mesh = new THREE.Mesh(geo, sel.has(c.id) ? selMat : mat('c' + c.section, sectionColor(c.section)));
    // three: Y up. model (x, y, z) → three (x, z, -y)
    mesh.position.set(c.x * S, (e.bottom + e.top) * 0.5 * S, -c.y * S);
    mesh.rotation.y = (c.angle * Math.PI) / 180;
    mesh.userData.id = c.id;
    g.add(mesh);
  }
  for (const b of m.beams) {
    const z = levelZ(el, b);
    if (z === null || !vis(b.story)) continue;
    const s = secs.get(b.section);
    const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) * S;
    const d = (s?.t3 || 500) * S,
      w = (s?.shape === 'Circle' ? s.t3 : s?.t2 || 300) * S;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, d, w), sel.has(b.id) ? selMat : mat('b' + b.section, sectionColor(b.section)));
    mesh.position.set(((b.x1 + b.x2) / 2) * S, z * S - d / 2, (-(b.y1 + b.y2) / 2) * S);
    mesh.rotation.y = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
    mesh.userData.id = b.id;
    g.add(mesh);
  }
  for (const sl of m.slabs) {
    const z = levelZ(el, sl);
    if (z === null || !vis(sl.story)) continue;
    const t = (slabSecs.get(sl.section)?.thickness || 150) * S;
    const shape = new THREE.Shape(sl.pts.map((p) => new THREE.Vector2(p.x * S, p.y * S)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    // shape lies in XY (model plan); rotate so plan Y → -Z and extrude goes down from the story level
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, sel.has(sl.id) ? selMat : mat('s' + sl.section, sectionColor(sl.section), 0.45));
    mesh.position.y = z * S - t;
    mesh.userData.id = sl.id;
    g.add(mesh);
  }
  return g;
}

const stencilMat = (side: THREE.Side, op: THREE.StencilOp, transparent: boolean, plane: THREE.Plane) =>
  new THREE.MeshBasicMaterial({
    side,
    transparent,
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    clippingPlanes: [plane],
    stencilWrite: true,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilFail: op,
    stencilZFail: op,
    stencilZPass: op,
  });

// Solid section faces for members cut by the clip planes (stencil capping, as in three's
// webgl_clipping_stencil example). Per plane and per material: the members' back faces add 1 to the
// stencil and their front faces subtract 1, both clipped by that plane only, so the stencil is non-zero
// exactly where the cut opened a member; a big plane lying on the cut then fills those pixels in the
// member's colour. Members are merged per material to keep it to three draws per material and plane.
// Plane groups are shown/positioned by syncCaps as the cuts move.
function buildCaps(g: THREE.Group, clip: THREE.Plane[]): THREE.Group {
  const caps = new THREE.Group();
  const byMat = new Map<THREE.MeshLambertMaterial, THREE.BufferGeometry[]>();
  for (const o of g.children) {
    if (!(o instanceof THREE.Mesh)) continue;
    o.updateMatrix();
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position') geo.deleteAttribute(k);
    geo.clearGroups();
    geo.applyMatrix4(o.matrix);
    const m = o.material as THREE.MeshLambertMaterial;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m)!.push(geo);
  }
  const merged = [...byMat].map(([m, geos]) => {
    const geo = mergeGeometries(geos);
    geos.forEach((x) => x.dispose());
    return [m, geo] as const;
  });
  const box = new THREE.Box3().setFromObject(g);
  if (box.isEmpty()) return caps;
  caps.userData.center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() * 2 + 1;
  let order = 1;
  clip.forEach((plane, i) => {
    const pg = new THREE.Group();
    pg.userData.plane = i;
    const others = clip.filter((p) => p !== plane);
    for (const [m, geo] of merged) {
      const back = new THREE.Mesh(geo, stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp, m.transparent, plane));
      const front = new THREE.Mesh(geo, stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp, m.transparent, plane));
      const cap = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshLambertMaterial({
          color: m.color.clone(),
          transparent: m.transparent,
          opacity: m.opacity,
          side: THREE.DoubleSide,
          clippingPlanes: others,
          stencilWrite: true,
          stencilRef: 0,
          stencilFunc: THREE.NotEqualStencilFunc,
          stencilFail: THREE.ReplaceStencilOp,
          stencilZFail: THREE.ReplaceStencilOp,
          stencilZPass: THREE.ReplaceStencilOp,
        }),
      );
      cap.onAfterRender = (r) => r.clearStencil();
      cap.userData.cap = true;
      back.renderOrder = front.renderOrder = order;
      cap.renderOrder = order + 1;
      order += 2;
      pg.add(back, front, cap);
    }
    caps.add(pg);
  });
  return caps;
}

// show the cap groups of the active planes and lay each cap on its plane, centred on the model
function syncCaps(caps: THREE.Group | null, clip: THREE.Plane[]) {
  const ctr = caps?.userData.center as THREE.Vector3 | undefined;
  if (!caps || !ctr) return;
  for (const pg of caps.children) {
    const plane = clip[pg.userData.plane as number];
    pg.visible = plane.constant !== OPEN;
    for (const o of pg.children) {
      if (!o.userData.cap) continue;
      plane.projectPoint(ctr, o.position);
      o.lookAt(o.position.clone().sub(plane.normal));
    }
  }
}

// one section range over a sorted list of marks (mm); the full range means no cut
function useCut(marks: Mark[]) {
  const [cut, setCut] = useState<{ lo: number; hi: number } | null>(null);
  const min = marks[0]?.at ?? 0,
    max = marks[marks.length - 1]?.at ?? 0;
  const lo = cut ? Math.max(min, Math.min(cut.lo, max)) : min;
  const hi = cut ? Math.min(max, Math.max(cut.hi, lo)) : max;
  return { marks, min, max, lo, hi, set: (l: number, h: number) => setCut(l <= min && h >= max ? null : { lo: l, hi: h }) };
}

const gridMarks = (m: Model, dir: 'X' | 'Y'): Mark[] =>
  m.grids
    .filter((g) => g.dir === dir)
    .map((g) => ({ name: g.label, at: dir === 'X' ? g.x1 : g.y1 }))
    .sort((a, b) => a.at - b.at);

export default function View3D() {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group | null; caps: THREE.Group | null; clip: THREE.Plane[]; labelH: number; labelScale: number; render: () => void } | null>(null);
  const model = useApp(visibleModel);
  const selection = useApp((s) => s.selection);
  const activeStory = useApp((s) => s.activeStory);
  const pattern = useApp(activePattern);
  const [onlyStory, setOnlyStory] = useState(false);
  const [wire, setWire] = useState(false);
  const [labels, setLabels] = useState<Set<LabelKind>>(new Set());
  const [labelScale, setLabelScale] = useState(1); // multiplies the fitted label size
  const toggleLabel = (k: LabelKind) =>
    setLabels((cur) => {
      const n = new Set(cur);
      if (!n.delete(k)) n.add(k);
      return n;
    });
  const fitted = useRef(false);
  // section cuts: by elevation, by X grids and by Y grids
  const zCut = useCut(
    useMemo(() => {
      const el = storyElevations(model);
      return [{ name: 'Base', at: model.baseElevation }, ...model.stories.map((s) => ({ name: s.name, at: el[s.name].top }))];
    }, [model.stories, model.baseElevation]),
  );
  const xCut = useCut(useMemo(() => gridMarks(model, 'X'), [model.grids]));
  const yCut = useCut(useMemo(() => gridMarks(model, 'Y'), [model.grids]));
  // a grid cut sitting on a grid line is widened by this much so members on that grid stay whole:
  // half the largest column/beam cross-section in the model
  const gridPad = useMemo(() => {
    const secs = new Map(model.frameSections.map((s) => [s.name, s]));
    let r = 0;
    for (const c of model.columns) {
      const s = secs.get(c.section);
      if (s) r = Math.max(r, s.shape === 'Circle' ? s.t3 / 2 : Math.hypot(s.t2, s.t3) / 2);
    }
    for (const b of model.beams) {
      const s = secs.get(b.section);
      if (s) r = Math.max(r, (s.shape === 'Circle' ? s.t3 : s.t2) / 2);
    }
    return r + 1;
  }, [model.columns, model.beams, model.frameSections]);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true }); // stencil: section caps
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x15181d);
    renderer.localClippingEnabled = true;
    // pairs of (keep >= lo, keep <= hi) planes for elevation, model x and model y (three: x, y up, z = -model y)
    const clip = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 1),
    ].map((n) => new THREE.Plane(n, OPEN));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
    const dl = new THREE.DirectionalLight(0xffffff, 1.4);
    dl.position.set(30, 60, 40);
    scene.add(dl);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    camera.position.set(40, 30, 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15;
    const grid = new THREE.GridHelper(200, 40, 0x2c3440, 0x22282f);
    scene.add(grid);
    let raf = 0;
    const render = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (controls.update()) render();
        const c = ctx.current;
        if (c && !c.labelH)
          // size the labels in the scene so they're LABEL_PX tall at the orbit target from here
          c.labelH = (LABEL_PX * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.distanceTo(controls.target)) / Math.max(1, el.clientHeight);
        orientLabels(c?.group ?? null, camera, (c?.labelH ?? 0) * (c?.labelScale ?? 1), clip);
        renderer.render(scene, camera);
      });
    };
    controls.addEventListener('change', render);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      render();
    });
    ro.observe(el);
    // click to select
    const ray = new THREE.Raycaster();
    ray.params.Line.threshold = 0.15; // m: how close a click must be to a wireframe line
    let downAt = { x: 0, y: 0 };
    const pd = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || !ctx.current?.group) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const clip = ctx.current.clip;
      const hits = ray.intersectObjects(ctx.current.group.children).filter((h) => clip.every((p) => p.distanceToPoint(h.point) >= -1e-6));
      // in wireframe a line on the edge of a slab plane wins over the plane (but not one on a floor further back)
      const hit = hits.find((h) => h.object instanceof THREE.Line && h.distance <= hits[0].distance + 0.3) ?? hits[0];
      const st = useApp.getState();
      const id = hit?.object.userData.id as string | undefined;
      if (!id) return st.setSelection([]);
      const story = [...st.model.columns, ...st.model.beams, ...st.model.slabs].find((x) => x.id === id)?.story;
      if (story && story !== st.activeStory) st.setActiveStory(story);
      st.setSelection(e.shiftKey ? [...st.selection, id] : [id]);
    };
    renderer.domElement.addEventListener('pointerdown', pd);
    renderer.domElement.addEventListener('pointerup', pu);
    ctx.current = { renderer, scene, camera, controls, group: null, caps: null, clip, labelH: 0, labelScale: 1, render };
    return () => {
      ro.disconnect();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (c.group) {
      c.scene.remove(c.group);
      c.group.traverse((o) => {
        if (!o.userData.label) return (o as THREE.Mesh).geometry?.dispose();
        // labels share one plane geometry but own their canvas texture and material
        const lm = (o as THREE.Mesh).material as THREE.MeshBasicMaterial;
        lm.map?.dispose();
        lm.dispose();
      });
    }
    if (c.caps) {
      c.scene.remove(c.caps);
      c.caps.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      });
      c.caps = null;
    }
    const story = onlyStory ? activeStory : null;
    c.group = wire ? buildWire(model, new Set(selection), story, c.clip, labels, pattern) : build(model, new Set(selection), story, c.clip);
    c.scene.add(c.group);
    if (!wire) {
      c.caps = buildCaps(c.group, c.clip);
      syncCaps(c.caps, c.clip);
      c.scene.add(c.caps);
    }
    if (!fitted.current && c.group.children.length) {
      fitView();
      fitted.current = true;
    }
    c.render();
  }, [model, selection, onlyStory, activeStory, wire, labels, pattern]);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    // tiny slack so faces lying exactly on a cut level aren't shaved off
    const eps = 0.5;
    [zCut, xCut, yCut].forEach((k, i) => {
      const slack = (v: number) => (i > 0 && k.marks.some((m) => Math.abs(m.at - v) < 1e-6) ? gridPad : eps);
      c.clip[2 * i].constant = k.lo > k.min ? -(k.lo - slack(k.lo)) * S : OPEN;
      c.clip[2 * i + 1].constant = k.hi < k.max ? (k.hi + slack(k.hi)) * S : OPEN;
    });
    syncCaps(c.caps, c.clip);
    c.render();
  }, [zCut.lo, zCut.hi, zCut.min, zCut.max, xCut.lo, xCut.hi, xCut.min, xCut.max, yCut.lo, yCut.hi, yCut.min, yCut.max, gridPad]);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.labelScale = labelScale;
    c.render();
  }, [labelScale]);

  const fitView = () => {
    const c = ctx.current;
    if (!c?.group) return;
    const box = new THREE.Box3().setFromObject(c.group);
    if (box.isEmpty()) return;
    const ctr = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    c.controls.target.copy(ctr);
    c.camera.position.copy(ctr).add(new THREE.Vector3(0.8, 0.6, 0.9).normalize().multiplyScalar(size * 1.5));
    c.camera.near = size / 1000;
    c.camera.far = size * 20;
    c.camera.updateProjectionMatrix();
    c.labelH = 0; // re-size the labels for the fitted view
    c.render();
  };

  return (
    <div className="view3d" ref={host}>
      <div className="bar">
        <button onClick={fitView}>Fit</button>
        <button className={onlyStory ? 'on' : ''} onClick={() => setOnlyStory(!onlyStory)}>
          Active story only
        </button>
        <button
          title="Clear all section cuts and Active story only"
          disabled={!onlyStory && ![zCut, xCut, yCut].some((k) => k.lo > k.min || k.hi < k.max)}
          onClick={() => {
            [zCut, xCut, yCut].forEach((k) => k.set(k.min, k.max));
            setOnlyStory(false);
          }}
        >
          Reset 3D view
        </button>
        <button className={wire ? 'on' : ''} title="Show members as centrelines and slabs as translucent planes" onClick={() => setWire(!wire)}>
          Wireframe
        </button>
        {wire && (
          <span className="label-picks" title="Show section names">
            Names:
            {LABEL_KINDS.map(({ kind, name }) => (
              <button key={kind} className={labels.has(kind) ? 'on' : ''} title={kind === 'load' ? `Show the loads of the active pattern (${pattern})` : undefined} onClick={() => toggleLabel(kind)}>
                {name}
              </button>
            ))}
            <span className="label-size" title="Name size">
              Size
              <input type="range" min={0.5} max={1.5} step={0.05} value={labelScale} onChange={(e) => setLabelScale(+e.target.value)} />
            </span>
          </span>
        )}
      </div>
      <SectionSlider side="right" title="Section by elevation" marks={zCut.marks} lo={zCut.lo} hi={zCut.hi} onChange={zCut.set} />
      {xCut.marks.length > 1 && <SectionSlider side="bottom" title="Section along X grids" marks={xCut.marks} lo={xCut.lo} hi={xCut.hi} onChange={xCut.set} />}
      {yCut.marks.length > 1 && <SectionSlider side="left" title="Section along Y grids" marks={yCut.marks} lo={yCut.lo} hi={yCut.hi} onChange={yCut.set} />}
    </div>
  );
}
