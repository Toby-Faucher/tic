import { RINGS, previewRing, playRing, type RingId } from './sounds.ts';

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
  green: '#0d8a3f',
  orange: '#d95300',
  pink: '#e01e50',
  graphite: '#555555',
};

export function accentColor(a: string): string {
  return a.startsWith('#') ? a : (ACCENTS[a] ?? '#1734d8');
}

const STROKE: Record<RingStyle, number> = { thin: 5, classic: 9, bold: 13 };

const LS_KEY = 'tic.timers.v1';
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

let timers: TicTimer[] = [];
let filter: string | null = null;
let editingId: string | null = null;

let fAccent: Accent = 'blue';
let fRingStyle: RingStyle = 'classic';
let fRing: RingId = 'soft';
let fTicket = '';
let fPriority: NocPriority = 'routine';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as TicTimer[];
    const now = Date.now();
    timers = parsed.map((t) => {
      const base = {
        ...t,
        ticket: typeof (t as Partial<TicTimer>).ticket === 'string' ? (t as Partial<TicTimer>).ticket as string : '',
        priority: (t as Partial<TicTimer>).priority === 'urgent' ? 'urgent' as NocPriority : 'routine' as NocPriority,
        linkId: typeof (t as Partial<TicTimer>).linkId === 'string' ? (t as Partial<TicTimer>).linkId as string : null,
        ring: (t.ring ?? 'soft') as RingId,
      };
      if (base.status === 'running' && base.endsAt) {
        const rem = base.endsAt - now;
        if (rem <= 0) return { ...base, status: 'done' as Status, remainingMs: 0, endsAt: null };
        return { ...base, remainingMs: rem };
      }
      if (base.status === 'done') return { ...base, remainingMs: 0 };
      return { ...base, status: base.status === 'running' ? 'paused' : base.status };
    });
    if (!timers.length) seed();
    timers.forEach((t) => { t.nextId ??= null; });
  } catch { seed(); }
}

function seed() {
  const now = Date.now();
  timers = [
    { id: uid(), name: 'Callback user', totalSeconds: 30 * 60, remainingMs: 30 * 60 * 1000, endsAt: null, status: 'idle', accent: 'orange', ringStyle: 'classic', ring: 'soft', tags: ['callback'], nextId: null, createdAt: now, ticket: '', priority: 'urgent', linkId: null },
    { id: uid(), name: 'Recheck ticket', totalSeconds: 60 * 60, remainingMs: 60 * 60 * 1000, endsAt: null, status: 'idle', accent: 'blue', ringStyle: 'thin', ring: 'soft', tags: ['check'], nextId: null, createdAt: now + 1, ticket: '', priority: 'routine', linkId: null },
  ];
  save();
}

function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(timers)); } catch { /* ignore */ }
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
    grid.innerHTML = `<div class="t-empty"><h2 class="t-emptyh">no timers here</h2><p class="t-emptyp">${filter ? `nothing tagged #${filter} yet.` : 'make one above to begin.'}</p></div>`;
    return;
  }
  list.forEach((t) => {
    const card = document.createElement('article');
    card.className = 'group t-card';
    card.dataset.status = t.status;
    card.style.setProperty('--accent', accentColor(t.accent));
    card.id = `card-${t.id}`;

    const tagsHtml = t.tags.length
      ? t.tags.map((x) => `<span class="t-tag">#${escapeHtml(x)}</span>`).join('')
      : '';

    const nextName = t.nextId ? timers.find((x) => x.id === t.nextId)?.name : undefined;
    const ticketHtml = t.ticket ? `<span class="t-ticket">${escapeHtml(t.ticket)}</span>` : '';
    const prioHtml = t.priority === 'urgent' ? `<span class="t-prio" data-prio="urgent">!</span>` : '';
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
            <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(23,52,216,0.25)" stroke-width="${STROKE[t.ringStyle]}" stroke-dasharray="3 6" />
            <circle class="progress" cx="60" cy="60" r="54" fill="none" stroke="#1734d8" stroke-width="${STROKE[t.ringStyle]}" stroke-dasharray="${C}" stroke-dashoffset="${C}" />
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center"><div class="t-time" data-time>${fmt(t.remainingMs)}</div><div class="t-sub" data-sub>${t.ring}</div></div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="mb-2.5 flex flex-wrap gap-1.5">${tagsHtml}</div>
          <div class="text-[13.5px] italic text-ink/70">${t.ringStyle} ring · ${ringName(t.ring)} sound${nextName ? ` · → ${escapeHtml(nextName)}` : ''}</div>
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
}

function reset(id: string) {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  t.remainingMs = t.totalSeconds * 1000; t.endsAt = null;
  t.status = 'idle'; save(); paintCard(t); updateCount();
}

function remove(id: string) {
  timers = timers.filter((t) => t.id !== id);
  save(); render();
}

function notifyDone(t: TicTimer) {
  if (!('Notification' in window)) return;
  const show = () => {
    try { new Notification(`tic · ${t.name}`, { body: 'time is up.' }); } catch { /* noop */ }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') {
    try { void Notification.requestPermission().then((p) => { if (p === 'granted') show(); }); } catch { /* noop */ }
  }
}

function finish(t: TicTimer) {
  t.status = 'done'; t.remainingMs = 0; t.endsAt = null;
  // Quiet nudge by default: routine = single soft ring, urgent = triple.
  playRing(t.ring, t.priority === 'urgent' ? 3 : 1);
  try { navigator.vibrate?.(200); } catch { /* noop */ }
  notifyDone(t);
  if (t.nextId) {
    const nx = timers.find((x) => x.id === t.nextId);
    if (nx && nx.status !== 'running') {
      if (nx.status === 'done' || nx.remainingMs <= 0) nx.remainingMs = nx.totalSeconds * 1000;
      nx.endsAt = Date.now() + nx.remainingMs;
      nx.status = 'running';
      paintCard(nx);
      ensureTick();
    }
  }
  save(); paintCard(t); updateCount();
}

export function toggleFirstTimer() {
  const running = timers.find((t) => t.status === 'running');
  if (running) { toggle(running.id); return; }
  const next = visible().find((t) => t.status !== 'done');
  if (next) toggle(next.id);
}

export function getTimersState(): TicTimer[] { return timers; }
export function setTimersState(list: TicTimer[]) {
  timers = list;
  save(); render();
}

// The loop only runs while at least one timer is running, and pauses when
// the tab is hidden. Accuracy is unaffected — everything derives from
// Date.now() timestamps, so frames are purely presentational.
let ticking = false;
function ensureTick() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(tick);
}

function tick() {
  const now = Date.now();
  let changed = false;
  for (const t of timers) {
    if (t.status !== 'running' || t.endsAt === null) continue;
    const rem = t.endsAt - now;
    if (rem <= 0) { finish(t); continue; }
    t.remainingMs = rem;
    const e = els.get(t.id);
    if (e) {
      const target = t.totalSeconds > 0 ? rem / (t.totalSeconds * 1000) : 0;
      e.shown += (target - e.shown) * 0.25;
      if (Math.abs(target - e.shown) < 0.0005) e.shown = target;
      e.prog.style.strokeDashoffset = String(C * e.shown);
      const txt = fmt(rem);
      if (e.time.textContent !== txt) e.time.textContent = txt;
    }
    changed = true;
  }
  if (changed && now % 5000 < 50) save();
  updateTabChrome(now);
  if (!timers.some((t) => t.status === 'running' && t.endsAt !== null) || document.hidden) {
    ticking = false;
    return;
  }
  requestAnimationFrame(tick);
}

// Tab chrome: live countdown in the title + a progress-ring favicon,
// repainted at most once per second. Costs nothing when idle.
const favLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!;
const favOrig = favLink.href;
const favCanvas = document.createElement('canvas');
favCanvas.width = favCanvas.height = 64;
const BASE_TITLE = 'tic — a quiet timer manager';
let lastChromeSec = -1;
let chromeOn = false;

function updateTabChrome(now: number) {
  const r = timers.find((t) => t.status === 'running' && t.endsAt !== null);
  if (!r || r.endsAt === null) {
    if (chromeOn) {
      document.title = BASE_TITLE;
      favLink.href = favOrig;
      chromeOn = false;
      lastChromeSec = -1;
    }
    return;
  }
  const sec = Math.max(0, Math.ceil((r.endsAt - now) / 1000));
  if (chromeOn && sec === lastChromeSec) return;
  lastChromeSec = sec;
  chromeOn = true;
  document.title = `${fmt(r.remainingMs)} · ${r.name}`;
  const ctx = favCanvas.getContext('2d');
  if (!ctx) return;
  const frac = r.totalSeconds > 0 ? Math.max(0, Math.min(1, (r.endsAt - now) / (r.totalSeconds * 1000))) : 0;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#faf4e8';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = '#1734d8';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(32, 32, 24, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#1734d8';
  ctx.font = 'italic 28px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('t', 32, 34);
  favLink.href = favCanvas.toDataURL();
}

export function openModal(id: string | null) {
  editingId = id;
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
  nextSel.innerHTML = `<option value="">nothing — just ring</option>` + timers
    .filter((x) => x.id !== id)
    .map((x) => `<option value="${x.id}"${x.id === t?.nextId ? ' selected' : ''}>→ ${escapeHtml(x.name)}</option>`)
    .join('');
  nextSel.value = t?.nextId ?? '';
  $('#saveBtn').textContent = t ? 'Save changes' : 'Add timer';
  paintForm();
  $('#overlay').dataset.open = 'true';
  setTimeout(() => ($('#name') as HTMLInputElement).focus(), 120);
}
function closeModal() {
  const ov = $('#overlay');
  if (ov.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  ov.dataset.open = 'false';
  editingId = null;
}

function paintForm() {
  $$('#swatches .swatch').forEach((b) => { (b as HTMLElement).dataset.sel = String((b as HTMLElement).dataset.accent === fAccent); });
  const wheel = document.getElementById('accentWheel') as HTMLInputElement | null;
  if (wheel) {
    const custom = fAccent.startsWith('#');
    wheel.value = custom ? fAccent : '#1734d8';
    wheel.dataset.sel = String(custom);
  }
  $$('#ringstyle button').forEach((b) => { (b as HTMLElement).dataset.sel = String((b as HTMLElement).dataset.style === fRingStyle); });
  $$('#rings .ring-opt').forEach((b) => { (b as HTMLElement).dataset.sel = String((b as HTMLElement).dataset.ring === fRing); });
  $$('#prioRow button').forEach((b) => { (b as HTMLElement).dataset.sel = String((b as HTMLElement).dataset.prio === fPriority); });
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
  wheel.value = '#1734d8';
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
  const name = (($('#name') as HTMLInputElement).value || '').trim() || 'Untitled';
  const h = Math.max(0, parseInt(($('#h') as HTMLInputElement).value || '0', 10) || 0);
  const m = Math.max(0, parseInt(($('#m') as HTMLInputElement).value || '0', 10) || 0);
  const s = Math.max(0, parseInt(($('#s') as HTMLInputElement).value || '0', 10) || 0);
  let total = h * 3600 + m * 60 + s;
  if (total <= 0) total = 60;
  if (total > 99 * 3600) total = 99 * 3600;
  const tags = (($('#tags') as HTMLInputElement).value || '').split(',').map((x) => x.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean).slice(0, 5);
  const ticketEl = document.getElementById('ticket') as HTMLInputElement | null;
  const ticket = (ticketEl?.value || fTicket || '').trim().slice(0, 40);
  const picked = (($('#next') as HTMLSelectElement).value || '') || null;
  const nextId = picked && timers.some((x) => x.id === picked) ? picked : null;

  if (editingId) {
    const t = timers.find((x) => x.id === editingId);
    if (t) {
      const wasTotal = t.totalSeconds;
      t.name = name; t.totalSeconds = total; t.accent = fAccent; t.ringStyle = fRingStyle; t.ring = fRing; t.tags = tags; t.nextId = nextId;
      t.ticket = ticket; t.priority = fPriority;
      if (t.status === 'idle' || t.status === 'done' || wasTotal !== total) {
        if (t.status !== 'done') { t.remainingMs = total * 1000; t.endsAt = null; t.status = 'idle'; }
      }
    }
  } else {
    timers.push({ id: uid(), name, totalSeconds: total, remainingMs: total * 1000, endsAt: null, status: 'idle', accent: fAccent, ringStyle: fRingStyle, ring: fRing, tags, nextId, createdAt: Date.now(), ticket, priority: fPriority, linkId: null });
  }
  save(); closeModal(); render();
}

export function createTimer(opts: { name: string; minutes: number; tags: string[]; ticket?: string; priority?: NocPriority; linkId?: string | null; start?: boolean }): TicTimer {
  const total = Math.max(1, Math.round(opts.minutes * 60));
  const t: TicTimer = {
    id: uid(),
    name: opts.name || 'Untitled',
    totalSeconds: total,
    remainingMs: total * 1000,
    endsAt: opts.start ? Date.now() + total * 1000 : null,
    status: opts.start ? 'running' : 'idle',
    accent: opts.priority === 'urgent' ? 'orange' : 'blue',
    ringStyle: 'classic',
    ring: 'soft',
    tags: opts.tags,
    nextId: null,
    createdAt: Date.now(),
    ticket: (opts.ticket || '').slice(0, 40),
    priority: opts.priority ?? 'routine',
    linkId: opts.linkId ?? null,
  };
  timers.push(t);
  save(); render(); ensureTick();
  return t;
}

export function linkTimerToBox(timerId: string, boxId: string) {
  const t = timers.find((x) => x.id === timerId);
  if (t) { t.linkId = boxId; save(); render(); }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function init() {
  load();
  buildFormStatics();
  buildPrioStatics();
  render();
  ensureTick();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureTick(); });

  ($('#fab') as HTMLButtonElement).onclick = () => openModal(null);
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#saveBtn').addEventListener('click', saveForm);
  $('#overlay').addEventListener('click', (e) => { if (e.target === $('#overlay')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); if (e.key === 'Enter' && $('#overlay').dataset.open === 'true' && (e.target as HTMLElement).tagName !== 'BUTTON') saveForm(); });

  $$('#presets button').forEach((b) => b.addEventListener('click', () => {
    const sec = parseInt((b as HTMLElement).dataset.sec || '300', 10);
    ($('#h') as HTMLInputElement).value = String(Math.floor(sec / 3600));
    ($('#m') as HTMLInputElement).value = String(Math.floor((sec % 3600) / 60));
    ($('#s') as HTMLInputElement).value = String(sec % 60);
  }));

  setInterval(save, 10000);
}
