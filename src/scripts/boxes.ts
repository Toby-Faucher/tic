import { playTick, getTick } from './sounds.ts';
import { ACCENTS, accentColor, escapeHtml, uid, openModal as openTimerModal, toggleFirstTimer, getTimersState, setTimersState, createTimer, linkTimerToBox, resetTimerFilter } from './app.ts';
import { getPrimary, PRIMARY_EVENT, trapTabFor, pushEscapeCloser, popEscapeCloser } from './settings.ts';
import { getGoalText } from './goal.ts';
import { NOC_TEMPLATES, handoverMarkdown, type NocTemplate } from './noc.ts';
import { sanitizeBox, sanitizeTimer, parseTags, parseTicket } from './validate.ts';
import { KEYS, readJSON, writeJSON } from './keys.ts';

export type BoxPriority = 'routine' | 'urgent';

export interface TicBox {
  id: string;
  title: string;
  body: string;
  tags: string[];
  accent: string;
  done: boolean;
  pinned: boolean;
  order: number;
  createdAt: number;
  ticket: string;
  priority: BoxPriority;
  linkId: string | null;
}

const LS_KEY = KEYS.boxes;

let boxes: TicBox[] = [];
let bfilter: string | null = null;
let bediting: string | null = null;
let boxInvoker: HTMLElement | null = null;
let bfAccent = 'blue';
let bfTicket = '';
let bfPriority: BoxPriority = 'routine';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

function load() {
  const parsed = readJSON<unknown>(LS_KEY, null);
  if (parsed === null) return seed();
  if (!Array.isArray(parsed)) return seed();
  const clean: TicBox[] = [];
  for (const row of parsed) {
    const s = sanitizeBox(row);
    if (s) clean.push(s);
  }
  boxes = clean;
}

function seed() {
  const now = Date.now();
  boxes = [
    { id: uid(), title: 'Call back user', body: 'INC example — confirm fix, close loop.', tags: ['callback'], accent: 'orange', done: false, pinned: true, order: now, createdAt: now, ticket: '', priority: 'urgent', linkId: null },
    { id: uid(), title: 'Watch escalated ticket', body: 'Waiting on vendor — chase if no update.', tags: ['waiting'], accent: 'blue', done: false, pinned: false, order: now + 1, createdAt: now + 1, ticket: '', priority: 'routine', linkId: null },
  ];
  save();
}

function save() {
  writeJSON(LS_KEY, boxes);
}

function allTags(): string[] {
  const set = new Set<string>();
  boxes.forEach((b) => b.tags.forEach((x) => set.add(x)));
  return [...set].sort();
}

function visible(): TicBox[] {
  const list = bfilter ? boxes.filter((b) => b.tags.includes(bfilter!)) : boxes;
  const rank = (b: TicBox) => (b.done ? 3 : b.pinned ? 0 : b.priority === 'urgent' ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.order - b.order);
}

export function getBoxesState(): TicBox[] { return boxes; }

function render() {
  renderFilters();
  renderGrid();
}

function renderFilters() {
  const wrap = $('#boxFilters');
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
  mk('all', bfilter === null, () => { bfilter = null; render(); });
  allTags().forEach((t) => mk('#' + t, bfilter === t, () => { bfilter = bfilter === t ? null : t; render(); }));
}

function renderGrid() {
  const grid = $('#boxGrid');
  grid.innerHTML = '';
  const list = visible();
  if (!list.length) {
    grid.innerHTML = `<div class="t-empty"><h2 class="t-emptyh">no boxes here</h2><p class="t-emptyp">${bfilter ? `nothing tagged #${escapeHtml(bfilter)} yet.` : 'make one above to begin.'}</p></div>`;
    return;
  }
  list.forEach((b) => {
    const card = document.createElement('article');
    card.className = 'group t-card';
    card.dataset.done = String(b.done);
    const linkedForFlag = b.linkId ? getTimersState().find((t) => t.id === b.linkId) : undefined;
    if (linkedForFlag?.status === 'done' && !b.done) card.dataset.need = 'true';
    // 'blue' binds the live token so settings changes apply with no JS repaint.
    card.style.setProperty('--accent', b.accent === 'blue' ? 'var(--color-ink)' : accentColor(b.accent));
    card.id = `box-${b.id}`;

    const tagsHtml = b.tags.length
      ? b.tags.map((x) => `<span class="t-tag">#${escapeHtml(x)}</span>`).join('')
      : '';
    const date = new Date(b.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const ticketHtml = b.ticket ? `<span class="t-ticket">${escapeHtml(b.ticket)}</span>` : '';
    const prioHtml = b.priority === 'urgent' && !b.done ? `<span class="t-prio" data-prio="urgent">!</span>` : '';
    const linked = b.linkId ? getTimersState().find((t) => t.id === b.linkId) : undefined;
    const linkedHtml = linked
      ? linked.status === 'done'
        ? '<span class="t-need">· timer up — do it</span>'
        : `<span class="t-linked">· timer ${escapeHtml(linked.status)}</span>`
      : '';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="t-boxtitle">${prioHtml}${escapeHtml(b.title)}${ticketHtml}</h3>
          <div class="t-meta"><span class="t-dot"></span><span>${b.done ? 'done' : 'open'} · ${date}</span>${linkedHtml}</div>
        </div>
        <div class="flex gap-1.5">
          <button class="t-iconbtn" data-act="pin" aria-label="${b.pinned ? 'Unpin' : 'Pin'}" title="${b.pinned ? 'Unpin' : 'Pin'}">${b.pinned ? 'unpin' : 'pin'}</button>
          <button class="t-iconbtn" data-act="edit" aria-label="Edit" title="Edit">edit</button>
          <button class="t-iconbtn" data-act="del" aria-label="Delete" title="Delete">×</button>
        </div>
      </div>
      <div class="my-4 flex items-center gap-[18px]">
        <button class="t-boxring" data-act="toggle" aria-label="${b.done ? 'Untick' : 'Tick off'}">✓</button>
        <div class="min-w-0 flex-1">
          <div class="mb-2.5 flex flex-wrap gap-1.5">${tagsHtml}</div>
          <div class="t-boxdesc">${b.body ? escapeHtml(b.body) : '—'}</div>
        </div>
      </div>
    `;

    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', b.id);
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      persistOrder();
    });

    card.querySelectorAll('[data-act="toggle"]').forEach((el) => el.addEventListener('click', () => toggle(b.id)));
    card.querySelector('[data-act="pin"]')!.addEventListener('click', () => togglePin(b.id));
    card.querySelector('[data-act="edit"]')!.addEventListener('click', () => openModal(b.id));
    card.querySelector('[data-act="del"]')!.addEventListener('click', () => remove(b.id));

    grid.appendChild(card);
  });
}

function toggle(id: string) {
  const b = boxes.find((x) => x.id === id);
  if (!b) return;
  b.done = !b.done;
  save();
  // In-place flip: no full render. Update dataset + meta text directly.
  const card = document.getElementById(`box-${id}`);
  if (card) {
    card.dataset.done = String(b.done);
    const linkedFlag = b.linkId ? getTimersState().find((t) => t.id === b.linkId) : undefined;
    if (!b.done && linkedFlag?.status === 'done') card.dataset.need = 'true';
    else card.removeAttribute('data-need');
    const meta = card.querySelector('.t-meta span:nth-child(2)');
    if (meta) {
      const date = new Date(b.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      meta.textContent = `${b.done ? 'done' : 'open'} · ${date}`;
    }
    const btn = card.querySelector('[data-act="toggle"]');
    if (btn) {
      btn.setAttribute('aria-label', b.done ? 'Untick' : 'Tick off');
    }
  } else {
    render();
  }
  if (b.done) {
    playTick(getTick());
    if (card) {
      card.classList.remove('animate-pop');
      void card.offsetWidth;
      card.classList.add('animate-pop');
    }
  }
}

function togglePin(id: string) {
  const b = boxes.find((x) => x.id === id);
  if (!b) return;
  b.pinned = !b.pinned;
  save(); render();
}

function persistOrder() {
  const grid = $('#boxGrid');
  const domIds = [...grid.querySelectorAll('article')]
    .map((el) => el.id.replace(/^box-/, ''))
    .filter((id) => boxes.some((x) => x.id === id));
  if (!domIds.length) return;
  // Filtered-drag fix: map the dragged visible order onto the prior sorted
  // order values so hidden (filtered-out) boxes keep their positions.
  const ordered = domIds
    .map((id) => boxes.find((x) => x.id === id)!)
    .filter(Boolean);
  const prior = ordered.map((b) => b.order).sort((a, b2) => a - b2);
  domIds.forEach((id, i) => {
    const b = boxes.find((x) => x.id === id);
    if (b && typeof prior[i] === 'number') b.order = prior[i] as number;
  });
  save(); render();
}

function remove(id: string) {
  boxes = boxes.filter((b) => b.id !== id);
  save(); render();
}

function openModal(id: string | null) {
  bediting = id;
  const b = id ? boxes.find((x) => x.id === id) : null;  $('#boxSheetTitle').textContent = b ? 'Edit box' : 'New box';
  ($('#btitle') as HTMLInputElement).value = b?.title ?? '';
  ($('#bbody') as HTMLTextAreaElement).value = b?.body ?? '';
  ($('#btags') as HTMLInputElement).value = b?.tags.join(', ') ?? '';
  const bticket = document.getElementById('bticket') as HTMLInputElement | null;
  if (bticket) bticket.value = b?.ticket ?? '';
  bfAccent = b?.accent ?? 'blue';
  bfTicket = b?.ticket ?? '';
  bfPriority = b?.priority ?? 'routine';
  $('#boxSave').textContent = b ? 'Save changes' : 'Add box';
  paintForm();
  boxInvoker = document.activeElement as HTMLElement | null;
  $('#boxOverlay').dataset.open = 'true';
  pushEscapeCloser(closeModal);
  ($('#btitle') as HTMLInputElement).focus();
}
function closeModal() {
  const ov = $('#boxOverlay');
  if (ov.dataset.open !== 'true') return;
  ov.dataset.open = 'false';
  popEscapeCloser(closeModal);
  bediting = null;
  if (boxInvoker && document.contains(boxInvoker)) boxInvoker.focus();
  boxInvoker = null;
}

function paintForm() {
  $$('#bswatches .swatch').forEach((x) => { const el = x as HTMLElement; el.dataset.sel = String(el.dataset.accent === bfAccent); el.setAttribute('aria-pressed', String(el.dataset.accent === bfAccent)); });
  const wheel = document.getElementById('baccentWheel') as HTMLInputElement | null;
  if (wheel) {
    const custom = typeof bfAccent === 'string' && bfAccent.startsWith('#');
    wheel.value = custom ? (bfAccent as string) : getPrimary();
    wheel.dataset.sel = String(custom);
  }
  $$('#bprioRow button').forEach((x) => { const el = x as HTMLElement; el.dataset.sel = String(el.dataset.prio === bfPriority); el.setAttribute('aria-pressed', String(el.dataset.prio === bfPriority)); });
}

function buildFormStatics() {
  const sw = $('#bswatches'); sw.innerHTML = '';
  Object.keys(ACCENTS).forEach((a) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'swatch t-swatch'; btn.dataset.accent = a;
    btn.title = a; btn.setAttribute('aria-label', a);
    btn.style.background = ACCENTS[a];
    btn.onclick = () => { bfAccent = a; paintForm(); };
    sw.appendChild(btn);
  });
  const wheel = document.createElement('input');
  wheel.type = 'color'; wheel.id = 'baccentWheel';
  wheel.title = 'Custom colour'; wheel.setAttribute('aria-label', 'Custom colour');
  wheel.value = getPrimary();
  wheel.addEventListener('input', () => { bfAccent = wheel.value; paintForm(); });
  sw.appendChild(wheel);

  const prow = document.getElementById('bprioRow');
  if (prow) {
    prow.innerHTML = '';
    (['routine', 'urgent'] as BoxPriority[]).forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.prio = p;
      b.className = 't-rsbtn';
      b.textContent = p === 'urgent' ? 'urgent (!)' : 'routine';
      b.onclick = () => { bfPriority = p; paintForm(); };
      prow.appendChild(b);
    });
  }
  const bticket = document.getElementById('bticket') as HTMLInputElement | null;
  bticket?.addEventListener('input', () => { bfTicket = bticket.value; });
}

export function createBox(opts: { title: string; body?: string; tags: string[]; ticket?: string; priority?: BoxPriority; linkId?: string | null; pinned?: boolean }, deferRender = false): TicBox {
  const order = boxes.reduce((m, x) => Math.max(m, typeof x.order === 'number' && Number.isFinite(x.order) ? x.order : 0), 0) + 1;
  const b: TicBox = {
    id: uid(),
    title: (opts.title || 'Untitled').slice(0, 120),
    body: typeof opts.body === 'string' ? opts.body : '',
    tags: parseTags(opts.tags),
    accent: opts.priority === 'urgent' ? 'orange' : 'blue',
    done: false,
    pinned: !!opts.pinned,
    order,
    createdAt: Date.now(),
    ticket: parseTicket(opts.ticket ?? ''),
    priority: opts.priority ?? 'routine',
    linkId: typeof opts.linkId === 'string' ? opts.linkId : null,
  };
  boxes.push(b);
  if (deferRender) return b;
  save(); render();
  return b;
}

export function createNocPair(t: NocTemplate, ticket = ''): void {
  const cleanTicket = parseTicket(ticket);
  if (!t.makeBox && t.minutes <= 0) return;
  if (t.minutes <= 0) {
    createBox({ title: t.boxTitle, body: cleanTicket ? `ticket ${cleanTicket}` : '', tags: t.tags, ticket: cleanTicket, priority: t.priority });
    return;
  }
  if (!t.makeBox) {
    createTimer({
      name: cleanTicket ? `${t.timerName} [${cleanTicket}]`.slice(0, 60) : t.timerName,
      minutes: t.minutes,
      tags: t.tags,
      ticket: cleanTicket,
      priority: t.priority,
      linkId: null,
      start: t.startTimer,
    });
    return;
  }
  // Single save+render per store: defer per-item flushes, link in memory once.
  const box = createBox({ title: t.boxTitle, body: cleanTicket ? `ticket ${cleanTicket}` : '', tags: t.tags, ticket: cleanTicket, priority: t.priority }, true);
  const timer = createTimer({
    name: cleanTicket ? `${t.timerName} [${cleanTicket}]`.slice(0, 60) : t.timerName,
    minutes: t.minutes,
    tags: t.tags,
    ticket: cleanTicket,
    priority: t.priority,
    linkId: box.id,
    start: t.startTimer,
  }, true);
  box.linkId = timer.id;
  timer.linkId = box.id;
  save(); render();
  linkTimerToBox(timer.id, box.id);
}

function saveForm() {
  const title = ((($('#btitle') as HTMLInputElement).value || '').trim() || 'Untitled').slice(0, 120);
  const body = (($('#bbody') as HTMLTextAreaElement).value || '').trim();
  const tags = parseTags(($('#btags') as HTMLInputElement).value || '');
  const bticket = document.getElementById('bticket') as HTMLInputElement | null;
  const ticket = parseTicket(bticket?.value ?? bfTicket);

  if (bediting) {
    const b = boxes.find((x) => x.id === bediting);
    if (b) { b.title = title; b.body = body; b.tags = tags; b.accent = bfAccent; b.ticket = ticket; b.priority = bfPriority; }
  } else {
    const order = boxes.reduce((m, x) => Math.max(m, typeof x.order === 'number' ? x.order : 0), 0) + 1;
    boxes.push({ id: uid(), title, body, tags, accent: bfAccent, done: false, pinned: false, order, createdAt: Date.now(), ticket, priority: bfPriority, linkId: null });
  }
  save(); closeModal(); render();
}

let currentView = 'timers';

function isBoxesView(): boolean {
  return currentView === 'boxes';
}

function show(view: string) {
  currentView = view;
  const tabs = $$('#tabs .tab');
  const fab = $('#fab') as HTMLButtonElement;
  tabs.forEach((t) => { (t as HTMLElement).dataset.active = String((t as HTMLElement).dataset.view === view); });
  ($('#timerView') as HTMLElement).hidden = view !== 'timers';
  ($('#boxView') as HTMLElement).hidden = view !== 'boxes';
  // The header button follows the tab: it adds a timer or a box.
  fab.textContent = view === 'boxes' ? '+ new box' : '+ new timer';
  fab.onclick = () => (view === 'boxes' ? openModal(null) : openTimerModal(null));
}

function initTabs() {
  const tabs = $$('#tabs .tab');
  tabs.forEach((t) => t.addEventListener('click', () => show((t as HTMLElement).dataset.view || 'timers')));
  show('timers');
}

function toggleFirstOpenBox() {
  const next = visible().find((b) => !b.done);
  if (next) toggle(next.id);
}

function typingTarget(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function anyModalOpen(): boolean {
  return ($('#overlay') as HTMLElement).dataset.open === 'true'
    || ($('#boxOverlay') as HTMLElement).dataset.open === 'true'
    || (document.getElementById('settingsOverlay') as HTMLElement | null)?.dataset.open === 'true';
}

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (anyModalOpen() || typingTarget()) return;
    if (e.key === '1') show('timers');
    else if (e.key === '2') show('boxes');
    else if (e.key === 'n') {
      e.preventDefault();
      if (isBoxesView()) openModal(null);
      else openTimerModal(null);
    } else if (e.key === ' ') {
      // A focused button already handles space natively — don't double-fire.
      if ((document.activeElement as HTMLElement | null)?.tagName === 'BUTTON') return;
      e.preventDefault();
      if (isBoxesView()) toggleFirstOpenBox();
      else toggleFirstTimer();
    }
  });
}

function initBackup() {
  $('#exportBtn').addEventListener('click', () => {
    const data = {
      app: 'tic',
      version: 2,
      exportedAt: new Date().toISOString(),
      timers: getTimersState(),
      boxes: getBoxesState(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tic-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  const file = $('#importFile') as HTMLInputElement;
  const importBtn = $('#importBtn') as HTMLButtonElement;
  const origLabel = importBtn.textContent;
  importBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    // 1MB cap before reading — avoids freezing on huge drops.
    if (f.size > 1024 * 1024) {
      importBtn.textContent = 'too big';
      announceAction('Import failed — file over 1MB');
      setTimeout(() => { importBtn.textContent = origLabel; }, 1600);
      return;
    }
    try {
      const parsed = JSON.parse(await f.text()) as { timers?: unknown; boxes?: unknown };
      if (!parsed || !Array.isArray(parsed.timers) || !Array.isArray(parsed.boxes)) throw new Error('bad shape');
      // Strict per-row sanitize: count skipped rows for feedback.
      let skipped = 0;
      const cleanTimers = [];
      for (const row of parsed.timers) {
        const s = sanitizeTimer(row);
        if (s) cleanTimers.push(s);
        else skipped++;
      }
      const cleanBoxes = [];
      for (const row of parsed.boxes) {
        const s = sanitizeBox(row);
        if (s) cleanBoxes.push(s);
        else skipped++;
      }
      if (!cleanTimers.length && !cleanBoxes.length) throw new Error(`bad file (${skipped} rows skipped)`);
      // Second pass: drop dangling timer links against the surviving id set.
      const ids = new Set(cleanTimers.map((t) => t.id));
      for (const t of cleanTimers) {
        if (t.nextId && (t.nextId === t.id || !ids.has(t.nextId))) t.nextId = null;
        if (t.linkId && t.linkId === t.id) t.linkId = null;
      }
      setTimersState(cleanTimers);
      boxes = cleanBoxes;
      bfilter = null;
      resetTimerFilter();
      save(); render();
      importBtn.textContent = skipped > 0 ? `bad file (${skipped} rows skipped)` : 'done ✓';
      announceAction(skipped > 0 ? `Import finished — ${skipped} rows skipped` : 'Import finished');
    } catch (e) {
      const msg = e instanceof Error && /rows skipped/.test(e.message) ? e.message : 'bad file';
      importBtn.textContent = msg;
      announceAction(`Import failed — ${msg}`);
    }
    setTimeout(() => { importBtn.textContent = origLabel; }, 1600);
  });
}

function initDrag() {
  const grid = $('#boxGrid');
  let raf = 0;
  let lastY = 0;
  let midCache: { el: HTMLElement; mid: number }[] | null = null;
  const invalidateMids = () => { midCache = null; };
  grid.addEventListener('dragstart', invalidateMids, true);
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    lastY = e.clientY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const dragging = grid.querySelector('.dragging') as HTMLElement | null;
      if (!dragging || !grid.contains(dragging)) return;
      if (!midCache) {
        midCache = [...grid.querySelectorAll('article:not(.dragging)')].map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return { el: el as HTMLElement, mid: r.top + r.height / 2 };
        });
      }
      const after = midCache.find((m) => lastY < m.mid)?.el;
      if (after) grid.insertBefore(dragging, after);
      else grid.appendChild(dragging);
      // Midlines shift after a move — refresh cheaply next frame.
      midCache = null;
    });
  });
  grid.addEventListener('drop', invalidateMids);
  grid.addEventListener('dragend', invalidateMids);
}

function initNocBar() {
  const bar = document.getElementById('nocBar');
  if (!bar) return;
  bar.innerHTML = '';
  const ticketWrap = document.createElement('div');
  ticketWrap.className = 't-noc-ticketwrap';
  ticketWrap.innerHTML = `<label class="sr-only" for="nocTicket">Ticket number</label><input id="nocTicket" class="t-noc-ticket" placeholder="ticket # e.g. INC1234" autocomplete="off" spellcheck="false" />`;
  bar.appendChild(ticketWrap);
  const btns = document.createElement('div');
  btns.className = 't-noc-btns';
  NOC_TEMPLATES.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 't-nocbtn';
    b.dataset.urgent = String(t.priority === 'urgent');
    b.title = t.hint;
    b.textContent = `+ ${t.label}`;
    b.onclick = () => {
      const ticketEl = document.getElementById('nocTicket') as HTMLInputElement | null;
      createNocPair(t, ticketEl?.value || '');
      if (ticketEl) { ticketEl.value = ''; ticketEl.focus(); }
    };
    btns.appendChild(b);
  });
  bar.appendChild(btns);
}

function announceAction(msg: string) {
  // Stable-label feedback for the #actionStatus role=status region
  // (index.astro bridge also backstops textContent swaps into it).
  try { (window as unknown as { __ticAnnounceAction?: (m: string) => void }).__ticAnnounceAction?.(msg); } catch { /* noop */ }
}

function initHandover() {
  const btn = document.getElementById('handoverBtn') as HTMLButtonElement | null;
  if (!btn) return;
  const orig = btn.textContent;
  btn.addEventListener('click', async () => {
    const md = handoverMarkdown(
      getTimersState().map((t) => ({ name: t.name, ticket: t.ticket, status: t.status, tags: t.tags, priority: t.priority })),
      getBoxesState().map((b) => ({ title: b.title, body: b.body, ticket: b.ticket, tags: b.tags, done: b.done, pinned: b.pinned, priority: b.priority })),
      '',
      getGoalText(),
    );
    try {
      await navigator.clipboard.writeText(md);
      btn.textContent = 'copied ✓';
      announceAction('Handover copied to clipboard');
    } catch {
      // Clipboard blocked — download instead so nothing is lost.
      const blob = new Blob([md], { type: 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `handover-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      btn.textContent = 'saved ✓';
      announceAction('Clipboard blocked — handover downloaded as Markdown');
    }
    setTimeout(() => { btn.textContent = orig; }, 1600);
  });
}

export function initBoxes() {
  load();
  buildFormStatics();
  render();
  initTabs();
  initShortcuts();
  initBackup();
  initDrag();
  initNocBar();
  initHandover();

  $('#boxCancel').addEventListener('click', closeModal);
  $('#boxSave').addEventListener('click', saveForm);
  // 'blue' accents bind var(--color-ink) live, so primary changes need no
  // re-render here — just keep the form's fallback wheel in sync.
  document.addEventListener(PRIMARY_EVENT, () => {
    const wheel = document.getElementById('baccentWheel') as HTMLInputElement | null;
    if (wheel && (typeof bfAccent !== 'string' || !bfAccent.startsWith('#'))) wheel.value = getPrimary();
  });
  $('#boxOverlay').addEventListener('click', (e) => { if (e.target === $('#boxOverlay')) closeModal(); });
  $('#boxOverlay').addEventListener('keydown', trapTabFor('boxOverlay'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Managed LIFO stack (settings.ts, capture phase) owns Escape when any
      // pushed modal is open — don't close out of order underneath it.
      const stack = (window as unknown as { __ticEscapeStack?: unknown[] }).__ticEscapeStack;
      if (stack && stack.length > 0) return;
      closeModal();
    }
    if (e.key === 'Enter' && $('#boxOverlay').dataset.open === 'true') {
      const el = e.target as HTMLElement;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && (el as HTMLInputElement).type === 'color') return;
      e.preventDefault();
      saveForm();
    }
  });
}
