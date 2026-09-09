import type { ShaderInstance } from 'shaders/js';
import { getPrimary, PRIMARY_EVENT } from './settings.ts';

// tic micro-interactions — quiet GPU accents for buttons + cards.
//
// Layers (progressive enhancement, NOC-readable first):
//   1. Pure CSS fallback (always on): glass sheen sweep on primary buttons,
//      cursor-tracked highlight on cards via --mx/--my, press ripple.
//      Buttons look complete with zero WebGPU.
//   2. GPU sheen (WebGPU only): a tiny standalone `Blob` canvas overlaid on
//      the primary "+ new timer/box" button (#fab) at low CSS opacity.
//      (Glass/Glow need child textures, so Blob is the quiet stand-in —
//      same ink/cream palette, slow drift.)
//
// PERF (AGENT PERF): fab-only = 1 WebGPU context. The old MAX_PLAY_SHEENS=8
// path (up to 9 concurrent contexts) plus the 250ms #grid MutationObserver
// teardown/recreate storm are deleted — #fab is static so no render observer
// is needed at all. Resize is debounced ≥200ms with a hidden-tab skip.
// Reduced-motion returns BEFORE the dynamic import, so those users never
// download the shaders chunk (~683KB gzip).
//
// The shaders.com lib (~2MB) loads async only when WebGPU exists — same
// lazy pattern as fluid.ts, so the main bundle stays instant.
// Respects prefers-reduced-motion (static, no animation) and pauses when
// the tab is hidden.

const CREAM = '#faf4e8';

function primary(): string {
  try { return getPrimary(); } catch { return '#1734d8'; }
}

let started = false;
let reduceMotion = false;
let gpuOk = false;
let gpuLayerStarted = false;
let shaderMod: typeof import('shaders/js') | null = null;
let sheens: ShaderInstance[] = [];
let resizeTimer = 0;
let mq: MediaQueryList | null = null;

function prefersReduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// --- Layer 1: pointer-driven CSS hooks (no GPU needed) -----------------------

let rafQueued = false;

function onPointerMove(e: PointerEvent) {
  if (reduceMotion || document.hidden || rafQueued) return;
  const card = (e.target as HTMLElement).closest?.('.t-card') as HTMLElement | null;
  if (!card) return;
  rafQueued = true;
  const x = e.clientX;
  const y = e.clientY;
  requestAnimationFrame(() => {
    rafQueued = false;
    if (document.hidden) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${x - r.left}px`);
    card.style.setProperty('--my', `${y - r.top}px`);
  });
}

function onPointerDown(e: PointerEvent) {
  if (reduceMotion) return;
  const btn = (e.target as HTMLElement).closest?.(
    '#fab, .t-play, .t-primary, .t-nocbtn, .t-chip, .t-reset, .t-boxring',
  ) as HTMLElement | null;
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  const d = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span');
  s.className = 'fx-ripple';
  s.setAttribute('aria-hidden', 'true');
  s.style.width = s.style.height = `${d}px`;
  s.style.left = `${e.clientX - r.left - d / 2}px`;
  s.style.top = `${e.clientY - r.top - d / 2}px`;
  s.addEventListener('animationend', () => s.remove());
  // Safety net in case animation events never fire.
  window.setTimeout(() => s.remove(), 900);
  btn.appendChild(s);
}

function onFocusIn(e: FocusEvent) {
  // Keyboard parity for the card highlight: centre the --mx/--my glow on
  // the focused card using the existing CSS-var hook (no CSS change needed).
  // Native :focus-visible outline remains the primary focus indicator —
  // owned by CSS (see note for a11y agent in initFx).
  if (reduceMotion) return;
  const card = (e.target as HTMLElement).closest?.('.t-card') as HTMLElement | null;
  if (!card) return;
  const r = card.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  card.style.setProperty('--mx', `${r.width / 2}px`);
  card.style.setProperty('--my', `${r.height / 2}px`);
}

// --- Layer 2: GPU sheen overlay (fab only) ----------------------------------

function sizeCanvas(canvas: HTMLCanvasElement, host: HTMLElement) {
  const dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(host.clientWidth * dpr));
  const h = Math.max(1, Math.floor(host.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

async function attachSheen(
  mod: typeof import('shaders/js'),
  host: HTMLElement,
  colorA: string,
  seed: number,
): Promise<ShaderInstance | null> {
  if (host.querySelector(':scope > canvas.fx-gpu')) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-gpu';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  sizeCanvas(canvas, host);
  try {
    const inst = await mod.createShader(
      canvas,
      {
        components: [
          {
            type: 'Blob',
            id: 'sheen',
            props: {
              colorA,
              colorB: CREAM,
              size: 0.62,
              deformation: 0.32,
              softness: 0.78,
              highlightIntensity: 0.25,
              speed: reduceMotion ? 0 : 0.18,
              seed,
              colorSpace: 'oklch',
            },
          },
        ],
      },
      { disableTelemetry: true },
    );
    if (reduceMotion) {
      // One calm static frame, then freeze — same as the fluid background.
      window.setTimeout(() => {
        try { inst.pause(); } catch { /* noop */ }
      }, 800);
    }
    return inst;
  } catch {
    canvas.remove();
    return null;
  }
}

function teardownSheens() {
  for (const s of sheens) {
    try { s.destroy(); } catch { /* noop */ }
  }
  sheens = [];
  document.querySelectorAll('canvas.fx-gpu').forEach((c) => c.remove());
}

async function attachFab() {
  if (!shaderMod || !gpuOk || reduceMotion || document.hidden) return;
  const fab = document.getElementById('fab');
  if (!fab) return;
  const inst = await attachSheen(shaderMod, fab, primary(), 3);
  if (inst) sheens.push(inst);
}

async function startGpuLayer() {
  if (gpuLayerStarted) {
    // Re-entry (e.g. reduced-motion flipped off after boot) — just re-attach.
    void attachFab();
    return;
  }
  // No WebGPU → skip the ~2MB download entirely; CSS fallback carries the look.
  if (!('gpu' in navigator)) return;
  // Reduced-motion → return BEFORE the dynamic import so these users never
  // download the shaders chunk (~683KB gzip for a frozen frame).
  if (prefersReduced()) return;
  gpuLayerStarted = true;
  try {
    const mod = await import('shaders/js');
    if (!mod.isWebGPUSupported()) return;
    if (reduceMotion) return;
    shaderMod = mod;
    gpuOk = true;
    document.documentElement.classList.add('fx-gpu-on');

    // No #grid observer: #fab is static, so there is no render storm to
    // chase. Play-button sheens were deleted (9→1 contexts).

    // Sheen bakes its colour — re-attach on primary change so the
    // "+ new" button sheen tracks settings.
    document.addEventListener(PRIMARY_EVENT, () => {
      if (!gpuOk || reduceMotion || document.hidden) return;
      teardownSheens();
      void attachFab();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        for (const s of sheens) {
          try { s.pause(); } catch { /* noop */ }
        }
      } else if (!reduceMotion) {
        for (const s of sheens) {
          try { s.resume(); } catch { /* noop */ }
        }
        // Re-attach in case the fab canvas was lost while hidden.
        const fab = document.getElementById('fab');
        if (fab && !fab.querySelector(':scope > canvas.fx-gpu')) {
          teardownSheens();
          void attachFab();
        }
      }
    });

    window.addEventListener('resize', () => {
      if (document.hidden) return;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (!gpuOk || reduceMotion || document.hidden) return;
        const fab = document.getElementById('fab');
        const c = fab?.querySelector(':scope > canvas.fx-gpu') as HTMLCanvasElement | null;
        if (c && fab) sizeCanvas(c, fab);
      }, 200);
    });

    void attachFab();
  } catch {
    gpuOk = false;
  }
}

export function initFx() {
  if (started) return;
  started = true;
  reduceMotion = prefersReduced();
  document.documentElement.classList.add('fx');
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerdown', onPointerDown, { passive: true });
  document.addEventListener('focusin', onFocusIn);
  // Pause/resume (and free/re-boot the single context) when the OS-level
  // reduced-motion preference flips mid-session.
  try {
    mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', (e) => {
      reduceMotion = e.matches;
      if (e.matches) {
        // Freeze + free the context; CSS fallback carries the look.
        for (const s of sheens) {
          try { s.pause(); } catch { /* noop */ }
        }
        teardownSheens();
      } else if (gpuLayerStarted && shaderMod) {
        gpuOk = true;
        void attachFab();
      } else {
        gpuLayerStarted = false;
        void startGpuLayer();
      }
    });
  } catch { /* matchMedia listener is best-effort */ }
  void startGpuLayer();
}

// NOTE for a11y agent: keyboard focus parity for the GPU sheen itself is
// intentionally minimal — the sheen is aria-hidden decoration and the fab
// keeps its native :focus-visible outline from CSS. The JS-side focusin hook
// above only centres the existing --mx/--my card glow on keyboard focus. If
// a :focus-within glow stronger than the outline is desired, that belongs in
// global.css (this agent may only touch fx.ts / fluid.ts).
