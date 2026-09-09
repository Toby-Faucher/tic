// tic theme — persisted dark/light mode, vanilla, framework-free.
// Key 'tic.theme': 'dark' | 'light'. Null → prefers-color-scheme.
// Sets data-theme on <html> and notifies listeners via 'tic:theme'.
//
// Event contract: dispatched as `new CustomEvent<TicTheme>(THEME_EVENT,
// { detail: theme })` — payload type is CustomEvent<TicTheme>, detail is the
// active 'dark' | 'light' string. Events table: theme.ts → settings.ts
// (applyActivePrimary), fluid.ts (fog + fallback palette), fx.ts via primary.
// Boot order (see index.astro module script): initTheme() runs FIRST, before
// initSettings()/initFluid()/initFx() attach their listeners — so the initial
// applyTheme() dispatch has no listeners yet. Each listener must re-assert
// current state on init (resolveTheme()/getPrimary()/fogColors()) and use
// the event only for subsequent switches.

export type TicTheme = 'dark' | 'light';

const KEY = 'tic.theme';
/** Theme-switch bus. Listen as `CustomEvent<TicTheme>` — `e.detail` is the active theme. */
export const THEME_EVENT = 'tic:theme';

export function getStoredTheme(): TicTheme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function resolveTheme(): TicTheme {
  const stored = getStoredTheme();
  if (stored) return stored;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: TicTheme): void {
  document.documentElement.dataset.theme = theme;
  try {
    document.dispatchEvent(new CustomEvent<TicTheme>(THEME_EVENT, { detail: theme }));
  } catch {
    /* older browsers: theme still applied via data-theme */
  }
  syncToggleLabel(theme);
}

export function toggleTheme(): TicTheme {
  const next: TicTheme = resolveTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: theme still applies for the session */
  }
  applyTheme(next);
  return next;
}

function syncToggleLabel(theme: TicTheme): void {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const dark = theme === 'dark';
  btn.setAttribute('aria-pressed', String(dark));
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.textContent = dark ? '☀ light' : '☾ dark';
}

export function initTheme(): TicTheme {
  // Re-assert theme set by the inline head snippet (anti-flash) so the
  // module path stays correct even if the snippet was skipped.
  const theme = resolveTheme();
  applyTheme(theme);
  document.getElementById('themeToggle')?.addEventListener('click', () => toggleTheme());
  // Follow the OS only until the user makes an explicit choice.
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (getStoredTheme()) return;
      applyTheme(e.matches ? 'dark' : 'light');
    });
  } catch {
    /* matchMedia listener unsupported: ignore */
  }
  return theme;
}
