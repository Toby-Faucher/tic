import type { ShaderInstance } from 'shaders/js';

// tic micro-interactions — quiet GPU accents for buttons + cards.
//
// Layers (progressive enhancement, NOC-readable first):
//   1. Pure CSS fallback (always on): glass sheen sweep on primary buttons,
//      cursor-tracked highlight on cards via --mx/--my, press ripple.
//      Buttons look complete with zero WebGPU.
//   2. GPU sheen (WebGPU only): a tiny standalone `Blob` canvas overlaid on
//      the primary "+ new timer/box" button and timer play buttons at low
//      CSS opacity. (Glass/Glow need child textures, so Blob is the quiet
//      stand-in — same ink/cream palette, slow drift.)
//
// The shaders.com lib (~2MB) loads async only when WebGPU exists — same
// lazy pattern as fluid.ts, so the main bundle stays instant.
// Respects prefers-reduced-motion (static, no animation) and pauses when
// the tab is hidden.

const INK = '#1734d8';
const CREAM = '#faf4e8';
const MAX_PLAY_SHEENS = 8;

let started = false;
let reduceMotion = false;
let gpuOk = false;
let sheens: ShaderInstance[] = [];
let moTimer = 0;

function prefersReduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function accentOf(el: HTMLElement, fallback: string): string {
  // Play buttons live inside cards that carry --accent.
  const card = el.closest('.t-card') as HTMLElement | null;
  const raw = (card?.style.getPropertyValue('--accent') || '').trim();
  return raw || fallback;
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

// --- Layer 2: GPU sheen overlays --------------------------------------------

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

async function startGpuLayer() {
  // No WebGPU → skip the ~2MB download entirely; CSS fallback carries the look.
  if (!('gpu' in navigator)) return;
  try {
    const mod = await import('shaders/js');
    if (!mod.isWebGPUSupported()) return;
    gpuOk = true;
    document.documentElement.classList.add('fx-gpu-on');

    const attachAll = async () => {
      if (!gpuOk || document.hidden) return;
      const fab = document.getElementById('fab');
      const plays = [...document.querySelectorAll<HTMLElement>('#grid .t-play')]
        .slice(0, MAX_PLAY_SHEENS);
      if (fab) {
        const inst = await attachSheen(mod, fab, INK, 3);
        if (inst) sheens.push(inst);
      }
      let seed = 11;
      for (const p of plays) {
        const inst = await attachSheen(mod, p, accentOf(p, INK), seed++);
        if (inst) sheens.push(inst);
      }
    };

    // Timer renders swap #grid wholesale — re-attach (debounced) after paints.
    const grid = document.getElementById('grid');
    if (grid) {
      const obs = new MutationObserver(() => {
        window.clearTimeout(moTimer);
        moTimer = window.setTimeout(() => {
          if (!gpuOk || reduceMotion || document.hidden) return;
          teardownSheens();
          void attachAll();
        }, 250);
      });
      obs.observe(grid, { childList: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        for (const s of sheens) {
          try { s.pause(); } catch { /* noop */ }
        }
      } else if (!reduceMotion) {
        for (const s of sheens) {
          try { s.resume(); } catch { /* noop */ }
        }
        // Re-attach in case renders happened while hidden.
        const gridNow = document.getElementById('grid');
        if (gridNow && ![...document.querySelectorAll('#grid .t-play')].every(
          (p) => p.querySelector(':scope > canvas.fx-gpu'),
        )) {
          teardownSheens();
          void attachAll();
        }
      }
    });

    window.addEventListener('resize', () => {
      document.querySelectorAll<HTMLElement>('#fab, #grid .t-play').forEach((host) => {
        const c = host.querySelector(':scope > canvas.fx-gpu') as HTMLCanvasElement | null;
        if (c) sizeCanvas(c, host);
      });
    });

    void attachAll();
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
  void startGpuLayer();
}
