/** Recently applied load values, newest first, kept per kind of field (e.g. 'frame:kN/m') in the browser. */

const MAX = 6;
const PREFIX = 'recent:';

/** The list with `v` moved to the front, duplicates dropped, at most MAX long. */
export function pushRecent<T>(list: T[], v: T): T[] {
  const k = JSON.stringify(v);
  return [v, ...list.filter((x) => JSON.stringify(x) !== k)].slice(0, MAX);
}

export function recentValues<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(PREFIX + key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Remember the values just applied; zeros are left out, the first of `vs` ends up newest. */
export function rememberValues<T>(key: string, vs: T[], isZero: (v: T) => boolean = (v) => v === 0) {
  const list = [...vs].reverse().reduce((l, v) => (isZero(v) ? l : pushRecent(l, v)), recentValues<T>(key));
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(list));
  } catch {
    // storage blocked: nothing to remember
  }
}
