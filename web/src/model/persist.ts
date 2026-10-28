import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useApp } from './store';
import { emptyModel, type Model } from './types';
import { log } from '../log/sessionLog';
import { applySavedMeta, metaOf, useUnderlay } from '../underlay/store';

const KEY = 'emc-model';

export async function restoreModel() {
  const m = (await idbGet(KEY)) as Model | undefined;
  if (m && Array.isArray(m.stories)) useApp.getState().setModel({ ...emptyModel(), ...m });
}

let t = 0;
export function startAutosave() {
  useApp.subscribe((s, prev) => {
    if (s.dirty === prev.dirty) return;
    clearTimeout(t);
    t = window.setTimeout(() => idbSet(KEY, useApp.getState().model), 600);
  });
}

export function downloadProject() {
  const data = { app: 'etabs-model-creator', version: 1, model: useApp.getState().model, underlay: metaOf(useUnderlay.getState()) };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  log('file', 'Saved model.emc.json');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'model.emc.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function openProject(file: File) {
  const j = JSON.parse(await file.text());
  if (!j.model) throw new Error('Not an ETABS Model Creator project');
  useApp.getState().setModel({ ...emptyModel(), ...j.model });
  // keep the loaded underlay file, apply saved scale/placement only if it is the same file
  if (j.underlay) applySavedMeta(j.underlay);
}
