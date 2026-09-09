import type { TicTimer } from './app.ts';
import type { TicBox } from './boxes.ts';

export const MAX_TICKET = 40;
export const MAX_TAGS = 5;
export const MAX_TIMER_NAME = 60;
export const MAX_TOTAL = 99 * 3600;
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const STATUSES = ['idle', 'running', 'paused', 'done'] as const;
const RING_STYLES = ['thin', 'classic', 'bold'] as const;
const RING_IDS = ['chime', 'bell', 'pulse', 'soft', 'radar', 'harp', 'cuckoo', 'marimba', 'sparkle'] as const;
const ACCENT_KEYS = ['blue', 'violet', 'green', 'orange', 'pink', 'graphite'] as const;
const PRIORITIES = ['routine', 'urgent'] as const;

export function escapeHtml(s: unknown): string {
  try {
    return String(s ?? '').replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return '&#39;';
      }
    });
  } catch {
    return '';
  }
}

export function isHex(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
}

function genId(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch { /* fall through */ }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normalizeTag(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^#+/, '').trim();
  if (!s) return null;
  s = s.replace(/\s+/g, '-');
  if (!s || s === '-') return null;
  return s.slice(0, 40);
}

export function parseTags(raw: unknown): string[] {
  const src: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const out: string[] = [];
  for (const v of src) {
    const n = normalizeTag(v);
    if (n) out.push(n);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function parseTicket(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().slice(0, MAX_TICKET) : '';
}

export function clampTotal(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 60;
  const f = Math.floor(v);
  if (f <= 0) return 60;
  if (f > MAX_TOTAL) return MAX_TOTAL;
  return f;
}

function cleanId(v: unknown): string | null {
  return typeof v === 'string' && ID_RE.test(v) ? v : null;
}

function cleanAccent(v: unknown): string {
  if (typeof v !== 'string') return 'blue';
  if ((ACCENT_KEYS as readonly string[]).includes(v)) return v;
  if (isHex(v)) return v;
  return 'blue';
}

export function sanitizeTimer(t: unknown, validIds?: Set<string> | null): TicTimer | null {
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return null;
  const o = t as Record<string, unknown>;
  const rawTotal = o['totalSeconds'];
  if (typeof rawTotal !== 'number' || !Number.isFinite(rawTotal) || rawTotal <= 0) return null;
  const totalSeconds = clampTotal(rawTotal);

  let id = cleanId(o['id']);
  if (!id) id = genId();

  const rawName = o['name'];
  const name = (typeof rawName === 'string' ? rawName.trim().slice(0, MAX_TIMER_NAME) : '') || 'Untitled';

  const rawRem = o['remainingMs'];
  let remainingMs = typeof rawRem === 'number' && Number.isFinite(rawRem) && rawRem >= 0
    ? Math.floor(rawRem)
    : totalSeconds * 1000;
  if (remainingMs > totalSeconds * 1000) remainingMs = totalSeconds * 1000;

  const rawEnds = o['endsAt'];
  const endsAt = typeof rawEnds === 'number' && Number.isFinite(rawEnds) ? rawEnds : null;

  const rawStatus = o['status'];
  const status = typeof rawStatus === 'string' && (STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus as TicTimer['status']
    : 'idle';

  const accent = cleanAccent(o['accent']);

  const rawStyle = o['ringStyle'];
  const ringStyle = typeof rawStyle === 'string' && (RING_STYLES as readonly string[]).includes(rawStyle)
    ? rawStyle as TicTimer['ringStyle']
    : 'classic';

  const rawRing = o['ring'];
  const ring = typeof rawRing === 'string' && (RING_IDS as readonly string[]).includes(rawRing)
    ? rawRing as TicTimer['ring']
    : 'soft';

  const tags = parseTags(o['tags']);

  const rawCreated = o['createdAt'];
  const createdAt = typeof rawCreated === 'number' && Number.isFinite(rawCreated) ? rawCreated : Date.now();

  const ticket = parseTicket(o['ticket']);

  const rawPrio = o['priority'];
  const priority = rawPrio === 'urgent' ? 'urgent' : 'routine';

  let nextId = cleanId(o['nextId'] ?? null);
  if (nextId === id) nextId = null;
  else if (nextId && validIds && !validIds.has(nextId)) nextId = null;
  let linkId = cleanId(o['linkId'] ?? null);
  if (linkId === id) linkId = null;
  else if (linkId && validIds && !validIds.has(linkId)) linkId = null;

  return {
    id, name, totalSeconds, remainingMs, endsAt, status, accent,
    ringStyle, ring, tags, nextId, createdAt, ticket, priority, linkId,
  };
}

export function sanitizeBox(b: unknown, validIds?: Set<string> | null): TicBox | null {
  if (typeof b !== 'object' || b === null || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  const rawTitle = o['title'];
  if (typeof rawTitle !== 'string') return null;
  const title = rawTitle.trim().slice(0, 120) || 'Untitled';

  let id = cleanId(o['id']);
  if (!id) id = genId();

  const rawBody = o['body'];
  const body = typeof rawBody === 'string' ? rawBody : '';
  const tags = parseTags(o['tags']);
  const accent = cleanAccent(o['accent']);
  const done = o['done'] === true;
  const pinned = o['pinned'] === true;

  const rawCreated = o['createdAt'];
  const createdAt = typeof rawCreated === 'number' && Number.isFinite(rawCreated) ? rawCreated : Date.now();
  const rawOrder = o['order'];
  const order = typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : createdAt;

  const ticket = parseTicket(o['ticket']);
  const rawPrio = o['priority'];
  const priority = rawPrio === 'urgent' ? 'urgent' : 'routine';

  let linkId = cleanId(o['linkId'] ?? null);
  if (linkId === id) linkId = null;
  else if (linkId && validIds && !validIds.has(linkId)) linkId = null;

  return {
    id, title, body, tags, accent, done, pinned, order, createdAt, ticket, priority, linkId,
  };
}
