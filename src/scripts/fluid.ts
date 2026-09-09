import type { ShaderInstance } from 'shaders/js';

// tic fluid background — shaders.com (WebGPU) with a raw-WebGL fallback.
// Quiet by design: cream paper base, slow ink-blue fog, hairline grain.
// Sits behind content at low opacity so timer text stays NOC-readable.
// The shaders.com lib (~2MB) loads async only when WebGPU exists —
// timers paint first, eye candy streams in after.

const CREAM = '#faf4e8';
const PERIWINKLE = '#b9c4ff';
const WARM = '#ff9d5c';

let gpu: ShaderInstance | null = null;
let fallback: { setAlert: (on: boolean) => void; destroy: () => void } | null = null;
let alertOn = false;
let moTimer = 0;

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function startGpu(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    const mod = await import('shaders/js');
    if (!mod.isWebGPUSupported()) return false;
    gpu = await mod.createShader(
      canvas,
      {
        components: [
          {
            type: 'Fog',
            id: 'fog',
            props: {
              colorA: CREAM,
              colorB: PERIWINKLE,
              seed: 7,
              speed: reducedMotion() ? 0 : 0.32,
              turbulence: 0.55,
              detail: 7,
              blending: 0.6,
              mouseInfluence: reducedMotion() ? 0 : 0.12,
              mouseRadius: 0.18,
              colorSpace: 'oklch',
            },
          },
          {
            type: 'FilmGrain',
            id: 'grain',
            props: { strength: 0.06, bias: 1, animated: !reducedMotion() },
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
uniform vec2 r;uniform float t;uniform float warm;
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
vec3 ink=C(vec3(.725,.769,1.));
vec3 warmc=C(vec3(1.,.72,.48));
vec3 cool=mix(cream,ink,smoothstep(.25,.85,v)*.55+w*.12);
vec3 col=mix(cool,mix(cream,warmc,smoothstep(.25,.85,v)*.5),warm*.55);
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
  let warmV = 0;
  let warmTarget = 0;
  let raf = 0;
  const t0 = performance.now();
  const resize = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  const frame = () => {
    raf = 0;
    resize();
    warmV += (warmTarget - warmV) * 0.06;
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform1f(uT, (performance.now() - t0) / 1000);
    gl.uniform1f(uW, warmV);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reducedMotion() && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  };
  resize();
  frame();
  if (reducedMotion()) cancelAnimationFrame(raf);
  window.addEventListener('resize', kick);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
    else if (raf) cancelAnimationFrame(raf);
  });
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
    },
  };
  if (alertOn) fallback.setAlert(true);
}

function applyAlert(on: boolean) {
  if (on === alertOn) return;
  alertOn = on;
  try {
    gpu?.update('fog', { colorB: on ? WARM : PERIWINKLE });
  } catch {
    /* keep calm, carry on */
  }
  fallback?.setAlert(on);
}

// Warm the background when something needs you: an overdue linked task
// or a running urgent timer. Observed via DOM so timers/boxes stay decoupled.
function watchUrgency() {
  const check = () => {
    const need = !!document.querySelector('[data-need="true"]');
    const urgentRunning = !!document.querySelector(
      '#grid [data-status="running"] .t-prio',
    );
    applyAlert(need || urgentRunning);
  };
  const obs = new MutationObserver(() => {
    window.clearTimeout(moTimer);
    moTimer = window.setTimeout(check, 150);
  });
  obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-status', 'data-need', 'data-prio'] });
  // #grid/#boxGrid innerHTML swaps remove nodes — childList on main covers it.
  const main = document.querySelector('main')?.parentElement ?? document.body;
  obs.observe(main, { childList: true, subtree: true });
  check();
}

export function initFluid() {
  const canvas = document.getElementById('fluid') as HTMLCanvasElement | null;
  if (!canvas) return;
  // No WebGPU → skip the 2MB download entirely, go straight to fallback.
  if (!('gpu' in navigator)) {
    startFallback(canvas);
  } else {
    startGpu(canvas).then((ok) => {
      if (!ok && !gpu) startFallback(canvas);
    });
  }
  watchUrgency();
}

export function setFluidAlert(on: boolean) {
  applyAlert(on);
}
