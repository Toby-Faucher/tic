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

export function handoverMarkdown(
  timers: HandoverTimer[],
  boxes: HandoverBox[],
  shiftLabel = '',
): string {
  const lines: string[] = [];
  const stamp = new Date().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  lines.push(`# NOC handover — ${stamp}${shiftLabel ? ` (${shiftLabel})` : ''}`);
  lines.push('');

  const open = boxes.filter((b) => !b.done);
  const done = boxes.filter((b) => b.done);
  const activeTimers = timers.filter((t) => t.status === 'running' || t.status === 'paused');

  lines.push(`## Open follow-ups (${open.length})`);
  if (!open.length) lines.push('- none — queue clean');
  for (const b of open) {
    const t = b.ticket ? ` [${b.ticket}]` : '';
    const p = b.priority === 'urgent' ? ' (!)' : '';
    const tags = b.tags.length ? ` #${b.tags.join(' #')}` : '';
    const extra = b.body ? ` — ${b.body.split('\n')[0].slice(0, 120)}` : '';
    lines.push(`- [ ]${p} ${b.title}${t}${extra}${tags}`);
  }
  lines.push('');

  if (activeTimers.length) {
    lines.push(`## Active timers (${activeTimers.length})`);
    for (const t of activeTimers) {
      const ticket = t.ticket ? ` [${t.ticket}]` : '';
      lines.push(`- ${t.name}${ticket} (${t.status})`);
    }
    lines.push('');
  }

  lines.push(`## Done this shift (${done.length})`);
  if (!done.length) lines.push('- none logged');
  for (const b of done.slice(0, 20)) {
    const t = b.ticket ? ` [${b.ticket}]` : '';
    lines.push(`- [x] ${b.title}${t}`);
  }
  lines.push('');
  lines.push('_from tic (local-only)_');
  return lines.join('\n');
}
