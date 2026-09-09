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
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(c.destination);
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

function playPattern(c: AudioContext, id: RingId, t: number) {
  switch (id) {
    case 'chime':
      tone(c, 880, t, 0.5, 'sine', 0.25);
      tone(c, 1318.5, t + 0.28, 0.7, 'sine', 0.22);
      break;
    case 'bell':
      tone(c, 660, t, 1.0, 'triangle', 0.28);
      tone(c, 990, t, 0.8, 'sine', 0.14);
      tone(c, 1320, t + 0.05, 0.6, 'sine', 0.08);
      break;
    case 'pulse':
      tone(c, 988, t, 0.16, 'square', 0.12);
      tone(c, 988, t + 0.24, 0.16, 'square', 0.12);
      tone(c, 988, t + 0.48, 0.32, 'square', 0.12);
      break;
    case 'soft':
      tone(c, 523.25, t, 0.9, 'sine', 0.18);
      tone(c, 783.99, t + 0.12, 0.9, 'sine', 0.1);
      break;
    case 'radar':
      tone(c, 600, t, 0.7, 'sine', 0.22, 1200);
      tone(c, 600, t + 0.75, 0.15, 'sine', 0.1, 900);
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
