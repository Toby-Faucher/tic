import { RINGS, previewRing, startAlarm, stopAlarm, resumeAlarm, type RingId } from './sounds.ts';
import { getPrimary, PRIMARY_EVENT, DEFAULT_PRIMARY, pushEscapeCloser, popEscapeCloser, trapTabFor } from './settings.ts';
import { escapeHtml, sanitizeTimer, parseTags, parseTicket, clampTotal, isHex, MAX_TIMER_NAME } from './validate.ts';
import { KEYS, readJSON, writeJSON } from './keys.ts';

export { escapeHtml };

export type Accent = string;
export type RingStyle = 'thin' | 'classic' | 'bold';
export type Status = 'idle' | 'running' | 'paused' | 'done';
export type NocPriority = 'routine' | 'urgent';

export interface TicTimer {
  id: string;
  name: string;
  totalSeconds: number;
  remainingMs: number;
  endsAt: number | null;
  status: Status;
  accent: Accent;
  ringStyle: RingStyle;
  ring: RingId;
  tags: string[];
  nextId: string | null;
  createdAt: number;
  ticket: string;
  priority: NocPriority;
  linkId: string | null;
}

export const ACCENTS: Record<string, string> = {
  blue: '#1734d8',
  violet: '#6a3df0',
  green: '#0b6e34',
  orange: '#b54600',
  pink: '#c21445',
  graphite: '#555555',
};
// All six pass WCAG AA 4.5:1 with cream text (#faf4e8): blue 7.6, violet 5.4,
// green 5.8, orange 5.0, pink 5.5, graphite 6.8. Keep it that way — .t-play
// renders cream on these fills at 16px. Custom wheel hexes are the user's
// responsibility (documented in README).

export function accentColor(a: unknown): string {
  // 'blue' is the app primary — it tracks the user's settings choice so
  // existing blue timers re-tint live. Everything else is a fixed accent.
  // Hardened: typeof guard + hex allowlist, never throws on poison input.
  try {
    if (typeof a !== 'string') return getPrimary();
    if (a === 'blue') return getPrimary();
    if (a.startsWith('#')) return isHex(a) ? a : getPrimary();
    const hit = (ACCENTS as Record<string, string>)[a];
    return typeof hit === 'string' ? hit : getPrimary();
  } catch {
    return DEFAULT_PRIMARY;
  }
}

const STROKE: Record<RingStyle, number> = { thin: 5, classic: 9, bold: 13 };

const LS_KEY = KEYS.timers;
export const uid = () => {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* fall through */ }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
};

let timers: TicTimer[] = [];
let filter: string | null = null;
let editingId: string | null = null;
let timerInvoker: HTMLElement | null = null;

// Done-alarm ownership: with the replace-newest policy only the most
// recently finished timer owns the looping sound. Dismiss rule: any
// toggle / reset / remove (or edit) on THAT timer silences its alarm;
// pagehide silences everything. Card-level dismiss only — no global mute
// button, so the existing "restart" (toggle) / reset / delete buttons on a
// done card are its silence affordance.
let ringingId: string | null = null;
function dismissAlarm(id: string) {
  if (ringingId !== null && ringingId === id) { ringingId = null; stopAlarm(); }
}
function silenceAllAlarms() { ringingId = null; stopAlarm(); }

let fAccent: Accent = 'blue';
let fRingStyle: RingStyle = 'classic';
let fRing: RingId = 'soft';
let fTicket = '';
let fPriority: NocPriority = 'routine';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

function load() {
  // Respect an explicit persisted [] — only seed on missing key or corrupt shape.
  const parsed = readJSON<unknown>(LS_KEY, null);
  if (parsed === null) return seed();
  if (!Array.isArray(parsed)) return seed();
  const now = Date.now();
  const clean: TicTimer[] = [];
  for (const row of parsed) {
    const s = sanitizeTimer(row);
    if (s) clean.push(s);
  }
  // Second pass: drop dangling nextId/linkId against the surviving id set.
  const ids = new Set(clean.map((t) => t.id));
  for (const t of clean) {
    if (t.nextId && (t.nextId === t.id || !ids.has(t.nextId))) t.nextId = null;
    if (t.linkId && (t.linkId === t.id || !ids.has(t.linkId))) {
      // linkId points at a box (different keyspace) — only drop self-shaped
      // garbage here; cross-store dangling is cleared lazily on render.
      if (t.linkId === t.id) t.linkId = null;
    }
    if (t.status === 'running' && t.endsAt) {
      const rem = t.endsAt - now;
      if (rem <= 0) { t.status = 'done'; t.remainingMs = 0; t.endsAt = null; }
      else t.remainingMs = rem;
    } else if (t.status === 'done') {
      t.remainingMs = 0; t.endsAt = null;
    } else if (t.status === 'running') {
      t.status = 'paused'; t.endsAt = null;
    }
  }
  timers = clean;
  armDueTimer();
}

function seed() {
  const now = Date.now();
  timers = [
    { id: uid(), name: 'Callback user', totalSeconds: 30 * 60, remainingMs: 30 * 60 * 1000, endsAt: null, status: 'idle', accent: 'orange', ringStyle: 'classic', ring: 'soft', tags: ['callback'], nextId: null, createdAt: now, ticket: '', priority: 'urgent', linkId: null },
    { id: uid(), name: 'Recheck ticket', totalSeconds: 60 * 60, remainingMs: 60 * 60 * 1000, endsAt: null, status: 'idle', accent: 'blue', ringStyle: 'thin', ring: 'soft', tags: ['check'], nextId: null, createdAt: now + 1, ticket: '', priority: 'routine', linkId: null },
  ];
  saveNow();
}

// Dirty-flag persistence: structural mutations call save() (immediate unless
// hidden, then deferred); tick flushes at most once per 5s and never while
// hidden or idle. Replaces the old now%5000 + 10s-interval polling.
let saveDirty = false;
let lastSaveAt = 0;
function saveNow() {
  try {
    if (writeJSON(LS_KEY, timers)) { lastSaveAt = Date.now(); saveDirty = false; }
    else saveDirty = true;
  } catch { saveDirty = true; }
}
function save() {
  if (typeof document !== 'undefined' && document.hidden) { saveDirty = true; return; }
  saveNow();
}
function flushSave(now: number) {
  if (!saveDirty) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  if (now - lastSaveAt < 5000) return;
  saveNow();
}

// Hidden-tab watchdog: rAF stops when hidden, so arm a wall-clock timeout for
// the soonest due timer. Fires even in background (throttled by the browser)
// and re-arms until no running timers remain.
let dueTimeout: ReturnType<typeof setTimeout> | null = null;
function armDueTimer() {
  try {
    if (dueTimeout !== null) { clearTimeout(dueTimeout); dueTimeout = null; }
    let soonest = Infinity;
    for (const t of timers) {
      if (t.status === 'running' && typeof t.endsAt === 'number' && Number.isFinite(t.endsAt)) {
        const rem = t.endsAt - Date.now();
        if (rem < soonest) soonest = rem;
      }
    }
    if (!Number.isFinite(soonest)) return;
    const delay = Math.max(0, Math.min(soonest, 2147483647));
    dueTimeout = setTimeout(onDue, delay);
  } catch { /* ignore */ }
}
function onDue() {
  dueTimeout = null;
  const now = Date.now();
  let fired = false;
  for (const t of timers) {
    if (t.status === 'running' && typeof t.endsAt === 'number' && t.endsAt - now <= 0) {
      finish(t);
      fired = true;
    }
  }
  if (!fired) {
    // Spurious wakeup (throttle drift) — re-arm and repaint.
    for (const t of timers) if (t.status === 'running') { t.remainingMs = Math.max(0, (t.endsAt ?? now) - now); paintCard(t); }
    updateCount();
  }
  armDueTimer();
  ensureTick();
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
function fmtTotal(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  if (sec >= 60) return sec % 60 === 0 ? `${sec / 60}m` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${sec}s`;
}

function allTags(): string[] {
  const set = new Set<string>();
  timers.forEach((t) => t.tags.forEach((x) => set.add(x)));
  return [...set].sort();
}

const els = new Map<string, { time: HTMLElement; prog: SVGCircleElement; btn: HTMLButtonElement; card: HTMLElement; shown: number }>();

function render() {
  renderFilters();
  renderGrid();
  updateCount();
}

function updateCount() {
  const running = timers.filter((t) => t.status === 'running').length;
  $('#count').textContent = running > 0
    ? `${running} running · ${timers.length} total`
    : `${timers.length} timer${timers.length === 1 ? '' : 's'}`;
}

function renderFilters() {
  const wrap = $('#filters');
  wrap.innerHTML = '';
  if (allTags().length === 0) return;
  const mk = (label: string, active: boolean, onClick: () => void) => {
    const b = document.createElement('button');
    b.className = 't-chip';
    b.dataset.active = String(active);
    b.textContent = label;
    b.onclick = onClick;
    wrap.appendChild(b);
  };
  mk('all', filter === null, () => { filter = null; render(); });
  allTags().forEach((t) => mk('#' + t, filter === t, () => { filter = filter === t ? null : t; render(); }));
}

function visible(): TicTimer[] {
  const list = filter ? timers.filter((t) => t.tags.includes(filter!)) : timers;
  return [...list].sort((a, b) => a.createdAt - b.createdAt);
}

const C = 2 * Math.PI * 54;

function renderGrid() {
  const grid = $('#grid');
  grid.innerHTML = '';
  els.clear();
  const list = visible();
  if (!list.length) {
    grid.innerHTML = `<div class="t-empty"><h2 class="t-emptyh">no timers here</h2><p class="t-emptyp">${filter ? `nothing tagged #${escapeHtml(filter)} yet.` : 'make one above to begin.'}</p></div>`;
    return;
  }
  list.forEach((t) => {
    const card = document.createElement('article');
    card.className = 'group t-card';
    card.dataset.status = t.status;
    // 'blue' is the app primary — bind the live token so settings changes
    // apply instantly with no JS repaint.
    card.style.setProperty('--accent', t.accent === 'blue' ? 'var(--color-ink)' : accentColor(t.accent));
    card.id = `card-${t.id}`;

    const tagsHtml = t.tags.length
      ? t.tags.map((x) => `<span class="t-tag">#${escapeHtml(x)}</span>`).join('')
      : '';

    const nextName = t.nextId ? timers.find((x) => x.id === t.nextId)?.name : undefined;
    const ticketHtml = t.ticket ? `<span class="t-ticket">${escapeHtml(t.ticket)}</span>` : '';
    const prioHtml = t.priority === 'urgent' ? `<span class="t-prio" data-prio="urgent">!</span>` : '';
    const strokeW = (STROKE as Record<string, number>)[t.ringStyle] ?? STROKE.classic;
    const ringEsc = escapeHtml(t.ring);
    const ringStyleEsc = escapeHtml(t.ringStyle);
    const ringNameEsc = escapeHtml(ringName(t.ring));
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="t-name">${prioHtml}${escapeHtml(t.name)}${ticketHtml}</h3>
          <div class="t-meta"><span class="t-dot"></span><span data-meta>${statusLabel(t)} · ${fmtTotal(t.totalSeconds)}</span>${t.linkId ? '<span class="t-linked">· linked task</span>' : ''}</div>
        </div>
        <div class="flex gap-1.5">
          <button class="t-iconbtn" data-act="edit" aria-label="Edit" title="Edit">edit</button>
          <button class="t-iconbtn" data-act="del" aria-label="Delete" title="Delete">×</button>
        </div>
      </div>
      <div class="my-4 flex items-center gap-[18px]">
        <div class="relative h-[110px] w-[110px] shrink-0">
          <svg viewBox="0 0 120 120" class="-rotate-90 h-full w-full overflow-visible">
            <circle cx="60" cy="60" r="54" fill="none" style="stroke:var(--color-ink)" stroke-opacity="0.25" stroke-width="${strokeW}" stroke-dasharray="3 6" />
            <circle class="progress" cx="60" cy="60" r="54" fill="none" style="stroke:${t.accent === 'blue' ? 'var(--color-ink)' : accentColor(t.accent)}" stroke-width="${strokeW}" stroke-dasharray="${C}" stroke-dashoffset="${C}" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center"><div class="t-time" data-time>${fmt(t.remainingMs)}</div><div class="t-sub" data-sub>${ringEsc}</div></div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="mb-2.5 flex flex-wrap gap-1.5">${tagsHtml}</div>
          <div class="text-[13.5px] italic text-ink/70">${ringStyleEsc} ring · ${ringNameEsc} sound${nextName ? ` · → ${escapeHtml(nextName)}` : ''}</div>
        </div>
      </div>
      <div class="flex gap-2.5">
        <button class="t-play" data-act="toggle"></button>
        <button class="t-reset" data-act="reset" aria-label="Reset" title="Reset">↺</button>
      </div>
    `;

    card.querySelector('[data-act="toggle"]')!.addEventListener('click', () => toggle(t.id));
    card.querySelector('[data-act="reset"]')!.addEventListener('click', () => reset(t.id));
    card.querySelector('[data-act="edit"]')!.addEventListener('click', () => openModal(t.id));
    card.querySelector('[data-act="del"]')!.addEventListener('click', () => remove(t.id));

    grid.appendChild(card);
    const frac = t.totalSeconds > 0 ? t.remainingMs / (t.totalSeconds * 1000) : 0;
    els.set(t.id, {
      time: card.querySelector('[data-time]')!,
      prog: card.querySelector('.progress')!,
      btn: card.querySelector('[data-act="toggle"]')!,
      card,
      shown: frac,
    });
    paintCard(t);
  });
}

function statusLabel(t: TicTimer): string {
  return t.status === 'running' ? 'running' : t.status === 'paused' ? 'paused' : t.status === 'done' ? 'done' : 'ready';
}
function ringName(id: RingId): string { return RINGS.find((r) => r.id === id)?.name ?? id; }

function paintCard(t: TicTimer) {
  const e = els.get(t.id);
  if (!e) return;
  const frac = t.totalSeconds > 0 ? t.remainingMs / (t.totalSeconds * 1000) : 0;
  e.shown = frac;
  e.prog.style.strokeDashoffset = String(C * frac);
  e.time.textContent = t.status === 'done' ? '00:00' : fmt(t.remainingMs);
  const btn = e.btn;
  if (t.status === 'running') { btn.textContent = 'pause'; btn.dataset.paused = 'false'; }
  else if (t.status === 'done') { btn.textContent = 'restart'; btn.dataset.paused = 'false'; }
  else if (t.status === 'paused') { btn.textContent = 'resume'; btn.dataset.paused = 'true'; }
  else { btn.textContent = 'start'; btn.dataset.paused = 'false'; }
  e.card.dataset.status = t.status;
  const meta = e.card.querySelector('[data-meta]');
  if (meta) meta.textContent = `${statusLabel(t)} · ${fmtTotal(t.totalSeconds)}`;
}

function toggle(id: string) {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  dismissAlarm(id); // touching a ringing card (incl. "restart") silences it
  if (t.status === 'running') {
    t.remainingMs = Math.max(0, (t.endsAt ?? Date.now()) - Date.now());
    t.endsAt = null; t.status = 'paused';
  } else if (t.status === 'done') {
    t.remainingMs = t.totalSeconds * 1000; t.endsAt = Date.now() + t.remainingMs; t.status = 'running';
  } else {
    if (t.remainingMs <= 0) t.remainingMs = t.totalSeconds * 1000;
    t.endsAt = Date.now() + t.remainingMs; t.status = 'running';
  }
  save(); paintCard(t); updateCount();
  ensureTick();
  armDueTimer();
}

function reset(id: string) {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  dismissAlarm(id); // resetting a ringing card silences it
  t.remainingMs = t.totalSeconds * 1000; t.endsAt = null;
  t.status = 'idle'; save(); paintCard(t); updateCount();
  armDueTimer();
}

function remove(id: string) {
  dismissAlarm(id); // deleting a ringing timer stops its sound
  timers = timers.filter((t) => t.id !== id);
  for (const t of timers) {
    if (t.nextId === id) t.nextId = null;
    if (t.linkId === id) t.linkId = null;
  }
  save(); render();
  armDueTimer();
}

function notifyDone(t: TicTimer) {
  if (!('Notification' in window)) return;
  const show = () => {
    try { new Notification(`tic · ${t.name}`, { body: 'time is up.' }); } catch { /* noop */ }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') {
    try { void Notification.requestPermission().then((p) => { if (p === 'granted') show(); }).catch(() => { /* denied */ }); } catch { /* noop */ }
  }
}

function finish(t: TicTimer) {
  t.status = 'done'; t.remainingMs = 0; t.endsAt = null;
  // Looping alarm until dismissed: routine = soft sparse loop, urgent =
  // triple-pattern loop. Replace-newest: a newer finish takes the speaker
  // from an older still-ringing card. If the tab is hidden the Notification
  // still fires and the interval keeps retrying, so sound starts on the
  // next user interaction (see resumeAlarm wiring in init()).
  startAlarm(t.ring, { urgent: t.priority === 'urgent' });
  ringingId = t.id;
  try { navigator.vibrate?.(200); } catch { /* noop */ }
  notifyDone(t);
  // Non-visual alarm announcement for the #alarmLive role=alert region
  // (index.astro bridge also backstops via card attribute flips).
  try {
    const msg = `Timer ${t.name} finished`;
    (window as unknown as { __ticAnnounceAlarm?: (m: string) => void }).__ticAnnounceAlarm?.(msg);
    document.dispatchEvent(new CustomEvent('tic:alarm', { detail: msg }));
  } catch { /* noop */ }
  // Chain guard: ignore self/missing, refuse 2-cycles (A→B→A never chains).
  if (t.nextId && t.nextId !== t.id) {
    const nx = timers.find((x) => x.id === t.nextId);
    if (nx && nx.id !== t.id && nx.nextId !== t.id && nx.status !== 'running') {
      if (nx.status === 'done' || nx.remainingMs <= 0) nx.remainingMs = nx.totalSeconds * 1000;
      nx.endsAt = Date.now() + nx.remainingMs;
      nx.status = 'running';
      paintCard(nx);
      ensureTick();
    }
  }
  save(); paintCard(t); updateCount();
  armDueTimer();
}

export function toggleFirstTimer() {
  const vis = visible();
  const running = vis.find((t) => t.status === 'running');
  if (running) { toggle(running.id); return; }
  const next = vis.find((t) => t.status !== 'done');
  if (next) toggle(next.id);
}

export function resetTimerFilter() { filter = null; }

export function getTimersState(): TicTimer[] { return timers; }
export function setTimersState(list: TicTimer[]) {
  const clean: TicTimer[] = [];
  for (const row of Array.isArray(list) ? list : []) {
    const s = sanitizeTimer(row);
    if (s) clean.push(s);
  }
  const ids = new Set(clean.map((t) => t.id));
  for (const t of clean) {
    if (t.nextId && (t.nextId === t.id || !ids.has(t.nextId))) t.nextId = null;
    if (t.linkId && t.linkId === t.id) t.linkId = null;
  }
  timers = clean;
  silenceAllAlarms(); // explicit state replace (import) dismisses any alarm
  saveNow(); render();
  armDueTimer();
}

// The loop only runs while at least one timer is running, and pauses when
// the tab is hidden. Accuracy is unaffected — everything derives from
// Date.now() timestamps, so frames are purely presentational. Throttled to
// ~4Hz via setTimeout: cheap, and the watchdog covers hidden-tab dues.
let ticking = false;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
function ensureTick() {
  if (ticking) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  ticking = true;
  tickTimer = setTimeout(tick, 250);
}

function tick() {
  tickTimer = null;
  const now = Date.now();
  if (typeof document !== 'undefined' && document.hidden) { ticking = false; return; }
  for (const t of timers) {
    if (t.status !== 'running' || t.endsAt === null) continue;
    const rem = t.endsAt - now;
    if (rem <= 0) { finish(t); continue; }
    t.remainingMs = rem;
    const e = els.get(t.id);
    if (e) {
      const target = t.totalSeconds > 0 ? rem / (t.totalSeconds * 1000) : 0;
      e.shown = target;
      e.prog.style.strokeDashoffset = String(C * e.shown);
      const txt = fmt(rem);
      if (e.time.textContent !== txt) e.time.textContent = txt;
    }
  }
  flushSave(now);
  updateTabChrome(now);
  if (!timers.some((t) => t.status === 'running' && t.endsAt !== null)) {
    ticking = false;
    return;
  }
  tickTimer = setTimeout(tick, 250);
}

// Tab chrome: live countdown in the title + a progress-ring favicon,
// repainted at most 0.2Hz (5s) with data-URLs cached per 5% step.
// Costs nothing when idle.
const favLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
const favOrig = favLink.href;
const favCanvas = document.createElement('canvas');
favCanvas.width = favCanvas.height = 64;
const BASE_TITLE = 'tic — NOC follow-up timers';
let lastChromeSec = -1;
let chromeOn = false;
let lastFavPaint = 0;
let lastFavStep = -1;
const favCache = new Map<string, string>();

function updateTabChrome(now: number) {
  const r = timers.find((t) => t.status === 'running' && t.endsAt !== null);
  if (!r || r.endsAt === null) {
    if (chromeOn) {
      document.title = BASE_TITLE;
      favLink.href = favOrig;
      chromeOn = false;
      lastChromeSec = -1;
      lastFavStep = -1;
    }
    return;
  }
  const sec = Math.max(0, Math.ceil((r.endsAt - now) / 1000));
  const frac = r.totalSeconds > 0 ? Math.max(0, Math.min(1, (r.endsAt - now) / (r.totalSeconds * 1000))) : 0;
  const step = Math.round(frac * 20);
  const titleTxt = `${fmt(r.remainingMs)} · ${r.name}`;
  if (chromeOn && sec === lastChromeSec && step === lastFavStep) return;
  // Title at 1Hz, favicon at most 0.2Hz or on 5% step change.
  if (chromeOn && sec === lastChromeSec) return;
  lastChromeSec = sec;
  chromeOn = true;
  document.title = titleTxt;
  if (step === lastFavStep && now - lastFavPaint < 5000) return;
  lastFavStep = step;
  lastFavPaint = now;
  const primary = getPrimary();
  const cacheKey = `${step}:${primary}`;
  const cached = favCache.get(cacheKey);
  if (cached) { favLink.href = cached; return; }
  const ctx = favCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#faf4e8';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = primary;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(32, 32, 24, -Math.PI / 2, -Math.PI / 2 + (step / 20) * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = primary;
  ctx.font = 'italic 28px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('t', 32, 34);
  try {
    const url = favCanvas.toDataURL();
    if (favCache.size > 40) favCache.clear();
    favCache.set(cacheKey, url);
    favLink.href = url;
  } catch { /* ignore */ }
}

export function openModal(id: string | null) {
  editingId = id;
  if (id) dismissAlarm(id); // editing a ringing timer stops its sound
  const t = id ? timers.find((x) => x.id === id) : null;
  $('#sheetTitle').textContent = t ? 'Edit timer' : 'New timer';
  ($('#name') as HTMLInputElement).value = t?.name ?? '';
  const total = t?.totalSeconds ?? 5 * 60;
  ($('#h') as HTMLInputElement).value = String(Math.floor(total / 3600));
  ($('#m') as HTMLInputElement).value = String(Math.floor((total % 3600) / 60));
  ($('#s') as HTMLInputElement).value = String(total % 60);
  ($('#tags') as HTMLInputElement).value = t?.tags.join(', ') ?? '';
  const ticketEl = document.getElementById('ticket') as HTMLInputElement | null;
  if (ticketEl) ticketEl.value = t?.ticket ?? '';
  fAccent = t?.accent ?? 'blue';
  fRingStyle = t?.ringStyle ?? 'classic';
  fRing = t?.ring ?? 'soft';
  fTicket = t?.ticket ?? '';
  fPriority = t?.priority ?? 'routine';
  const nextSel = $('#next') as HTMLSelectElement;
  nextSel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'nothing — just ring';
  nextSel.appendChild(none);
  for (const x of timers.filter((x) => x.id !== id)) {
    const o = document.createElement('option');
    o.value = x.id;
    o.textContent = `→ ${x.name}`;
    if (x.id === t?.nextId) o.selected = true;
    nextSel.appendChild(o);
  }
  nextSel.value = t?.nextId ?? '';
  $('#saveBtn').textContent = t ? 'Save changes' : 'Add timer';
  paintForm();
  timerInvoker = document.activeElement as HTMLElement | null;
  $('#overlay').dataset.open = 'true';
  pushEscapeCloser(closeModal);
  ($('#name') as HTMLInputElement).focus();
}
function closeModal() {
  const ov = $('#overlay');
  if (ov.dataset.open !== 'true') return;
  ov.dataset.open = 'false';
  popEscapeCloser(closeModal);
  editingId = null;
  if (timerInvoker && document.contains(timerInvoker)) timerInvoker.focus();
  timerInvoker = null;
}

function paintForm() {
  $$('#swatches .swatch').forEach((b) => { const el = b as HTMLElement; el.dataset.sel = String(el.dataset.accent === fAccent); el.setAttribute('aria-pressed', String(el.dataset.accent === fAccent)); });
  const wheel = document.getElementById('accentWheel') as HTMLInputElement | null;
  if (wheel) {
    const custom = typeof fAccent === 'string' && fAccent.startsWith('#') && isHex(fAccent);
    wheel.value = custom ? (fAccent as string) : getPrimary();
    wheel.dataset.sel = String(custom);
  }
  $$('#ringstyle button').forEach((b) => { const el = b as HTMLElement; el.dataset.sel = String(el.dataset.style === fRingStyle); el.setAttribute('aria-pressed', String(el.dataset.style === fRingStyle)); });
  $$('#rings .ring-opt').forEach((b) => { const el = b as HTMLElement; el.dataset.sel = String(el.dataset.ring === fRing); el.setAttribute('aria-checked', String(el.dataset.ring === fRing)); });
  $$('#prioRow button').forEach((b) => { const el = b as HTMLElement; el.dataset.sel = String(el.dataset.prio === fPriority); el.setAttribute('aria-pressed', String(el.dataset.prio === fPriority)); });
}

function buildFormStatics() {
  const sw = $('#swatches'); sw.innerHTML = '';
  (Object.keys(ACCENTS)).forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch t-swatch'; b.dataset.accent = a;
    b.title = a; b.setAttribute('aria-label', a);
    b.style.background = ACCENTS[a];
    b.onclick = () => { fAccent = a; paintForm(); };
    sw.appendChild(b);
  });
  const wheel = document.createElement('input');
  wheel.type = 'color'; wheel.id = 'accentWheel';
  wheel.title = 'Custom colour'; wheel.setAttribute('aria-label', 'Custom colour');
  wheel.value = getPrimary();
  wheel.addEventListener('input', () => { fAccent = wheel.value; paintForm(); });
  sw.appendChild(wheel);
  const rs = $('#ringstyle'); rs.innerHTML = '';
  (['thin', 'classic', 'bold'] as RingStyle[]).forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.style = s; b.textContent = s;
    b.className = 't-rsbtn';
    b.onclick = () => { fRingStyle = s; paintForm(); };
    rs.appendChild(b);
  });
  const rw = $('#rings'); rw.innerHTML = '';
  RINGS.forEach((r) => {
    const d = document.createElement('div');
    d.className = 'ring-opt t-ringopt'; d.dataset.ring = r.id;
    d.innerHTML = `<div><b class="t-roname">${r.name}</b><small class="t-rodesc">${r.desc}</small></div><button class="t-prevbtn preview" aria-label="Preview ${r.name}">♪</button>`;
    d.onclick = (e) => {
      if ((e.target as HTMLElement).closest('.preview')) { previewRing(r.id); return; }
      fRing = r.id; previewRing(r.id); paintForm();
    };
    rw.appendChild(d);
  });
}

function buildPrioStatics() {
  const row = document.getElementById('prioRow');
  if (!row) return;
  row.innerHTML = '';
  ([
    { id: 'routine', label: 'routine', hint: 'quiet single nudge' },
    { id: 'urgent', label: 'urgent (!)', hint: 'triple ring + badge' },
  ] as { id: NocPriority; label: string; hint: string }[]).forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.prio = p.id; b.title = p.hint;
    b.className = 't-rsbtn';
    b.textContent = p.label;
    b.onclick = () => { fPriority = p.id; paintForm(); };
    row.appendChild(b);
  });
  const ticketEl = document.getElementById('ticket') as HTMLInputElement | null;
  ticketEl?.addEventListener('input', () => { fTicket = ticketEl.value; });
}

function saveForm() {
  const rawName = (($('#name') as HTMLInputElement).value || '').trim() || 'Untitled';
  const name = rawName.slice(0, MAX_TIMER_NAME);
  const h = Math.max(0, parseInt(($('#h') as HTMLInputElement).value || '0', 10) || 0);
  const m = Math.max(0, parseInt(($('#m') as HTMLInputElement).value || '0', 10) || 0);
  const s = Math.max(0, parseInt(($('#s') as HTMLInputElement).value || '0', 10) || 0);
  const total = clampTotal(h * 3600 + m * 60 + s);
  const tags = parseTags(($('#tags') as HTMLInputElement).value || '');
  const ticketEl = document.getElementById('ticket') as HTMLInputElement | null;
  const ticket = parseTicket(ticketEl?.value ?? fTicket);
  const picked = (($('#next') as HTMLSelectElement).value || '') || null;
  let nextId = picked && timers.some((x) => x.id === picked) ? picked : null;
  // Cycle guard: ignore self, refuse 2-cycles (A→B→A).
  if (nextId && nextId === editingId) nextId = null;
  if (nextId && editingId) {
    const target = timers.find((x) => x.id === nextId);
    if (target && target.nextId === editingId) nextId = null;
  }

  if (editingId) dismissAlarm(editingId); // saving an edit on a ringing timer keeps it silent

  if (editingId) {
    const t = timers.find((x) => x.id === editingId);
    if (t) {
      const wasTotal = t.totalSeconds;
      const wasRunning = t.status === 'running';
      t.name = name; t.totalSeconds = total; t.accent = fAccent; t.ringStyle = fRingStyle; t.ring = fRing; t.tags = tags; t.nextId = nextId;
      t.ticket = ticket; t.priority = fPriority;
      if (wasRunning) {
        // Rescale a running timer: keep it running with the new duration.
        const ratio = wasTotal > 0 ? total / wasTotal : 1;
        t.remainingMs = Math.max(1000, Math.round(t.remainingMs * ratio));
        if (t.remainingMs > total * 1000) t.remainingMs = total * 1000;
        t.endsAt = Date.now() + t.remainingMs;
      } else if (t.status === 'idle' || t.status === 'done' || wasTotal !== total) {
        if (t.status !== 'done') { t.remainingMs = total * 1000; t.endsAt = null; t.status = 'idle'; }
      }
    }
  } else {
    timers.push({ id: uid(), name, totalSeconds: total, remainingMs: total * 1000, endsAt: null, status: 'idle', accent: fAccent, ringStyle: fRingStyle, ring: fRing, tags, nextId, createdAt: Date.now(), ticket, priority: fPriority, linkId: null });
  }
  save(); closeModal(); render();
  armDueTimer();
}

export function createTimer(opts: { name: string; minutes: number; tags: string[]; ticket?: string; priority?: NocPriority; linkId?: string | null; start?: boolean }, deferRender = false): TicTimer {
  const total = clampTotal(Math.max(1, Math.round(opts.minutes * 60)));
  const t: TicTimer = {
    id: uid(),
    name: (opts.name || 'Untitled').slice(0, MAX_TIMER_NAME),
    totalSeconds: total,
    remainingMs: total * 1000,
    endsAt: opts.start ? Date.now() + total * 1000 : null,
    status: opts.start ? 'running' : 'idle',
    accent: opts.priority === 'urgent' ? 'orange' : 'blue',
    ringStyle: 'classic',
    ring: 'soft',
    tags: parseTags(opts.tags),
    nextId: null,
    createdAt: Date.now(),
    ticket: parseTicket(opts.ticket ?? ''),
    priority: opts.priority ?? 'routine',
    linkId: typeof opts.linkId === 'string' ? opts.linkId : null,
  };
  timers.push(t);
  if (deferRender) return t;
  save(); render(); ensureTick();
  armDueTimer();
  return t;
}

export function linkTimerToBox(timerId: string, boxId: string, deferRender = false) {
  const t = timers.find((x) => x.id === timerId);
  if (t) {
    t.linkId = boxId;
    if (deferRender) return;
    save(); render();
  }
}

export function init() {
  load();
  buildFormStatics();
  buildPrioStatics();
  render();
  ensureTick();
  armDueTimer();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { ensureTick(); armDueTimer(); flushSave(Date.now()); } });
  window.addEventListener('pagehide', () => { if (saveDirty) saveNow(); silenceAllAlarms(); });
  // If the AudioContext started suspended (finish while hidden / pre-gesture),
  // the first user interaction unlocks it and replays the active alarm at once.
  const unlock = () => resumeAlarm();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  ($('#fab') as HTMLButtonElement).onclick = () => openModal(null);
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#saveBtn').addEventListener('click', saveForm);
  $('#overlay').addEventListener('click', (e) => { if (e.target === $('#overlay')) closeModal(); });
  $('#overlay').addEventListener('keydown', trapTabFor('overlay'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Managed LIFO stack (settings.ts, capture phase) owns Escape when any
      // pushed modal is open — don't close out of order underneath it.
      const stack = (window as unknown as { __ticEscapeStack?: unknown[] }).__ticEscapeStack;
      if (stack && stack.length > 0) return;
      closeModal();
    }
    if (e.key === 'Enter' && $('#overlay').dataset.open === 'true') {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && (el as HTMLInputElement).type === 'color') return;
      e.preventDefault();
      saveForm();
    }
  });

  $$('#presets button').forEach((b) => b.addEventListener('click', () => {
    const sec = parseInt((b as HTMLElement).dataset.sec || '300', 10);
    ($('#h') as HTMLInputElement).value = String(Math.floor(sec / 3600));
    ($('#m') as HTMLInputElement).value = String(Math.floor((sec % 3600) / 60));
    ($('#s') as HTMLInputElement).value = String(sec % 60);
  }));

  // 'blue' accents bind var(--color-ink) live, so primary changes need no
  // re-render here — just keep the form's fallback wheel in sync.
  document.addEventListener(PRIMARY_EVENT, () => {
    const wheel = document.getElementById('accentWheel') as HTMLInputElement | null;
    if (wheel && (typeof fAccent !== 'string' || !fAccent.startsWith('#'))) wheel.value = getPrimary();
  });
}
