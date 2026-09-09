// tic settings — per-theme primary colours + box tick sound, vanilla.
// Each theme has its own primary: grey for light mode, bone white for dark.
// Keys 'tic.primary' (light; legacy key, so existing picks carry over) and
// 'tic.primary.dark'. Applies by overriding --color-ink (the Tailwind @theme
// token behind all text-ink / bg-ink / border-ink utilities) as an inline
// style on <html>, following the active theme via the 'tic:theme' event.
// Notifies listeners via 'tic:primary' so form defaults (colour wheels)
// can re-sync without a full re-render.
// Tick sound delegates to sounds.ts ('tic.tick') — this module only builds
// the picker rows (as radiogroup options, see buildTicks).
//
// Contrast gate (WCAG 2.2 AA): setPrimary() computes the WCAG ratio of the
// pick against its mode paper and BLOCKS < 3:1 (large-UI floor) / WARNS
// 3:1–4.5:1 (body-text target) via the #primaryNote role=alert region.
// Per-mode preset lists only offer passing pairs, so bone-on-cream style
// cross-mode destruction is never one click away.
// Colour-picker input is throttled (100ms trailing edge) so favicon repaints
// + 'tic:primary' dispatches don't fire per mousemove tick.
// Settings modal: toggles hidden+inert+aria-hidden with data-open, traps
// Tab, joins the shared LIFO Escape stack, stores its invoker and returns
// focus to it — focus moves synchronously, no setTimeout race.
import { TICKS, getTick, setTick, playTick, type TickId } from './sounds.ts';
import { THEME_EVENT } from './theme.ts';

export const PRIMARY_EVENT = 'tic:primary';

export type ThemeMode = 'light' | 'dark';

const LIGHT_KEY = 'tic.primary';
const DARK_KEY = 'tic.primary.dark';
/** @deprecated Use LIGHT_KEY — kept for backward compat. */
export const PRIMARY_KEY = LIGHT_KEY;

export const DEFAULT_LIGHT = '#444444';
export const DEFAULT_DARK = '#f2ede1';
/** @deprecated Use DEFAULT_LIGHT / DEFAULT_DARK. */
export const DEFAULT_PRIMARY = DEFAULT_LIGHT;

export interface PrimaryPreset {
  id: string;
  hex: string;
}

/** Mode paper colours — the contrast-gate backgrounds. */
export const LIGHT_BG = '#faf4e8';
export const DARK_BG = '#1e1e1e';
/** WCAG floors: block below large-UI 3:1, warn below body 4.5:1. */
export const MIN_LARGE_RATIO = 3;
export const MIN_BODY_RATIO = 4.5;

/** Per-mode presets — every entry passes 4.5:1 on its own paper, so the
 *  legacy cross-mode pair (bone-on-cream ≈ 1.1:1) is never offered. */
export const LIGHT_PRESETS: PrimaryPreset[] = [
  { id: 'grey', hex: '#444444' },
  { id: 'blue', hex: '#1734d8' },
];
export const DARK_PRESETS: PrimaryPreset[] = [
  { id: 'bone', hex: '#f2ede1' },
  { id: 'amber', hex: '#ff9d5c' },
];
/** @deprecated Use LIGHT_PRESETS / DARK_PRESETS (per-mode, contrast-safe). */
export const PRIMARY_PRESETS: PrimaryPreset[] = [...LIGHT_PRESETS, ...DARK_PRESETS];

export function presetsFor(mode: ThemeMode): PrimaryPreset[] {
  return mode === 'dark' ? DARK_PRESETS : LIGHT_PRESETS;
}

export function isValidHex(c: unknown): c is string {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function bgFor(mode: ThemeMode): string {
  return mode === 'dark' ? DARK_BG : LIGHT_BG;
}

/** Contrast of a primary pick against its mode paper. */
export function primaryRatio(hex: string, mode: ThemeMode): number {
  return contrastRatio(hex, bgFor(mode));
}

/** role=alert note under the settings preview (null-safe: markup owns it). */
function notePrimary(msg: string): void {
  const note = document.getElementById('primaryNote');
  if (note && note.textContent !== msg) note.textContent = msg;
}

export function currentMode(): ThemeMode {
  return document.documentElement?.dataset?.theme === 'dark' ? 'dark' : 'light';
}

function defaultFor(mode: ThemeMode): string {
  return mode === 'dark' ? DEFAULT_DARK : DEFAULT_LIGHT;
}

function keyFor(mode: ThemeMode): string {
  return mode === 'dark' ? DARK_KEY : LIGHT_KEY;
}

export function getPrimary(mode: ThemeMode = currentMode()): string {
  try {
    const v = localStorage.getItem(keyFor(mode));
    if (isValidHex(v)) return v.toLowerCase();
  } catch {
    /* private mode: fall through to default */
  }
  return defaultFor(mode);
}

export function applyPrimary(color: string): void {
  const hex = isValidHex(color) ? color.toLowerCase() : defaultFor(currentMode());
  document.documentElement.style.setProperty('--color-ink', hex);
  paintIdleFavicon(hex);
  try {
    document.dispatchEvent(new CustomEvent<string>(PRIMARY_EVENT, { detail: hex }));
  } catch {
    /* older browsers: variable still applied above */
  }
  syncRow(currentMode(), hex);
}

export function applyActivePrimary(): void {
  applyPrimary(getPrimary());
}

export function setPrimary(color: string, mode: ThemeMode = currentMode()): string {
  const hex = isValidHex(color) ? color.toLowerCase() : defaultFor(mode);
  const ratio = primaryRatio(hex, mode);
  if (ratio < MIN_LARGE_RATIO) {
    notePrimary(
      `Not applied — ${hex} is ${ratio.toFixed(2)}:1 on ${mode} paper (needs ${MIN_LARGE_RATIO}:1).`,
    );
    return getPrimary(mode);
  }
  if (ratio < MIN_BODY_RATIO) {
    notePrimary(
      `Heads up — ${hex} is ${ratio.toFixed(2)}:1 on ${mode} paper, below the ${MIN_BODY_RATIO}:1 body-text target (fine for large UI).`,
    );
  } else {
    notePrimary('');
  }
  try {
    localStorage.setItem(keyFor(mode), hex);
  } catch {
    /* private mode: still applies for the session */
  }
  if (mode === currentMode()) applyPrimary(hex);
  else syncRow(mode, hex);
  return hex;
}

export function resetPrimary(): string {
  cancelCustom('light');
  cancelCustom('dark');
  notePrimary('');
  try {
    localStorage.removeItem(LIGHT_KEY);
    localStorage.removeItem(DARK_KEY);
  } catch {
    /* ignore */
  }
  applyActivePrimary();
  syncRow('light', getPrimary('light'));
  syncRow('dark', getPrimary('dark'));
  return getPrimary();
}

// Idle favicon mirrors the inline <link rel=icon> SVG in index.astro with
// the active primary swapped in. Running timers repaint the favicon every
// second via updateTabChrome, which overwrites this — harmless.
function paintIdleFavicon(hex: string): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  const enc = encodeURIComponent(hex);
  link.href =
    `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
    `<rect width='100' height='100' fill='%23faf4e8' stroke='${enc}' stroke-width='6' stroke-dasharray='10 7'/>` +
    `<text x='50' y='70' font-size='56' text-anchor='middle' fill='${enc}' font-family='Georgia' font-style='italic'>t</text></svg>`;
}

// Colour-picker <input> fires per mousemove tick while dragging — throttle
// to a 100ms TRAILING edge so favicon repaints + PRIMARY_EVENT dispatches
// (and localStorage writes) collapse into one apply of the latest value.
const customTimer = new Map<ThemeMode, ReturnType<typeof setTimeout>>();
const customPending = new Map<ThemeMode, string>();

function cancelCustom(mode: ThemeMode): void {
  const t = customTimer.get(mode);
  if (t !== undefined) clearTimeout(t);
  customTimer.delete(mode);
  customPending.delete(mode);
}

function scheduleCustomPrimary(mode: ThemeMode, hex: string): void {
  customPending.set(mode, hex);
  if (customTimer.has(mode)) return;
  customTimer.set(
    mode,
    setTimeout(() => {
      customTimer.delete(mode);
      const latest = customPending.get(mode);
      customPending.delete(mode);
      if (latest !== undefined) setPrimary(latest, mode);
    }, 100),
  );
}

function flushCustom(mode: ThemeMode): void {
  const latest = customPending.get(mode);
  cancelCustom(mode);
  if (latest !== undefined) setPrimary(latest, mode);
}

function syncRow(mode: ThemeMode, hex: string): void {
  const swatches = document.getElementById(`primarySwatches-${mode}`);
  if (swatches) {
    [...swatches.querySelectorAll<HTMLElement>('[data-hex]')].forEach((b) => {
      const sel = (b.dataset.hex || '').toLowerCase() === hex;
      b.dataset.sel = String(sel);
      b.setAttribute('aria-pressed', String(sel));
    });
  }
  const custom = document.getElementById(`primaryCustom-${mode}`) as HTMLInputElement | null;
  if (custom && document.activeElement !== custom) custom.value = hex;
  const isPreset = presetsFor(mode).some((p) => p.hex.toLowerCase() === hex);
  if (custom) custom.dataset.sel = String(!isPreset);
  const value = document.getElementById(`primaryValue-${mode}`);
  if (value) value.textContent = hex;
}

// ---- settings modal (a11y): hidden+inert+aria-hidden with data-open,
// focus trap, shared LIFO Escape stack, invoker focus return. ----
let settingsInvoker: HTMLElement | null = null;

function settingsOverlay(): HTMLElement | null {
  return document.getElementById('settingsOverlay');
}

function focusables(root: ParentNode): HTMLElement[] {
  const els = [
    ...root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ];
  return els.filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
}

function setOverlayOpen(ov: HTMLElement, open: boolean): void {
  ov.dataset.open = String(open);
  ov.hidden = !open;
  if (open) {
    ov.removeAttribute('inert');
    try {
      (ov as unknown as { inert: boolean }).inert = false;
    } catch {
      /* older browsers: attribute removal above suffices */
    }
    ov.setAttribute('aria-hidden', 'false');
  } else {
    ov.setAttribute('inert', '');
    try {
      (ov as unknown as { inert: boolean }).inert = true;
    } catch {
      /* older browsers: attribute above suffices */
    }
    ov.setAttribute('aria-hidden', 'true');
  }
}

function openModal(): void {
  const ov = settingsOverlay();
  if (!ov || ov.dataset.open === 'true') return;
  settingsInvoker = document.activeElement as HTMLElement | null;
  syncRow('light', getPrimary('light'));
  syncRow('dark', getPrimary('dark'));
  setOverlayOpen(ov, true);
  pushEscapeCloser(closeModal);
  // Synchronous focus — no setTimeout race with the invoker.
  const first = focusables(ov)[0];
  if (first) first.focus();
}

function closeModal(): void {
  const ov = settingsOverlay();
  if (!ov || ov.dataset.open !== 'true') return;
  setOverlayOpen(ov, false);
  popEscapeCloser(closeModal);
  if (settingsInvoker && document.contains(settingsInvoker)) settingsInvoker.focus();
  settingsInvoker = null;
}

export function isSettingsOpen(): boolean {
  return document.getElementById('settingsOverlay')?.dataset.open === 'true';
}

// Shared LIFO Escape dispatcher (single document listener, capture phase so
// it preempts owner bubble-phase handlers). Other modals (app.ts / boxes.ts)
// should push/pop their closers here instead of adding their own Escape
// listeners — see the A11Y contract notes.
type EscapeCloser = () => void;

function escapeStack(): EscapeCloser[] {
  const w = window as unknown as { __ticEscapeStack?: EscapeCloser[] };
  if (!w.__ticEscapeStack) w.__ticEscapeStack = [];
  return w.__ticEscapeStack;
}

export function pushEscapeCloser(fn: EscapeCloser): void {
  const s = escapeStack();
  if (!s.includes(fn)) s.push(fn);
}

export function popEscapeCloser(fn: EscapeCloser): void {
  const s = escapeStack();
  const i = s.lastIndexOf(fn);
  if (i !== -1) s.splice(i, 1);
}

function ensureEscapeDispatcher(): void {
  const w = window as unknown as { __ticEscapeDispatcher?: boolean };
  if (w.__ticEscapeDispatcher) return;
  w.__ticEscapeDispatcher = true;
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      const top = escapeStack()[escapeStack().length - 1];
      if (!top) return; // no managed modal open — leave to owner handlers
      e.preventDefault();
      e.stopPropagation();
      top();
    },
    { capture: true },
  );
}

/** Tab / Shift+Tab loop over the sheet's focusables (overlay-scoped). */
function trapTab(e: KeyboardEvent): void {
  trapTabFor('settingsOverlay')(e);
}

/**
 * Generic overlay-scoped Tab trap factory for app.ts / boxes.ts sheets.
 * Attach once: `overlay.addEventListener('keydown', trapTabFor('overlay'))`.
 */
export function trapTabFor(overlayId: string): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const ov = document.getElementById(overlayId);
    if (!ov || ov.dataset.open !== 'true') return;
    const items = focusables(ov);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    e.preventDefault();
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !active || !ov.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
  };
}

function buildRow(mode: ThemeMode): void {
  const wrap = document.getElementById(`primarySwatches-${mode}`);
  if (!wrap) return;
  wrap.innerHTML = '';
  const current = getPrimary(mode);
  presetsFor(mode).forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 't-swatch';
    b.dataset.hex = p.hex;
    b.dataset.sel = String(p.hex.toLowerCase() === current);
    b.setAttribute('aria-pressed', String(p.hex.toLowerCase() === current));
    b.title = `${p.id} ${p.hex}`;
    b.setAttribute('aria-label', `${mode} primary colour ${p.id} ${p.hex}`);
    b.style.background = p.hex;
    b.onclick = () => {
      cancelCustom(mode);
      setPrimary(p.hex, mode);
    };
    wrap.appendChild(b);
  });
  const custom = document.getElementById(`primaryCustom-${mode}`) as HTMLInputElement | null;
  if (custom) {
    custom.value = current;
    custom.dataset.sel = String(!presetsFor(mode).some((p) => p.hex.toLowerCase() === current));
    custom.addEventListener('input', () => scheduleCustomPrimary(mode, custom.value));
    custom.addEventListener('change', () => flushCustom(mode));
  }
}

function buildForm(): void {
  buildRow('light');
  buildRow('dark');
  document.getElementById('primaryReset')?.addEventListener('click', () => resetPrimary());
  buildTicks();
}

function paintTicks(current: TickId): void {
  document.querySelectorAll<HTMLElement>('#tickSounds [data-tick]').forEach((el) => {
    const sel = el.dataset.tick === current;
    el.dataset.sel = String(sel);
    el.setAttribute('aria-checked', String(sel));
    el.tabIndex = sel ? 0 : -1;
  });
}

function selectTick(id: TickId): void {
  paintTicks(setTick(id));
  playTick(id);
}

function focusTick(dir: 1 | -1): HTMLElement | null {
  const items = [...document.querySelectorAll<HTMLElement>('#tickSounds [role="radio"]')];
  if (items.length === 0) return null;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const at = i < 0 ? (dir === 1 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
  const next = items[at];
  if (!next) return null;
  next.focus();
  return next;
}

// Tick options are a real radiogroup: each row is role=radio (roving
// tabindex, aria-checked from data-sel, arrows/Home/End + Enter/Space) and
// the ♪ preview stays a SEPARATE inner button with stopPropagation, so
// previewing never (de)selects.
function buildTicks(): void {
  const wrap = document.getElementById('tickSounds');
  if (!wrap) return;
  wrap.setAttribute('role', 'radiogroup');
  wrap.innerHTML = '';
  TICKS.forEach((tk) => {
    const d = document.createElement('div');
    d.className = 'tick-opt t-ringopt';
    d.dataset.tick = tk.id;
    d.setAttribute('role', 'radio');
    d.tabIndex = -1;
    d.setAttribute('aria-checked', 'false');
    const label = document.createElement('div');
    label.innerHTML = `<b class="t-roname">${tk.name}</b><small class="t-rodesc">${tk.desc}</small>`;
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 't-prevbtn preview';
    preview.setAttribute('aria-label', `Preview ${tk.name}`);
    preview.textContent = '♪';
    preview.addEventListener('click', (e) => {
      e.stopPropagation();
      playTick(tk.id);
    });
    d.append(label, preview);
    d.addEventListener('click', () => selectTick(tk.id));
    d.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.preview')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTick(tk.id);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = focusTick(1);
        const id = next?.dataset.tick as TickId | undefined;
        if (id) selectTick(id);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = focusTick(-1);
        const id = prev?.dataset.tick as TickId | undefined;
        if (id) selectTick(id);
      } else if (e.key === 'Home') {
        e.preventDefault();
        const items = [...document.querySelectorAll<HTMLElement>('#tickSounds [role="radio"]')];
        const id = items[0]?.dataset.tick as TickId | undefined;
        items[0]?.focus();
        if (id) selectTick(id);
      } else if (e.key === 'End') {
        e.preventDefault();
        const items = [...document.querySelectorAll<HTMLElement>('#tickSounds [role="radio"]')];
        const last = items[items.length - 1];
        const id = last?.dataset.tick as TickId | undefined;
        last?.focus();
        if (id) selectTick(id);
      }
    });
    wrap.appendChild(d);
  });
  paintTicks(getTick());
}

export function initSettings(): void {
  // Re-assert the colour set by the inline head snippet (anti-flash) so the
  // module path stays correct even if the snippet was skipped.
  applyActivePrimary();
  buildForm();
  ensureEscapeDispatcher();
  // Closed-state assertion (matches the static markup) for focus + AT.
  const ov = settingsOverlay();
  if (ov && ov.dataset.open !== 'true') setOverlayOpen(ov, false);
  ov?.addEventListener('keydown', trapTab);
  // Follow theme switches so each mode gets its own primary automatically.
  document.addEventListener(THEME_EVENT, () => applyActivePrimary());
  document.getElementById('settingsBtn')?.addEventListener('click', openModal);
  document.getElementById('settingsClose')?.addEventListener('click', closeModal);
  settingsOverlay()?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'settingsOverlay') closeModal();
  });
}
