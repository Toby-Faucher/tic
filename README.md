# tic — quiet local-only timers + tasks for NOC follow-ups

`tic` is a static, local-only web app for NOC / on-call follow-ups: countdown **timers** with SVG progress rings + checkable **boxes** (tasks/notes), NOC quick-actions, shift-goal tracking, and one-click shift handover. No backend, no auth, no account — all state is `localStorage`, all sound is WebAudio synth, background is WebGPU shaders with a raw-WebGL fallback.

> Stack: Astro 7 (`output: 'static'`) + Bun + Tailwind CSS v4 + vanilla TypeScript. See `package.json`, `astro.config.mjs`.

## Features

- **Timers** (`src/scripts/app.ts`): CRUD, start / pause / resume / reset / restart, `requestAnimationFrame` countdown loop derived from `Date.now()` `endsAt` timestamps, SVG progress rings (thin / classic / bold stroke), per-timer accent + ring sound, tags + tag filters, ticket # + routine / urgent priority, chained `nextId` auto-start (“Next up — auto-starts when this finishes”).
- **Boxes** (`src/scripts/boxes.ts`): CRUD, pin / done / drag-drop reorder (HTML5 DnD, `order` persisted), tag filters, ticket # + priority, accent color, linked timer ↔ box (`linkId`, “linked task” / “timer up — do it” states, warm background tint).
- **NOC quick-action bar**: ticket input + one-click templates that create a linked timer + box pair, auto-started.
- **Shift goal** (`src/scripts/goal.ts`): freeform textarea, debounced autosave, per-day label, clear button. Included in handover.
- **Handover**: one click builds Markdown (goal + open + active timers + done) and copies to clipboard, with `.md` download fallback when clipboard is blocked.
- **Backup / restore**: versioned JSON export (`tic-backup-YYYY-MM-DD.json`) + validated import.
- **Sounds** (`src/scripts/sounds.ts`): 9 synth timer rings, looping done-alarm (replace-newest, urgent vs routine gaps), 4 box tick sounds. All WebAudio, no audio files.
- **Theming**: persisted dark / light mode + per-theme primary color (grey light / bone dark defaults), preset swatches + native color wheels, live `var(--color-ink)` override, tick-sound picker, preview panel.
- **Backgrounds + micro-interactions**: WebGPU `Fog` + `FilmGrain` ambient shader (`src/scripts/fluid.ts`, urgency warm-tint via `MutationObserver`), cursor-tracked card glow + press ripples + optional GPU sheens (`src/scripts/fx.ts`). `prefers-reduced-motion` respected throughout.
- **Tab chrome**: live countdown in `document.title` + progress-ring favicon repaint (≤1/sec, idle costs nothing). `Notification` + `navigator.vibrate(200)` on finish.

## Quickstart

Requires [Bun](https://bun.com).

```bash
bun install
bun run dev      # astro dev — local dev server
bun run build    # astro build — static output to dist/
bun run preview  # astro preview — serve the built site
```

No `.env`, no database, no server code. `Bun.serve()` / backend patterns do not apply — the built `dist/` is static HTML/CSS/JS.

## Project structure

| Path | What it is |
|---|---|
| `astro.config.mjs` | Astro `output: 'static'` + Tailwind v4 Vite plugin |
| `package.json` | `astro ^7.3.2`, `shaders ^3.2.467`, Tailwind v4, `typescript ^5`, `@types/bun`; scripts `dev` / `build` / `preview` |
| `src/pages/index.astro` | Entire UI: anti-flash head snippet + favicon, header (count, settings/theme/fab buttons), goal section, tabs, NOC bar, timer/box views + filters + grids, footer (handover/export/import), 3 modal overlays (timer, box, settings), module init script |
| `src/styles/global.css` | Tailwind import, `@theme` tokens (cream paper, ink primary), all `t-*` component classes, card animations, fx layer, dark-mode overrides |
| `src/scripts/app.ts` | Timers: CRUD, rAF countdown loop, SVG progress rings, done-alarm wiring, timer modal form, favicon/title chrome, `ACCENTS` map |
| `src/scripts/boxes.ts` | Boxes: CRUD, pin/done/drag-drop ordering, box modal, tab switching, keyboard shortcuts (`1`/`2`/`n`/space), backup export/import + validation, NOC quick-action bar, handover-to-clipboard |
| `src/scripts/sounds.ts` | WebAudio synth: 9 timer `RINGS`, looping done-alarm (replace-newest, urgent vs routine gaps), 4 box `TICK` sounds + storage |
| `src/scripts/theme.ts` | Persisted dark/light mode, `tic:theme` event bus |
| `src/scripts/settings.ts` | Per-theme primaries (grey light / bone dark), preset swatches + color wheels, tick picker, settings modal wiring |
| `src/scripts/goal.ts` | Shift-goal textarea, autosave, handover getter |
| `src/scripts/noc.ts` | NOC templates + `handoverMarkdown` builder |
| `src/scripts/fluid.ts` | Background shader (WebGPU Fog + raw-WebGL fallback), urgency warm-tint via `MutationObserver`, theme tracking |
| `src/scripts/fx.ts` | Press ripples, cursor-tracked card glow, GPU sheens |

Init order (`src/pages/index.astro` module script): `initTheme()` → `initSettings()` → `initGoal()` → `init()` (timers) → `initBoxes()` → `initFluid()` → `initFx()`.

## Data model + storage keys

### `TicTimer` (`tic.timers.v1`)

```ts
// src/scripts/app.ts
interface TicTimer {
  id: string;            // uid()
  name: string;          // default 'Untitled', maxlength 40 in form
  totalSeconds: number;  // clamped 1s…99h, floor 60s when ≤0 in form
  remainingMs: number;
  endsAt: number | null; // Date.now() timestamp when running
  status: 'idle' | 'running' | 'paused' | 'done';
  accent: string;        // 'blue' (= live primary) | ACCENTS key | '#rrggbb'
  ringStyle: 'thin' | 'classic' | 'bold'; // stroke 5 / 9 / 13
  ring: RingId;          // one of 9 RINGS, default 'soft'
  tags: string[];        // lowercased, #-stripped, spaces→-, max 5
  nextId: string | null; // chained auto-start timer
  createdAt: number;
  ticket: string;        // max 40 chars
  priority: 'routine' | 'urgent';
  linkId: string | null; // linked box id
}
```

Seed (first run / empty / corrupt): `Callback user` 30m urgent orange + `Recheck ticket` 1h routine blue. Reload reconciles running timers from `endsAt - Date.now()` (expired → `done`).

### `TicBox` (`tic.boxes.v1`)

```ts
// src/scripts/boxes.ts
interface TicBox {
  id: string;
  title: string;         // default 'Untitled', maxlength 60
  body: string;          // freeform, preserves newlines
  tags: string[];        // same normalization as timers, max 5
  accent: string;        // same 'blue'-tracks-primary rule
  done: boolean;
  pinned: boolean;
  order: number;         // drag-drop position (falls back to createdAt)
  createdAt: number;
  ticket: string;        // max 40 chars
  priority: 'routine' | 'urgent';
  linkId: string | null; // linked timer id
}
```

Sort: open pinned → open urgent → open routine → done, then `order`. Urgent open boxes show `!` badge; a box whose linked timer is `done` gets `data-need="true"` (“timer up — do it”) + warm card style.

### Goal (`tic.goal.v1`)

```json
{ "date": "YYYY-MM-DD", "text": "…" }
```

Persists until cleared (no midnight auto-wipe for night shifts). Label shows the write date (`Mon, Sep 8` style); autosaves 400ms debounced; textarea auto-grows.

### Storage keys + events

| Key | Value | Writer |
|---|---|---|
| `tic.theme` | `'dark'` \| `'light'` (absent → `prefers-color-scheme`) | `src/scripts/theme.ts` |
| `tic.primary` | light-mode `#rrggbb` (default `#444444` grey; legacy single key, kept) | `src/scripts/settings.ts` |
| `tic.primary.dark` | dark-mode `#rrggbb` (default `#f2ede1` bone) | `src/scripts/settings.ts` |
| `tic.timers.v1` | `TicTimer[]` (autosaved on every mutation + every ~5s while running + every 10s interval) | `src/scripts/app.ts` |
| `tic.boxes.v1` | `TicBox[]` | `src/scripts/boxes.ts` |
| `tic.tick` | `'pop'` \| `'pluck'` \| `'ding'` \| `'thock'` (default `'pop'`) | `src/scripts/sounds.ts` |
| `tic.goal.v1` | `{ date, text }` | `src/scripts/goal.ts` |

| Event | Payload | Dispatch → listen |
|---|---|---|
| `tic:theme` | `'dark'` \| `'light'` | `theme.ts` → `settings.ts` (`applyActivePrimary`), `fluid.ts` (fog + fallback palette), `fx.ts` via primary |
| `tic:primary` | hex string | `settings.ts` → `app.ts` / `boxes.ts` (color-wheel sync; cards need no re-render — `blue` binds `var(--color-ink)` live) |

## Keyboard shortcuts

Footer hint: `n new · 1/2 tabs · space start`.

| Key | Action | Guard |
|---|---|---|
| `1` | Show timers tab | No modal open, not typing, no meta/ctrl/alt |
| `2` | Show boxes tab | Same |
| `n` | New timer (timers view) / new box (boxes view) | Same; `preventDefault` |
| `space` | Start/pause first running timer, else first non-done visible timer — or tick first open box in boxes view | Same + skips when a `<button>` is focused (native space already fires) |
| `Esc` | Close timer / box / settings overlay (whichever open) | Any |
| `Enter` | Save timer form / box form when its overlay is open (box form skips when focus is in body textarea) | Not on a `<button>` |

Plus: click overlay backdrop to close, `+ new timer/box` header FAB follows the active tab, HTML5 drag-drop to reorder boxes (order persists on `dragend`).

## Sounds inventory

All synthesized with `OscillatorNode` + exponential gain envelopes — no audio assets. `AudioContext` is lazy (`ac()` resumes on every cycle); if it starts suspended (finish while hidden / pre-gesture), the first `pointerdown`/`keydown` calls `resumeAlarm()` so the alarm becomes audible without waiting for the next interval tick.

### Timer rings (`RINGS`, `src/scripts/sounds.ts`)

| Id | Name | Character |
|---|---|---|
| `chime` | Chime | Bright two-tone |
| `bell` | Bell | Warm decaying bell (triangle + sine stack) |
| `pulse` | Pulse | Triple digital beep (square) |
| `soft` | Soft | Gentle airy tone — **form + NOC default** |
| `radar` | Radar | Sweeping alert (sine slide 600→1200Hz) |
| `harp` | Harp | Rising gentle arpeggio (4 notes) |
| `cuckoo` | Cuckoo | Low two-note call |
| `marimba` | Marimba | Warm wooden motif (triangle) |
| `sparkle` | Sparkle | Bright falling shimmer (4 notes) |

Picker (`#rings` in timer modal) previews on select (`previewRing`) and has a `♪` per-row preview button. The looping done-alarm (`startAlarm`, replace-newest) spaces urgent repeats 1.1s apart (`ALARM_STEP_MS`).

### Box ticks (`TICKS`, default `'pop'`)

| Id | Name | Character |
|---|---|---|
| `pop` | Pop | Snappy sine drop + click — default |
| `pluck` | Pluck | Bright kalimba pluck |
| `ding` | Ding | Tiny high bell |
| `thock` | Thock | Soft wooden knock |

Picked in Settings (`#tickSounds`, `♪` preview per row), stored as `tic.tick`, played on box tick-off with a `pop` card animation.

### Done-alarm (looping, `startAlarm` / `stopAlarm` / `resumeAlarm`)

- **Replace-newest**: one alarm at a time; a newer finish steals the speaker. The replaced card still shows `done`, it just loses sound ownership (`ringingId` in `app.ts`).
- **Urgent**: triple-pattern burst (3× 1.1s apart) every `4200ms`.
- **Routine**: single pattern at `0.55` volume every `5200ms`.
- **Dismiss**: toggle / reset / delete / edit that ringing card, or `pagehide`; import (`setTimersState`) silences all. There is no global mute — the done card’s restart/reset/delete buttons are the silence affordance.

## Theming / primary system

- `tic.theme` (`src/scripts/theme.ts`): `dark`/`light`, `data-theme` on `<html>`, `☾ dark` / `☀ light` toggle with `aria-pressed`, follows OS until an explicit choice is stored.
- Anti-flash: inline head snippet in `src/pages/index.astro` reads `tic.theme` + per-theme primary and sets `data-theme` / `--color-ink` before first paint; modules re-assert on init.
- Per-theme primaries (`src/scripts/settings.ts`): light default `#444444` (grey), dark default `#f2ede1` (bone). Each mode keeps its own key (`tic.primary` / `tic.primary.dark`); switching theme auto-applies that mode’s primary. Only two preset swatches (`grey`, `bone`) + a native `<input type=color>` custom wheel per mode + `reset both`.
- Mechanism: overrides `--color-ink` (the Tailwind `@theme` token behind every `text-ink` / `bg-ink` / `border-ink` utility) as inline style on `<html>`; dispatches `tic:primary` so timer/box color wheels re-sync.
- Timer/box accents (`ACCENTS` in `app.ts`): `blue #1734d8`, `violet #6a3df0`, `green #0d8a3f`, `orange #d95300`, `pink #e01e50`, `graphite #555555`, plus custom `#rrggbb` wheel. **`blue` is special**: it binds `var(--color-ink)` live so existing blue cards re-tint instantly on primary change with no re-render; every other accent is fixed. NOC urgent pairs default to `orange`.
- Dark mode (`src/styles/global.css`): paper flips cream `#faf4e8` → charcoal `#1e1e1e` (not black); fluid canvas dims to `0.32` opacity; urgent signals go warm amber (`#ff9d5c`) to stay readable; `color-scheme: dark`.
- Base paper tokens: `--color-cream: #faf4e8`, `--font-serif` Iowan/Palatino/Georgia stack, dashed 2px borders, `border-radius: 0`.

## NOC workflow guide

1. Type the ticket (e.g. `INC1234`) into the NOC bar input (`#nocTicket`).
2. Hit a template button — a linked timer + box pair is created (ticket stamped on both, `linkId` cross-referenced both ways):

| Button | Timer | Box | Priority | Autostart |
|---|---|---|---|---|
| `Callback 30m` | `Callback user [TICKET]` 30m `callback` | `Call back user` | urgent | yes |
| `Recheck 1h` | `Recheck ticket [TICKET]` 60m `check` | `Recheck ticket / monitor` | routine | yes |
| `Monitor 15m` | `Monitor clear check [TICKET]` 15m `check` | `Verify monitor cleared` | routine | yes |
| `Vendor 2h` | `Chase vendor / escalation [TICKET]` 120m `waiting` | same title | routine | yes |
| `Handover note` | — (box only) | `Handover: open items + waiting` `handover` | routine | — |

3. Work the queue: running urgent timers and boxes whose linked timer hit `done` (“timer up — do it”, `data-need`) warm-tint the ambient background via `MutationObserver` (`fluid.ts` `watchUrgency`).
4. Optionally chain timers (`Next up` select in timer modal) — the next timer auto-starts on finish.
5. Set the shift goal at the top; it rides along into handover.
6. At shift end, `handover copy` in the footer → paste into chat/ticket. Example shape:

```md
# NOC handover — Sep 9, 06:12
## Shift goal
- keep queue clean
## Open follow-ups (2)
- [ ] (!) Call back user [INC1234] — confirm fix #callback
## Active timers (1)
- Recheck ticket [INC1235] (running)
## Done this shift (1)
- [x] Verify monitor cleared [INC1230]
_from tic (local-only)_
```

(Sections: `Shift goal` only if set; `Open follow-ups` with `(!)` + first-body-line + tags; `Active timers` only if running/paused; `Done this shift` capped at 20.)

## Backup / restore + handover docs

- **Export** (`export` footer button): downloads `tic-backup-YYYY-MM-DD.json`:
  ```json
  { "app": "tic", "version": 2, "exportedAt": "ISO", "timers": [], "boxes": [] }
  ```
  Note: theme / primaries / tick sound / goal are **not** in the backup — only timers + boxes.
- **Import** (`import` footer button → hidden file input): files over 1MB are refused before reading. Parses JSON, requires `timers` + `boxes` arrays; every row goes through strict per-row sanitization (`sanitizeTimer`/`sanitizeBox` in `validate.ts`: finite `totalSeconds > 0`, allowlisted `status`/`ring`/`ringStyle`/`accent`/`priority` with safe fallbacks, string-only `tags ≤ 5`, `endsAt` number-or-null, id regen on mismatch, self/dangling `nextId`/`linkId` dropped, duplicate ids deduped). Bad rows are skipped with a count (`bad file (N rows skipped)`); a file with zero surviving rows is rejected. Any alarm is silenced, both filters reset. Button flashes `done ✓` / `bad file…` for 1.6s and announces via the `role=status` region.
- **Handover** (`handover copy`): builds `handoverMarkdown(timers, boxes, '', goalText)` — open boxes, active timers, done boxes + goal + timestamp. `navigator.clipboard.writeText`, falling back to downloading `handover-YYYY-MM-DD.md` when clipboard is blocked. Button flashes `copied ✓` / `saved ✓` for 1.6s.

## Browser support

- Modern evergreen browsers (Chrome / Edge / Firefox / Safari). No polyfills, no build-time browser targets beyond Astro defaults.
- **WebGPU**: optional progressive enhancement. `shaders` lib (~2MB) is dynamically `import('shaders/js')`’d only when `'gpu' in navigator` + `isWebGPUSupported()`; otherwise the raw-WebGL `fbm` fallback (`startFallback`) runs, and with no WebGL at all the page is still fully usable on flat cream/charcoal.
- **Required web APIs**: `localStorage` (private-mode failures are caught — app keeps working for the session), `AudioContext` (no-audio catch paths), `requestAnimationFrame`, `matchMedia`, `MutationObserver`, `CustomEvent`.
- **Degraded-graceful**: `Notification` (asked only on finish, silent skip if unsupported/denied), `navigator.clipboard` (→ file download fallback), `navigator.vibrate` (optional-chained), `fetch`-free (no network calls from app code).
- **Motion**: `prefers-reduced-motion` skips the `shaders` download entirely (~683KB gzip saved) and runs the static WebGL fallback / flat paper instead; sheens/ripples/card-glow animation stay off; timer ring jumps instead of lerping; OS setting changes are followed live.

## Privacy

100% local. Timers, boxes, goal, theme, primaries, and tick choice live only in your browser’s `localStorage` under `tic.*` keys — there is no server, no account, no telemetry (`disableTelemetry: true` on shader init), no analytics, no cookies. Export/handover files are generated client-side via `Blob` URLs and never uploaded. Clearing site data wipes everything — keep a `tic-backup-*.json` if it matters.

## Contributing

- Prereqs: Bun. `bun install`, `bun run dev`. Keep it vanilla TS — no UI framework, no state library, no CSS-in-JS (one `global.css` with `t-*` component classes; one-off utilities inline).
- Conventions: `localStorage` keys namespaced `tic.*` with try/catch private-mode fallbacks; cross-module signals via `tic:theme` / `tic:primary` `CustomEvent`s (see `theme.ts` / `settings.ts`); timer accents named `blue` must keep tracking `var(--color-ink)` (see `accentColor` + card `--accent` binding in `app.ts` / `boxes.ts`).
- Sounds: add rings to `RINGS` + `playPattern` in `sounds.ts` (keep them short/quiet — NOC-quiet philosophy); ticks to `TICKS` similarly.
- NOC templates: edit `NOC_TEMPLATES` in `noc.ts`; handover shape lives in `handoverMarkdown` — keep the `Open / Active / Done` section contract (handover consumers parse it).
- Backgrounds: `fluid.ts` owns the `#fluid` canvas, `fx.ts` owns `.fx` / `.fx-gpu` layers — both lazy-load `shaders/js` only when WebGPU exists and must no-op cleanly without it.

## Performance notes (measured Sep 2026 fix pass)

Bundle (`bun run build`, static `dist/`):

| Asset | Before | After | Δ |
|---|---|---|---|
| Main JS (raw / gzip) | 49,370 / 15,476 | 62,140 / 19,361 | +26% (+3.9KB gzip, headroom to 25KB budget) |
| CSS (raw / gzip) | 36,561 / 6,956 | 39,704 / 7,427 | +8% (a11y section + focus rings) |
| `shaders` chunk (raw / gzip) | 2,459,334 / 683,044 | unchanged | still dynamic-only, never preloaded |
| `index.html` (raw / gzip) | 11,201 / — | 27,073 / 7,194 | +16KB raw inline a11y bridge (no extra request) |
| Build time | ~2.5s | ~2.5s | flat |

Runtime behavior (code-verified):

| Hot path | Before | After | Effect |
|---|---|---|---|
| Timer tick loop | rAF 60Hz, full find + paint + chrome per frame | `setTimeout` ~4Hz, `Date.now()` math, hidden early-exit | ~15× fewer style/text writes while running; zero idle/hidden |
| Hidden-tab dues | never fired until refocus | `setTimeout` watchdog, re-armed on visibilitychange | correctness fix (was the core timer promise) |
| Favicon encode | `toDataURL()` + href swap every second | title 1Hz; favicon on 5%-step change AND ≥5s gate, cached | ~5× fewer canvas paints, O(1) cache hits |
| GPU sheen contexts | up to 9 (fab + 8 play buttons) | 1 (fab only) | −8 contexts/canvases/compositors |
| Render-storm observer | teardown + recreate all sheens per grid render | deleted (fab is static) | 0 fires |
| Fallback-GL background | DPR ≤1.5 fullscreen 4-octave fbm @60fps + per-frame layout read | DPR ≤1.0 @~30fps, cached dims, debounced resize | ~4× fewer shaded px/s, 0 per-frame reads |
| NOC pair click | 4 saves + 4 renders | 1 box save/render + 1 timer save/render | −6 full grid rebuilds per click |
| Box tick-off | full grid render + forced reflow + double animation | in-place `dataset.done` flip | 0 renders |
| Periodic saves | racy `now%5000` + 10s `setInterval` even idle/hidden | dirty-flag flush ≤1/5s, hidden-skipped | ~no writes when idle |
| Box drag | rect-per-card per `dragover` event | rAF-coalesced + cached midlines | no pointer-rate thrash |
| Reduced-motion download | always fetched 683KB-gzip shaders for a frozen frame | import skipped | ~683KB gzip saved for those users |
