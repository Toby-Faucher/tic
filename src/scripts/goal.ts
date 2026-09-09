// tic shift goal — one freeform intention per shift, vanilla.
// Key 'tic.goal.v1': { date: 'YYYY-MM-DD', text: string }. Persists until
// cleared (night shifts cross midnight, so nothing auto-wipes); the label
// shows which day it was written. Autosaves debounced, textarea grows.

const LS_KEY = 'tic.goal.v1';
const AUTOSAVE_MS = 400;

// Quota-safe write: returns true on success, false when storage is
// unavailable/full (private mode, quota exceeded). Callers keep working
// session-only on false — surfaced as a boolean for a future toast hook.
function trySaveGoal(date: string, text: string): boolean {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ date, text }));
    return true;
  } catch {
    /* private mode / quota: keeps working for the session */
    return false;
  }
}

export function getGoalText(): string {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { text?: unknown };
    return typeof parsed.text === 'string' ? parsed.text : '';
  } catch {
    return '';
  }
}

function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(key: string): string {
  const [y, m, dd] = key.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, dd || 1);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function initGoal(): void {
  const input = document.getElementById('goalInput') as HTMLTextAreaElement | null;
  if (!input) return;
  const dateEl = document.getElementById('goalDate');
  const clearBtn = document.getElementById('goalClear') as HTMLButtonElement | null;

  let date = todayKey();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { date?: unknown; text?: unknown };
      if (typeof parsed.text === 'string') input.value = parsed.text;
      if (typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) date = parsed.date;
    }
  } catch {
    /* corrupted state: start fresh */
  }

  const paint = () => {
    if (dateEl) dateEl.textContent = input.value.trim() ? fmtDate(date) : fmtDate(todayKey());
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  paint();

  let timer = 0;
  input.addEventListener('input', () => {
    paint();
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      date = todayKey();
      const ok = trySaveGoal(date, input.value);
      void ok; // false → session-only; future toast hook reads this
      paint();
    }, AUTOSAVE_MS);
  });

  clearBtn?.addEventListener('click', () => {
    window.clearTimeout(timer); // cancel pending autosave: no residue write after removeItem
    input.value = '';
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    date = todayKey();
    paint();
    input.focus();
  });

  // Cancel any pending autosave on hide — prevents a residue write racing
  // removeItem / unload.
  window.addEventListener('pagehide', () => window.clearTimeout(timer));
}
