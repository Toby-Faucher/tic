import type { ShaderInstance } from 'shaders/js';
import { THEME_EVENT } from './theme.ts';

// tic fluid background — shaders.com (WebGPU) with a raw-WebGL fallback.
// Cream paper base with a present ink-blue fog drift + hairline grain.
// Sits behind content so timer text stays NOC-readable.
// The shaders.com lib (~2MB) loads async only when WebGPU exists —
// timers paint first, eye candy streams in after. Reduced-motion users skip
// the download entirely and get a static fallback frame instead.
//
// PERF (AGENT PERF): fallback is DPR≤1.0, ~30fps (every other rAF), backing
// size cached + re-measured only on debounced-200ms resize/RO (no per-frame
// clientWidth layout reads, no bare resize→kick listener). Urgency watcher
// observes #grid + #boxGrid only (one observer, one debounced check) instead
// of double-observing body+main.

const CREAM = '#faf4e8';
const PERIWINKLE = '#9db0ff';
const WARM = '#ff9d5c';
// Dark-mode fog — charcoal base matching the dark paper, dim indigo drift.
// Low-glare for night shifts; the canvas is additionally dimmed via CSS
// under [data-theme="dark"].
const DARK_A = '#1e1e1e';
const DARK_B = '#16207a';

let gpu: ShaderInstance | null = null;
let fallback: { setAlert: (on: boolean) => void; destroy: () => void } | null = null;
let alertOn = false;
let moTimer = 0;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isDarkTheme(): boolean {
  return document.documentElement?.dataset?.theme === 'dark';
}

function fogColors(): { colorA: string; colorB: string } {
  const dark = isDarkTheme();
  return { colorA: dark ? DARK_A : CREAM, colorB: alertOn ? WARM : dark ? DARK_B : PERIWINKLE };
}

async function startGpu(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const mod = await import('shaders/js');
    if (!mod.isWebGPUSupported()) return false;
    const initial = fogColors();
    gpu = await mod.createShader(
      canvas,
      {
        components: [
          {
            type: 'Fog',
            id: 'fog',
            props: {
              colorA: initial.colorA,
              colorB: initial.colorB,
              seed: 7,
              speed: reducedMotion() ? 0 : 0.32,
              turbulence: 0.72,
              detail: 7,
              blending: 0.78,
              mouseInfluence: reducedMotion() ? 0 : 0.18,
              mouseRadius: 0.22,
              colorSpace: 'oklch',
            },
          },
          {
            type: 'FilmGrain',
            id: 'grain',
            props: { strength: 0.08, bias: 1, animated: !reducedMotion() },
          },
        ],
      },
      {
        disableTelemetry: true,
        onError: () => {
          gpu = null;
          startFallback(canvas);
        },
      },
    );
    if (reducedMotion()) {
      // One calm static frame, then freeze — meaning survives, motion doesn't.
      setTimeout(() => gpu?.pause(), 800);
    }
    document.addEventListener('visibilitychange', () => {
      if (!gpu) return;
      if (document.hidden) gpu.pause();
      else if (!reducedMotion()) gpu.resume();
    });
    return true;
  } catch {
    gpu = null;
    return false;
  }
}

// Minimal domain-warped fbm fallback — same palette, no dependencies.
function startFallback(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
  if (!gl) return;
  const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const fs = `precision mediump float;
uniform vec2 r;uniform float t;uniform float warm;uniform float dark;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.03;a*=.5;}return v;}
vec3 C(vec3 c){return pow(c,vec3(.4545));}
void main(){
vec2 uv=gl_FragCoord.xy/r;vec2 q=uv;float tm=t*.05;
float w=fbm(q*2.2+vec2(tm,tm*.6));
float v=fbm(q*2.6+vec2(w*1.4-tm*.7,2.1+w));
vec3 cream=C(vec3(.980,.957,.910));
vec3 ink=C(vec3(.616,.690,1.));
vec3 warmc=C(vec3(1.,.72,.48));
vec3 cool=mix(cream,ink,smoothstep(.2,.9,v)*.75+w*.15);
vec3 col=mix(cool,mix(cream,warmc,smoothstep(.25,.85,v)*.5),warm*.55);
// night shift: charcoal with a deep-blue drift instead of paper
vec3 night=mix(vec3(0.013),C(vec3(.055,.09,.32)),smoothstep(.2,.9,v)*.8);
night=mix(night,C(vec3(1.,.62,.36)),warm*.5*smoothstep(.25,.85,v));
col=mix(col,night,dark);
gl_FragColor=vec4(col,1.);}`;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const pr = gl.createProgram()!;
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(pr, 'r');
  const uT = gl.getUniformLocation(pr, 't');
  const uW = gl.getUniformLocation(pr, 'warm');
  const uD = gl.getUniformLocation(pr, 'dark');
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  let warmV = 0;
  let warmTarget = 0;
  let darkV = isDark() ? 1 : 0;
  let darkTarget = darkV;
  let raf = 0;
  let resizeTimer = 0;
  const t0 = performance.now();
  // ~30fps: skip every other rAF on 60Hz panels (halves fragment cost of the
  // fullscreen 4-octave fbm). Time-gated so 120Hz panels drop to ~30 too.
  const FRAME_MS = 33;
  let lastDraw = 0;
  // Cached backing-store size. Re-measured only on debounced resize /
  // ResizeObserver — frame() never touches clientWidth (no per-frame layout).
  let cachedW = 0;
  let cachedH = 0;
  const measure = () => {
    // DPR capped at 1.0 (was 1.5): quarters fragment shading vs DPR 1.5 at
    // DPR≥1 displays with no visible loss on a blurred fog backdrop.
    const dpr = Math.min(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    cachedW = w;
    cachedH = h;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  const frame = (ts?: number) => {
    raf = 0;
    const now = typeof ts === 'number' ? ts : performance.now();
    if (lastDraw !== 0 && now - lastDraw < FRAME_MS) {
      if (!reducedMotion() && !document.hidden) raf = requestAnimationFrame(frame);
      return;
    }
    lastDraw = now;
    warmV += (warmTarget - warmV) * 0.06;
    darkV += (darkTarget - darkV) * 0.08;
    gl.uniform2f(uR, cachedW || canvas.width, cachedH || canvas.height);
    gl.uniform1f(uT, (performance.now() - t0) / 1000);
    gl.uniform1f(uW, warmV);
    gl.uniform1f(uD, darkV);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reducedMotion() && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  };
  measure();
  frame();
  if (reducedMotion() && raf) cancelAnimationFrame(raf);
  const debouncedResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (document.hidden) return;
      measure();
      kick();
    }, 200);
  };
  window.addEventListener('resize', debouncedResize);
  let ro: ResizeObserver | null = null;
  try {
    ro = new ResizeObserver(debouncedResize);
    ro.observe(canvas);
  } catch { ro = null; }
  const onTheme = () => {
    darkTarget = isDark() ? 1 : 0;
    kick();
    if (reducedMotion()) {
      setTimeout(kick, 50);
      setTimeout(() => raf && cancelAnimationFrame(raf), 1200);
    }
  };
  // Follow THEME_EVENT (dispatched by theme.ts) so the fallback palette
  // tracks dark mode via the dark uniform (no baked-palette washout).
  document.addEventListener(THEME_EVENT, onTheme);
  const onVis = () => {
    if (!document.hidden) kick();
    else if (raf) cancelAnimationFrame(raf);
  };
  document.addEventListener('visibilitychange', onVis);
  fallback = {
    setAlert: (on: boolean) => {
      warmTarget = on ? 1 : 0;
      kick();
      if (reducedMotion()) {
        // Settle one frame so the tint still communicates.
        setTimeout(kick, 50);
        setTimeout(() => raf && cancelAnimationFrame(raf), 1200);
      }
    },
    destroy: () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', debouncedResize);
      try { ro?.disconnect(); } catch { /* noop */ }
      document.removeEventListener(THEME_EVENT, onTheme);
      document.removeEventListener('visibilitychange', onVis);
    },
  };
  if (alertOn) fallback.setAlert(true);
}

function applyAlert(on: boolean) {
  if (on === alertOn) return;
  alertOn = on;
  try {
    gpu?.update('fog', { colorB: on ? WARM : isDarkTheme() ? DARK_B : PERIWINKLE });
  } catch {
    /* keep calm, carry on */
  }
  fallback?.setAlert(on);
}

// Warm the background when something needs you: an overdue linked task
// (data-need on box cards) or a running urgent timer. Scoped to the two
// grids so box-driven data-need reaches the tint without full-doc observes.
function watchUrgency() {
  const grid = document.getElementById('grid');
  const boxGrid = document.getElementById('boxGrid');
  const check = () => {
    const need = !!(
      (grid && grid.querySelector('[data-need="true"]')) ||
      (boxGrid && boxGrid.querySelector('[data-need="true"]')) ||
      (!grid && !boxGrid && document.querySelector('[data-need="true"]'))
    );
    const urgentRunning = !!(grid && grid.querySelector(
      '[data-status="running"] .t-prio',
    ));
    applyAlert(need || urgentRunning);
  };
  const obs = new MutationObserver(() => {
    window.clearTimeout(moTimer);
    moTimer = window.setTimeout(check, 150);
  });
  const opts: MutationObserverInit = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-status', 'data-need', 'data-prio'],
  };
  let observed = 0;
  if (grid) { obs.observe(grid, opts); observed++; }
  if (boxGrid) { obs.observe(boxGrid, opts); observed++; }
  if (!observed) {
    // Grids missing (unexpected) — fall back to a scoped body observe.
    obs.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-status', 'data-need', 'data-prio'],
    });
  }
  check();
}

export function initFluid() {
  const canvas = document.getElementById('fluid') as HTMLCanvasElement | null;
  if (!canvas) return;
  watchTheme();
  // Reduced-motion: early return BEFORE the shaders import — static fallback
  // frame instead of a 683KB-gzip download for a frozen fog.
  if (reducedMotion()) {
    startFallback(canvas);
  } else if (!('gpu' in navigator)) {
    // No WebGPU → skip the 2MB download entirely, go straight to fallback.
    startFallback(canvas);
  } else {
    startGpu(canvas).then((ok) => {
      if (!ok && !gpu) startFallback(canvas);
    });
  }
  watchUrgency();
}

// Follow THEME_EVENT (dispatched by theme.ts) so the WebGPU fog tracks dark
// mode. The raw-WebGL fallback tracks it too via its own THEME_EVENT
// listener + dark uniform above.
function watchTheme() {
  document.addEventListener(THEME_EVENT, () => {
    try {
      const c = fogColors();
      gpu?.update('fog', { colorA: c.colorA, colorB: c.colorB });
    } catch {
      /* keep calm, carry on */
    }
  });
}

export function setFluidAlert(on: boolean) {
  applyAlert(on);
}
