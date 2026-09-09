export type RingId = 'chime' | 'bell' | 'pulse' | 'soft' | 'radar';

export const RINGS: { id: RingId; name: string; desc: string }[] = [
  { id: 'chime', name: 'Chime', desc: 'Bright two-tone · default' },
  { id: 'bell', name: 'Bell', desc: 'Warm decaying bell' },
  { id: 'pulse', name: 'Pulse', desc: 'Triple digital beep' },
  { id: 'soft', name: 'Soft', desc: 'Gentle airy tone' },
  { id: 'radar', name: 'Radar', desc: 'Sweeping alert' },
];

let ctx: AudioContext | null = null;
function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  vol = 0.22,
  slideTo?: number,
  dest?: AudioNode,
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(dest ?? c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

export function previewRing(id: RingId) {
  try {
    const c = ac();
    const t = c.currentTime + 0.02;
    playPattern(c, id, t);
  } catch { /* no audio */ }
}

export function playRing(id: RingId, repeats = 3) {
  try {
    const c = ac();
    for (let i = 0; i < repeats; i++) {
      playPattern(c, id, c.currentTime + 0.05 + i * 1.1);
    }
  } catch { /* no audio */ }
}

function playPattern(c: AudioContext, id: RingId, t: number, volScale = 1, dest?: AudioNode) {
  const out = dest ?? c.destination;
  switch (id) {
    case 'chime':
      tone(c, 880, t, 0.5, 'sine', 0.25 * volScale, undefined, out);
      tone(c, 1318.5, t + 0.28, 0.7, 'sine', 0.22 * volScale, undefined, out);
      break;
    case 'bell':
      tone(c, 660, t, 1.0, 'triangle', 0.28 * volScale, undefined, out);
      tone(c, 990, t, 0.8, 'sine', 0.14 * volScale, undefined, out);
      tone(c, 1320, t + 0.05, 0.6, 'sine', 0.08 * volScale, undefined, out);
      break;
    case 'pulse':
      tone(c, 988, t, 0.16, 'square', 0.12 * volScale, undefined, out);
      tone(c, 988, t + 0.24, 0.16, 'square', 0.12 * volScale, undefined, out);
      tone(c, 988, t + 0.48, 0.32, 'square', 0.12 * volScale, undefined, out);
      break;
    case 'soft':
      tone(c, 523.25, t, 0.9, 'sine', 0.18 * volScale, undefined, out);
      tone(c, 783.99, t + 0.12, 0.9, 'sine', 0.1 * volScale, undefined, out);
      break;
    case 'radar':
      tone(c, 600, t, 0.7, 'sine', 0.22 * volScale, 1200, out);
      tone(c, 600, t + 0.75, 0.15, 'sine', 0.1 * volScale, 900, out);
      break;
  }
}

// Satisfying little "pop" for ticking off a box, Vikunja-style:
// a snappy sine drop with a bright click on top.
export function playPop() {
  try {
    const c = ac();
    const t = c.currentTime + 0.01;
    tone(c, 540, t, 0.11, 'sine', 0.32, 150);
    tone(c, 1150, t, 0.03, 'triangle', 0.12);
    tone(c, 780, t + 0.05, 0.09, 'sine', 0.14, 320);
  } catch { /* no audio */ }
}

// Looping done-alarm: keeps sounding until the user dismisses it.
//
// Policy — only ONE alarm at a time (replace-newest): starting a new alarm
// clears the previous interval and the newest finished timer takes over the
// speaker. The replaced card still shows "done", it just no longer owns
// the sound.
//   - urgent: loops the previous triple-pattern burst (3x, 1.1s apart) with
//     a short breather between bursts.
//   - routine: loops a single pattern, quieter (ROUTINE_VOL) with a longer
//     gap. NOC-quiet philosophy — no max-volume hacks.
//
// WebAudio needs a user-gesture-unlocked AudioContext: ac() calls resume()
// on every cycle, so if the context starts suspended (timer finished while
// the tab was hidden, or before any gesture) the interval keeps firing and
// the alarm becomes audible from the next user interaction onward.
// resumeAlarm() replays the current cycle immediately — call it from a
// pointerdown/keydown handler so the first gesture unlocks sound without
// waiting for the next interval tick.
//
// stopAlarm() fully silences: the interval is cleared (nothing new is ever
// scheduled) and the alarm bus is disconnected (in-flight tails cut off;
// any stray oscillators decay on their own within ~1s).
//
// Importing this module is side-effect free (the context is created lazily
// inside ac()), and start/stop/resume never throw — without a DOM
// (bun/node) they are safe no-ops that only flip the ringing flag.
export interface AlarmOptions { urgent?: boolean; }

const URGENT_GAP_MS = 4200; // triple burst (~3.3s incl. tails) + ~1s breather
const ROUTINE_GAP_MS = 5200; // single pattern (~1s) + long quiet gap
const ROUTINE_VOL = 0.55;

let alarmTimer: ReturnType<typeof setInterval> | null = null;
let alarmBus: GainNode | null = null;
let alarmRing: RingId | null = null;
let alarmUrgent = false;

function playAlarmCycle() {
  if (!alarmRing) return;
  try {
    const c = ac();
    if (!alarmBus) {
      alarmBus = c.createGain();
      alarmBus.connect(c.destination);
    }
    const scale = alarmUrgent ? 1 : ROUTINE_VOL;
    const t0 = c.currentTime + 0.05;
    const repeats = alarmUrgent ? 3 : 1;
    for (let i = 0; i < repeats; i++) {
      playPattern(c, alarmRing, t0 + i * 1.1, scale, alarmBus);
    }
  } catch { /* no audio (suspended ctx / non-DOM env) — next tick retries */ }
}

export function startAlarm(ring: RingId, opts?: AlarmOptions) {
  stopAlarm(); // replace-newest: only one alarm at a time
  alarmRing = ring;
  alarmUrgent = !!opts?.urgent;
  try {
    playAlarmCycle();
  } catch { /* ignore */ }
  try {
    alarmTimer = setInterval(playAlarmCycle, alarmUrgent ? URGENT_GAP_MS : ROUTINE_GAP_MS);
  } catch { alarmTimer = null; }
}

export function stopAlarm() {
  if (alarmTimer !== null) { clearInterval(alarmTimer); alarmTimer = null; }
  alarmRing = null;
  if (alarmBus) { try { alarmBus.disconnect(); } catch { /* ignore */ } alarmBus = null; }
}

export function resumeAlarm() {
  if (alarmTimer !== null && alarmRing) {
    try { playAlarmCycle(); } catch { /* ignore */ }
  }
}

export function isAlarmRinging(): boolean { return alarmTimer !== null; }
