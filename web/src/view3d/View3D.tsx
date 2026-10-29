import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useApp, sectionColor, visibleModel } from '../model/store';
import { storyElevations, type Model } from '../model/types';
import SectionSlider from './SectionSlider';

const S = 0.001; // mm → m in the scene
const OPEN = 1e9; // clip-plane constant that clips nothing

function build(m: Model, sel: Set<string>, onlyStory: string | null, clip: THREE.Plane[]): THREE.Group {
  const g = new THREE.Group();
  const el = storyElevations(m);
  const secs = new Map(m.frameSections.map((s) => [s.name, s]));
  const slabSecs = new Map(m.slabSections.map((s) => [s.name, s]));
  const mats = new Map<string, THREE.Material>();
  const mat = (key: string, color: string, opacity = 1) => {
    // double-sided so members cut by the section planes show their insides instead of vanishing faces
    if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color: new THREE.Color(color), transparent: opacity < 1, opacity, clippingPlanes: clip, side: THREE.DoubleSide }));
    return mats.get(key)!;
  };
  const selMat = mat('__sel', '#39ff9a');
  const vis = (story: string) => !onlyStory || story === onlyStory;

  for (const c of m.columns) {
    const e = el[c.story];
    if (!e || !vis(c.story)) continue;
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
    const e = el[b.story];
    if (!e || !vis(b.story)) continue;
    const s = secs.get(b.section);
    const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) * S;
    const d = (s?.t3 || 500) * S,
      w = (s?.shape === 'Circle' ? s.t3 : s?.t2 || 300) * S;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L, d, w), sel.has(b.id) ? selMat : mat('b' + b.section, sectionColor(b.section)));
    mesh.position.set(((b.x1 + b.x2) / 2) * S, e.top * S - d / 2, (-(b.y1 + b.y2) / 2) * S);
    mesh.rotation.y = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
    mesh.userData.id = b.id;
    g.add(mesh);
  }
  for (const sl of m.slabs) {
    const e = el[sl.story];
    if (!e || !vis(sl.story)) continue;
    const t = (slabSecs.get(sl.section)?.thickness || 150) * S;
    const shape = new THREE.Shape(sl.pts.map((p) => new THREE.Vector2(p.x * S, p.y * S)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    // shape lies in XY (model plan); rotate so plan Y → -Z and extrude goes down from the story level
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, sel.has(sl.id) ? selMat : mat('s' + sl.section, sectionColor(sl.section), 0.45));
    mesh.position.y = e.top * S - t;
    mesh.userData.id = sl.id;
    g.add(mesh);
  }
  return g;
}

export default function View3D() {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group | null; clip: THREE.Plane[]; render: () => void } | null>(null);
  const model = useApp(visibleModel);
  const selection = useApp((s) => s.selection);
  const activeStory = useApp((s) => s.activeStory);
  const [onlyStory, setOnlyStory] = useState(false);
  const fitted = useRef(false);
  // section cut (mm); null = whole building
  const [cut, setCut] = useState<{ lo: number; hi: number } | null>(null);
  const levels = useMemo(() => {
    const el = storyElevations(model);
    return [{ name: 'Base', elev: model.baseElevation }, ...model.stories.map((s) => ({ name: s.name, elev: el[s.name].top }))];
  }, [model.stories, model.baseElevation]);
  const minE = levels[0].elev,
    maxE = levels[levels.length - 1].elev;
  const lo = cut ? Math.max(minE, Math.min(cut.lo, maxE)) : minE;
  const hi = cut ? Math.min(maxE, Math.max(cut.hi, lo)) : maxE;

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x15181d);
    renderer.localClippingEnabled = true;
    // keep y >= lo and y <= hi
    const clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), OPEN), new THREE.Plane(new THREE.Vector3(0, -1, 0), OPEN)];
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
    let downAt = { x: 0, y: 0 };
    const pd = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4 || !ctx.current?.group) return;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const [pl, ph] = ctx.current.clip;
      const hit = ray.intersectObjects(ctx.current.group.children).find((h) => pl.distanceToPoint(h.point) >= -1e-6 && ph.distanceToPoint(h.point) >= -1e-6);
      const st = useApp.getState();
      const id = hit?.object.userData.id as string | undefined;
      if (!id) return st.setSelection([]);
      const story = [...st.model.columns, ...st.model.beams, ...st.model.slabs].find((x) => x.id === id)?.story;
      if (story && story !== st.activeStory) st.setActiveStory(story);
      st.setSelection(e.shiftKey ? [...st.selection, id] : [id]);
    };
    renderer.domElement.addEventListener('pointerdown', pd);
    renderer.domElement.addEventListener('pointerup', pu);
    ctx.current = { renderer, scene, camera, controls, group: null, clip, render };
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
      c.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    c.group = build(model, new Set(selection), onlyStory ? activeStory : null, c.clip);
    c.scene.add(c.group);
    if (!fitted.current && c.group.children.length) {
      fitView();
      fitted.current = true;
    }
    c.render();
  }, [model, selection, onlyStory, activeStory]);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    // tiny slack so members sitting exactly on a story level aren't shaved off
    const eps = 0.5;
    c.clip[0].constant = lo > minE ? -(lo - eps) * S : OPEN;
    c.clip[1].constant = hi < maxE ? (hi + eps) * S : OPEN;
    c.render();
  }, [lo, hi, minE, maxE]);

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
    c.render();
  };

  return (
    <div className="view3d" ref={host}>
      <div className="bar">
        <button onClick={fitView}>Fit</button>
        <button className={onlyStory ? 'on' : ''} onClick={() => setOnlyStory(!onlyStory)}>
          Active story only
        </button>
      </div>
      <SectionSlider levels={levels} lo={lo} hi={hi} onChange={(l, h) => setCut(l <= minE && h >= maxE ? null : { lo: l, hi: h })} />
    </div>
  );
}
