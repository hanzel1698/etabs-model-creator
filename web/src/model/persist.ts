import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useApp } from './store';
import { emptyModel, type Model } from './types';
import { log } from '../log/sessionLog';
import { applySavedMeta, metaOf, useUnderlay } from '../underlay/store';

const KEY = 'emc-model';

export async function restoreModel() {
  const m = (await idbGet(KEY)) as Model | undefined;
  if (m && Array.isArray(m.stories)) useApp.getState().setModel({ ...emptyModel(), ...m });
  const s = (await idbGet(SAVE_KEY).catch(() => undefined)) as { target: FileSystemFileHandle | null; fileName: string; folder: FileSystemDirectoryHandle | null } | undefined;
  if (s) ({ target, fileName, folder } = s);
}

let t = 0;
export function startAutosave() {
  useApp.subscribe((s, prev) => {
    if (s.dirty === prev.dirty) return;
    clearTimeout(t);
    t = window.setTimeout(() => idbSet(KEY, useApp.getState().model), 600);
  });
}

// file chosen by Save As; Save writes back to it (Chrome/Edge only, others always download).
// Target, name and working folder live in IndexedDB so they survive a reload, like the model.
const SAVE_KEY = 'emc-save';
let target: FileSystemFileHandle | null = null;
let fileName = 'model.emc.json';
let folder: FileSystemDirectoryHandle | null = null;
const remember = () => idbSet(SAVE_KEY, { target, fileName, folder }).catch(() => {});
export const forgetSaveTarget = () => ((target = null), (fileName = 'model.emc.json'), remember());
export const workingFolderName = () => folder?.name;

type Picker = { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle>; showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle> };
const fsApi = window as unknown as Picker;

// a handle restored after reload needs the user's OK again; must run inside a click/keypress
async function canWrite(h: FileSystemHandle) {
  const p = h as unknown as { queryPermission(o: object): Promise<string>; requestPermission(o: object): Promise<string> };
  const o = { mode: 'readwrite' };
  return (await p.queryPermission(o)) === 'granted' || (await p.requestPermission(o)) === 'granted';
}

export async function setWorkingFolder() {
  if (!fsApi.showDirectoryPicker) return alert('This browser cannot pick folders. Use Chrome or Edge.');
  try {
    folder = await fsApi.showDirectoryPicker({ id: 'emc-folder', mode: 'readwrite', startIn: folder ?? 'documents' });
    remember();
    log('file', `Working folder: ${folder.name}`);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') alert(`Could not set folder: ${(e as Error).message}`);
  }
}

const projectBlob = () => {
  const s = useApp.getState();
  const data = { app: 'etabs-model-creator', version: 1, model: s.model, underlay: metaOf(useUnderlay.getState()), textScale: s.textScale };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
};

async function writeTarget(h: FileSystemFileHandle) {
  const w = await h.createWritable();
  await w.write(projectBlob());
  await w.close();
  log('file', `Saved ${h.name}`);
}

function download(name: string) {
  log('file', `Saved ${name}`);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(projectBlob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function downloadProject() {
  if (target) {
    try {
      if (await canWrite(target)) return await writeTarget(target);
    } catch (e) {
      return alert(`Save failed: ${(e as Error).message}`);
    }
  }
  download(fileName);
}

export async function saveProjectAs() {
  if (!fsApi.showSaveFilePicker) {
    const name = prompt('Save as', fileName)?.trim();
    if (!name) return;
    fileName = /\.json$/i.test(name) ? name : name + '.emc.json';
    remember();
    return download(fileName);
  }
  try {
    const h = await fsApi.showSaveFilePicker({
      suggestedName: fileName,
      startIn: folder ?? target ?? 'documents',
      types: [{ description: 'ETABS Model Creator project', accept: { 'application/json': ['.json'] } }],
    });
    await writeTarget(h);
    target = h;
    fileName = h.name;
    remember();
  } catch (e) {
    if ((e as Error).name !== 'AbortError') alert(`Save failed: ${(e as Error).message}`);
  }
}

export async function openProject(file: File) {
  target = null;
  fileName = file.name;
  remember();
  const j = JSON.parse(await file.text());
  if (!j.model) throw new Error('Not an ETABS Model Creator project');
  useApp.getState().setModel({ ...emptyModel(), ...j.model });
  // text size is per project; older files without one get the default
  useApp.getState().setTextScale(+j.textScale || 1);
  // keep the loaded underlay file, apply saved scale/placement only if it is the same file
  if (j.underlay) applySavedMeta(j.underlay);
}
