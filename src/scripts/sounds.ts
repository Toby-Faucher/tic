export type RingId = 'chime' | 'bell' | 'pulse' | 'soft' | 'radar' | 'harp' | 'cuckoo' | 'marimba' | 'sparkle';

export const RINGS: { id: RingId; name: string; desc: string }[] = [
  { id: 'chime', name: 'Chime', desc: 'Bright two-tone' },
  { id: 'bell', name: 'Bell', desc: 'Warm decaying bell' },
  { id: 'pulse', name: 'Pulse', desc: 'Triple digital beep' },
  { id: 'soft', name: 'Soft', desc: 'Gentle airy tone · default' },
  { id: 'radar', name: 'Radar', desc: 'Sweeping alert' },
  { id: 'harp', name: 'Harp', desc: 'Rising gentle arpeggio' },
  { id: 'cuckoo', name: 'Cuckoo', desc: 'Low two-note call' },
  { id: 'marimba', name: 'Marimba', desc: 'Warm wooden motif' },
  { id: 'sparkle', name: 'Sparkle', desc: 'Bright falling shimmer' },
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
    case 'harp':
      tone(c, 523.25, t, 0.6, 'sine', 0.2 * volScale, undefined, out);
      tone(c, 659.25, t + 0.14, 0.6, 'sine', 0.2 * volScale, undefined, out);
      tone(c, 783.99, t + 0.28, 0.6, 'sine', 0.2 * volScale, undefined, out);
      tone(c, 1046.5, t + 0.42, 0.9, 'sine', 0.18 * volScale, undefined, out);
      break;
    case 'cuckoo':
      tone(c, 740, t, 0.28, 'sine', 0.22 * volScale, undefined, out);
      tone(c, 587.33, t + 0.34, 0.45, 'sine', 0.22 * volScale, undefined, out);
      break;
    case 'marimba':
      tone(c, 392, t, 0.35, 'triangle', 0.24 * volScale, undefined, out);
      tone(c, 523.25, t + 0.18, 0.35, 'triangle', 0.2 * volScale, undefined, out);
      tone(c, 659.25, t + 0.36, 0.5, 'sine', 0.16 * volScale, undefined, out);
      break;
    case 'sparkle':
      tone(c, 1568, t, 0.4, 'sine', 0.12 * volScale, undefined, out);
      tone(c, 1318.5, t + 0.1, 0.4, 'sine', 0.12 * volScale, undefined, out);
      tone(c, 1174.7, t + 0.2, 0.4, 'sine', 0.12 * volScale, undefined, out);
      tone(c, 1046.5, t + 0.3, 0.6, 'sine', 0.12 * volScale, undefined, out);
      break;
    default:
      // Unknown ring ids fail audible, never silent — fall back to soft.
      tone(c, 523.25, t, 0.9, 'sine', 0.18 * volScale, undefined, out);
      tone(c, 783.99, t + 0.12, 0.9, 'sine', 0.1 * volScale, undefined, out);
      break;
  }
}

// Box tick sounds — the little confirmation when a box is ticked off.
// Stored choice ('tic.tick'), default 'pop'. All short (<0.4s) and quiet.
export type TickId = 'pop' | 'pluck' | 'ding' | 'thock';

export const TICKS: { id: TickId; name: string; desc: string }[] = [
  { id: 'pop', name: 'Pop', desc: 'Snappy drop + click · default' },
  { id: 'pluck', name: 'Pluck', desc: 'Bright kalimba pluck' },
  { id: 'ding', name: 'Ding', desc: 'Tiny high bell' },
  { id: 'thock', name: 'Thock', desc: 'Soft wooden knock' },
];

const TICK_KEY = 'tic.tick';
export const DEFAULT_TICK: TickId = 'pop';

export function getTick(): TickId {
  try {
    const v = localStorage.getItem(TICK_KEY);
    if (TICKS.some((x) => x.id === v)) return v as TickId;
  } catch {
    /* private mode: fall through to default */
  }
  return DEFAULT_TICK;
}

export function setTick(id: TickId): TickId {
  const valid = TICKS.some((x) => x.id === id) ? id : DEFAULT_TICK;
  try {
    localStorage.setItem(TICK_KEY, valid);
  } catch {
    /* private mode: still applies for the session */
  }
  return valid;
}

function playTickPattern(c: AudioContext, id: TickId, t: number) {
  switch (id) {
    case 'pop':
      // Satisfying little "pop", Vikunja-style: snappy sine drop with a
      // bright click on top.
      tone(c, 540, t, 0.11, 'sine', 0.32, 150);
      tone(c, 1150, t, 0.03, 'triangle', 0.12);
      tone(c, 780, t + 0.05, 0.09, 'sine', 0.14, 320);
      break;
    case 'pluck':
      tone(c, 880, t, 0.09, 'triangle', 0.25, 440);
      tone(c, 1320, t, 0.05, 'sine', 0.1);
      break;
    case 'ding':
      tone(c, 1568, t, 0.35, 'sine', 0.16);
      tone(c, 2093, t, 0.25, 'sine', 0.08);
      break;
    case 'thock':
      tone(c, 220, t, 0.07, 'square', 0.18, 110);
      tone(c, 440, t, 0.04, 'triangle', 0.1);
      break;
  }
}

export function playTick(id: TickId = getTick()) {
  try {
    const c = ac();
    playTickPattern(c, TICKS.some((x) => x.id === id) ? id : DEFAULT_TICK, c.currentTime + 0.01);
  } catch { /* no audio */ }
}

// Looping done-alarm: keeps sounding until the user dismisses it.
//
// Policy — only ONE alarm at a time (replace-newest): starting a new alarm
// clears the previous interval and the newest finished timer takes over the
// speaker. The replaced card still shows "done", it just no longer owns
// the sound.
//   - urgent: loops a triple-pattern burst (URGENT_REPEATS, ALARM_STEP_MS
//     apart) with a short breather between bursts.
//   - routine: loops a single pattern (ROUTINE_REPEATS), quieter
//     (ROUTINE_VOL) with a longer gap. NOC-quiet philosophy — no
//     max-volume hacks.
//
// WebAudio needs a user-gesture-unlocked AudioContext: if the context is
// still suspended (timer finished while the tab was hidden, or before any
// gesture) playAlarmCycle resumes and returns without scheduling — no
// frozen-t0 burst stacking, the next interval tick retries. resumeAlarm()
// replays the current cycle immediately — call it from a
// pointerdown/keydown handler so the first gesture unlocks sound without
// waiting for the next interval tick.
//
// stopAlarm() fully silences: the interval is cleared (nothing new is ever
// scheduled) and the alarm bus is disconnected (in-flight tails cut off;
// any stray oscillators decay on their own within ~1s).
//
// Importing this module is side-effect free (the context is created lazily
// inside ac()), and start/stop/resume never throw — without a DOM
// (bun/node) they are safe no-ops.
export interface AlarmOptions { urgent?: boolean; }

const URGENT_GAP_MS = 4200; // triple burst (~3.3s incl. tails) + ~1s breather
const ROUTINE_GAP_MS = 5200; // single pattern (~1s) + long quiet gap
const ROUTINE_VOL = 0.55;
const ALARM_STEP_MS = 1100; // spacing between repeats inside one burst
const URGENT_REPEATS = 3;
const ROUTINE_REPEATS = 1;

let alarmTimer: ReturnType<typeof setInterval> | null = null;
let alarmBus: GainNode | null = null;
let alarmRing: RingId | null = null;
let alarmUrgent = false;

function playAlarmCycle() {
  if (!alarmRing) return;
  try {
    const c = ac();
    if (c.state === 'suspended') { void c.resume(); return; }
    if (!alarmBus) {
      alarmBus = c.createGain();
      alarmBus.connect(c.destination);
    }
    const scale = alarmUrgent ? 1 : ROUTINE_VOL;
    const t0 = c.currentTime + 0.05;
    const repeats = alarmUrgent ? URGENT_REPEATS : ROUTINE_REPEATS;
    for (let i = 0; i < repeats; i++) {
      playPattern(c, alarmRing, t0 + (i * ALARM_STEP_MS) / 1000, scale, alarmBus);
    }
  } catch { /* no audio (non-DOM env) — next tick retries */ }
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
