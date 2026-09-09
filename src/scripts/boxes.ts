import { playPop } from './sounds.ts';
import { ACCENTS, accentColor, escapeHtml, uid, openModal as openTimerModal, toggleFirstTimer, getTimersState, setTimersState, createTimer, linkTimerToBox } from './app.ts';
import { NOC_TEMPLATES, handoverMarkdown, type NocTemplate } from './noc.ts';

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

const LS_KEY = 'tic.boxes.v1';

let boxes: TicBox[] = [];
let bfilter: string | null = null;
let bediting: string | null = null;
let bfAccent = 'blue';
let bfTicket = '';
let bfPriority: BoxPriority = 'routine';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => [...document.querySelectorAll<T>(sel)];

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return seed();
    boxes = JSON.parse(raw) as TicBox[];
    boxes.forEach((b) => {
      b.pinned ??= false;
      if (typeof b.order !== 'number') b.order = b.createdAt;
      if (typeof (b as Partial<TicBox>).ticket !== 'string') b.ticket = '';
      if ((b as Partial<TicBox>).priority !== 'urgent') b.priority = 'routine';
      if (typeof (b as Partial<TicBox>).linkId !== 'string') b.linkId = null;
    });
    if (!boxes.length) seed();
  } catch { seed(); }
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
  try { localStorage.setItem(LS_KEY, JSON.stringify(boxes)); } catch { /* ignore */ }
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
    grid.innerHTML = `<div class="t-empty"><h2 class="t-emptyh">no boxes here</h2><p class="t-emptyp">${bfilter ? `nothing tagged #${bfilter} yet.` : 'make one above to begin.'}</p></div>`;
    return;
  }
  list.forEach((b) => {
    const card = document.createElement('article');
    card.className = 'group t-card';
    card.dataset.done = String(b.done);
    const linkedForFlag = b.linkId ? getTimersState().find((t) => t.id === b.linkId) : undefined;
    if (linkedForFlag?.status === 'done' && !b.done) card.dataset.need = 'true';
    card.style.setProperty('--accent', accentColor(b.accent));
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
        : `<span class="t-linked">· timer ${linked.status}</span>`
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
  save(); render();
  if (b.done) {
    playPop();
    const card = document.getElementById(`box-${id}`);
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
  [...grid.querySelectorAll('article')].forEach((el, i) => {
    const b = boxes.find((x) => `box-${x.id}` === el.id);
    if (b) b.order = i;
  });
  save(); render();
}

function remove(id: string) {
  boxes = boxes.filter((b) => b.id !== id);
  save(); render();
}

function openModal(id: string | null) {
  bediting = id;
  const b = id ? boxes.find((x) => x.id === id) : null;
  $('#boxSheetTitle').textContent = b ? 'Edit box' : 'New box';
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
  $('#boxOverlay').dataset.open = 'true';
  setTimeout(() => ($('#btitle') as HTMLInputElement).focus(), 120);
}
function closeModal() {
  const ov = $('#boxOverlay');
  if (ov.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  ov.dataset.open = 'false';
  bediting = null;
}

function paintForm() {
  $$('#bswatches .swatch').forEach((x) => { (x as HTMLElement).dataset.sel = String((x as HTMLElement).dataset.accent === bfAccent); });
  const wheel = document.getElementById('baccentWheel') as HTMLInputElement | null;
  if (wheel) {
    const custom = bfAccent.startsWith('#');
    wheel.value = custom ? bfAccent : '#1734d8';
    wheel.dataset.sel = String(custom);
  }
  $$('#bprioRow button').forEach((x) => { (x as HTMLElement).dataset.sel = String((x as HTMLElement).dataset.prio === bfPriority); });
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
  wheel.value = '#1734d8';
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

export function createBox(opts: { title: string; body?: string; tags: string[]; ticket?: string; priority?: BoxPriority; linkId?: string | null; pinned?: boolean }): TicBox {
  const order = boxes.reduce((m, x) => Math.max(m, typeof x.order === 'number' ? x.order : 0), 0) + 1;
  const b: TicBox = {
    id: uid(),
    title: opts.title || 'Untitled',
    body: opts.body || '',
    tags: opts.tags,
    accent: opts.priority === 'urgent' ? 'orange' : 'blue',
    done: false,
    pinned: !!opts.pinned,
    order,
    createdAt: Date.now(),
    ticket: (opts.ticket || '').slice(0, 40),
    priority: opts.priority ?? 'routine',
    linkId: opts.linkId ?? null,
  };
  boxes.push(b);
  save(); render();
  return b;
}

export function createNocPair(t: NocTemplate, ticket = ''): void {
  const cleanTicket = ticket.trim().slice(0, 40);
  if (!t.makeBox && t.minutes <= 0) return;
  if (t.minutes <= 0) {
    createBox({ title: t.boxTitle, body: cleanTicket ? `ticket ${cleanTicket}` : '', tags: t.tags, ticket: cleanTicket, priority: t.priority });
    return;
  }
  const box = t.makeBox
    ? createBox({ title: t.boxTitle, body: cleanTicket ? `ticket ${cleanTicket}` : '', tags: t.tags, ticket: cleanTicket, priority: t.priority })
    : null;
  const timer = createTimer({
    name: cleanTicket ? `${t.timerName} [${cleanTicket}]`.slice(0, 60) : t.timerName,
    minutes: t.minutes,
    tags: t.tags,
    ticket: cleanTicket,
    priority: t.priority,
    linkId: box?.id ?? null,
    start: t.startTimer,
  });
  if (box && timer) {
    box.linkId = timer.id;
    save(); render();
    linkTimerToBox(timer.id, box.id);
  }
}

function saveForm() {
  const title = (($('#btitle') as HTMLInputElement).value || '').trim() || 'Untitled';
  const body = (($('#bbody') as HTMLTextAreaElement).value || '').trim();
  const tags = (($('#btags') as HTMLInputElement).value || '').split(',').map((x) => x.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean).slice(0, 5);
  const bticket = document.getElementById('bticket') as HTMLInputElement | null;
  const ticket = (bticket?.value || bfTicket || '').trim().slice(0, 40);

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
    || ($('#boxOverlay') as HTMLElement).dataset.open === 'true';
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

function validTimer(t: any): boolean {
  return !!t && typeof t.id === 'string' && typeof t.name === 'string'
    && typeof t.totalSeconds === 'number' && Array.isArray(t.tags);
}
function validBox(b: any): boolean {
  return !!b && typeof b.id === 'string' && typeof b.title === 'string' && Array.isArray(b.tags);
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
    try {
      const parsed = JSON.parse(await f.text());
      if (!Array.isArray(parsed.timers) || !Array.isArray(parsed.boxes)
        || !parsed.timers.every(validTimer) || !parsed.boxes.every(validBox)) {
        throw new Error('bad shape');
      }
      setTimersState(parsed.timers);
      boxes = parsed.boxes;
      boxes.forEach((b) => {
        b.pinned ??= false;
        if (typeof b.order !== 'number') b.order = b.createdAt;
        if (typeof (b as Partial<TicBox>).ticket !== 'string') b.ticket = '';
        if ((b as Partial<TicBox>).priority !== 'urgent') b.priority = 'routine';
        if (typeof (b as Partial<TicBox>).linkId !== 'string') b.linkId = null;
      });
      bfilter = null;
      save(); render();
      importBtn.textContent = 'done ✓';
    } catch {
      importBtn.textContent = 'bad file';
    }
    setTimeout(() => { importBtn.textContent = origLabel; }, 1600);
  });
}

function initDrag() {
  const grid = $('#boxGrid');
  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = grid.querySelector('.dragging');
    if (!dragging) return;
    const cards = [...grid.querySelectorAll('article:not(.dragging)')] as HTMLElement[];
    const after = cards.find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
    if (after) grid.insertBefore(dragging, after);
    else grid.appendChild(dragging);
  });
}

function initNocBar() {
  const bar = document.getElementById('nocBar');
  if (!bar) return;
  bar.innerHTML = '';
  const ticketWrap = document.createElement('div');
  ticketWrap.className = 't-noc-ticketwrap';
  ticketWrap.innerHTML = `<input id="nocTicket" class="t-noc-ticket" placeholder="ticket # e.g. INC1234" autocomplete="off" spellcheck="false" />`;
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

function initHandover() {
  const btn = document.getElementById('handoverBtn') as HTMLButtonElement | null;
  if (!btn) return;
  const orig = btn.textContent;
  btn.addEventListener('click', async () => {
    const md = handoverMarkdown(
      getTimersState().map((t) => ({ name: t.name, ticket: t.ticket, status: t.status, tags: t.tags, priority: t.priority })),
      getBoxesState().map((b) => ({ title: b.title, body: b.body, ticket: b.ticket, tags: b.tags, done: b.done, pinned: b.pinned, priority: b.priority })),
    );
    try {
      await navigator.clipboard.writeText(md);
      btn.textContent = 'copied ✓';
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
  $('#boxOverlay').addEventListener('click', (e) => { if (e.target === $('#boxOverlay')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && (e.target as HTMLElement).id !== 'bbody' && $('#boxOverlay').dataset.open === 'true' && (e.target as HTMLElement).tagName !== 'BUTTON') saveForm();
  });
}
