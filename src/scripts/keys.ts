export const KEYS = {
  theme: 'tic.theme',
  primaryLight: 'tic.primary',
  primaryDark: 'tic.primary.dark',
  timers: 'tic.timers.v1',
  boxes: 'tic.boxes.v1',
  tick: 'tic.tick',
  goal: 'tic.goal.v1',
} as const;

export function readJSON<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    try {
      const backup = `${key}.corrupt.${Date.now()}`;
      try { localStorage.setItem(backup, raw); } catch { /* quota: drop backup */ }
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    } catch { /* ignore */ }
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    const err = e as { name?: string; code?: number } | null;
    const name = err?.name;
    const code = err?.code;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014) {
      return false;
    }
    return false;
  }
}
