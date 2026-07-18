/**
 * Recently-viewed entities (local to this browser). Detail pages record
 * themselves on load; the command palette and context panel surface the list.
 */
export interface RecentEntity {
  label: string;
  path: string;
  at: number;
}

const STORAGE_KEY = "fm.recent";
const MAX = 8;

export function getRecent(): RecentEntity[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as RecentEntity[];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function recordRecent(label: string, path: string): void {
  try {
    const list = getRecent().filter((r) => r.path !== path);
    list.unshift({ label, path, at: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* private mode */
  }
}
