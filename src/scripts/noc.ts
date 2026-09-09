export type NocPriority = 'routine' | 'urgent';

export interface NocTemplate {
  id: string;
  label: string;
  hint: string;
  minutes: number;
  tags: string[];
  priority: NocPriority;
  timerName: string;
  boxTitle: string;
  makeBox: boolean;
  startTimer: boolean;
}

export const NOC_TEMPLATES: NocTemplate[] = [
  {
    id: 'callback-30',
    label: 'Callback 30m',
    hint: 'call user back',
    minutes: 30,
    tags: ['callback'],
    priority: 'urgent',
    timerName: 'Callback user',
    boxTitle: 'Call back user',
    makeBox: true,
    startTimer: true,
  },
  {
    id: 'recheck-60',
    label: 'Recheck 1h',
    hint: 'verify ticket still clean',
    minutes: 60,
    tags: ['check'],
    priority: 'routine',
    timerName: 'Recheck ticket',
    boxTitle: 'Recheck ticket / monitor',
    makeBox: true,
    startTimer: true,
  },
  {
    id: 'monitor-15',
    label: 'Monitor 15m',
    hint: 'alert clear check',
    minutes: 15,
    tags: ['check'],
    priority: 'routine',
    timerName: 'Monitor clear check',
    boxTitle: 'Verify monitor cleared',
    makeBox: true,
    startTimer: true,
  },
  {
    id: 'vendor-120',
    label: 'Vendor 2h',
    hint: 'chase escalation',
    minutes: 120,
    tags: ['waiting'],
    priority: 'routine',
    timerName: 'Chase vendor / escalation',
    boxTitle: 'Chase vendor / escalation',
    makeBox: true,
    startTimer: true,
  },
  {
    id: 'handover-wrap',
    label: 'Handover note',
    hint: 'end-of-shift wrap',
    minutes: 0,
    tags: ['handover'],
    priority: 'routine',
    timerName: '',
    boxTitle: 'Handover: open items + waiting',
    makeBox: true,
    startTimer: false,
  },
];

export interface HandoverTimer {
  name: string;
  ticket?: string;
  status: string;
  tags: string[];
  priority?: string;
}

export interface HandoverBox {
  title: string;
  body: string;
  ticket?: string;
  tags: string[];
  done: boolean;
  pinned: boolean;
  priority?: string;
}

// Cap for the "Done this shift" section — beyond this a "+N more" note is
// appended so the cap is never silent.
export const MAX_HANDOVER_DONE = 20;

const HANDOVER_LINE_MAX = 120;

// Collapse hostile multi-line input to a single handover-safe line: strips
// CR/LF runs (blocks section forgery via "\n## …" / "\n- [ ] …" in titles,
// names, tickets, goal lines) then hard-caps length.
export function oneLine(s: string, max = HANDOVER_LINE_MAX): string {
  return s.replace(/[\r\n]+/g, ' ').slice(0, max);
}

export function handoverMarkdown(
  timers: HandoverTimer[],
  boxes: HandoverBox[],
  shiftLabel = '',
  goal = '',
): string {
  const lines: string[] = [];
  const stamp = new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const safeShift = oneLine(shiftLabel, 60).trim();
  lines.push(`# NOC handover — ${stamp}${safeShift ? ` (${safeShift})` : ''}`);
  lines.push('');

  const g = goal.trim();
  if (g) {
    lines.push(`## Shift goal`);
    for (const gl of g.split('\n').map((s) => s.trim()).filter(Boolean)) lines.push(`- ${oneLine(gl)}`);
    lines.push('');
  }

  const open = boxes.filter((b) => !b.done);
  const done = boxes.filter((b) => b.done);
  // Idle timers intentionally omitted: handover covers only active
  // (running/paused) timers — the idle pool is shift-irrelevant and would
  // bury the follow-ups that need action.
  const activeTimers = timers.filter((t) => t.status === 'running' || t.status === 'paused');

  lines.push(`## Open follow-ups (${open.length})`);
  if (!open.length) lines.push('- none — queue clean');
  for (const b of open) {
    const title = oneLine(b.title);
    const t = b.ticket ? ` [${oneLine(b.ticket, 40)}]` : '';
    const p = b.priority === 'urgent' ? ' (!)' : '';
    const tags = b.tags.length ? ` #${b.tags.map((x) => oneLine(x, 40)).join(' #')}` : '';
    const extra = b.body ? ` — ${oneLine(b.body.split('\n')[0].trim())}` : '';
    lines.push(`- [ ]${p} ${title}${t}${extra}${tags}`);
  }
  lines.push('');

  if (activeTimers.length) {
    lines.push(`## Active timers (${activeTimers.length})`);
    for (const t of activeTimers) {
      const name = oneLine(t.name);
      const ticket = t.ticket ? ` [${oneLine(t.ticket, 40)}]` : '';
      lines.push(`- ${name}${ticket} (${t.status})`);
    }
    lines.push('');
  }

  lines.push(`## Done this shift (${done.length})`);
  if (!done.length) lines.push('- none logged');
  for (const b of done.slice(0, MAX_HANDOVER_DONE)) {
    const t = b.ticket ? ` [${oneLine(b.ticket, 40)}]` : '';
    lines.push(`- [x] ${oneLine(b.title)}${t}`);
  }
  if (done.length > MAX_HANDOVER_DONE) lines.push(`- … +${done.length - MAX_HANDOVER_DONE} more`);
  lines.push('');
  lines.push('_from tic (local-only)_');
  return lines.join('\n');
}
