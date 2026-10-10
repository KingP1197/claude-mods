// Desktop version of ~/.claude/statusline-command.sh.
// Line 1: branch, 5-hour and 7-day rate limits, context used, cache warm or cold; Side question, Compact and Handoff buttons at its right end.
// Hovering the cache item shows when it goes cold and a Keep warm button, or once cold, what the next message re-stores.
// Side question opens a panel that asks Claude over a copy of the chat, out of the main agent's sight.
// Line 2: context bar split by source, and a Details button.
// On desktop the bar is an SVG whose pieces show a tooltip on hover.
// Colors follow the terminal script: green under 50%, yellow under 80%, red above.
// Every hook lives in this file: the validator follows `$` only within one file.
import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  ModelUsage,
  On,
  Register,
  RenderSurface,
  SessionContextUsage,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'

import type { CacheSeen, Handoff, Line, Part, Side, SideTurn } from '../types'
import { KEEP_WARM_PROMPT, TICK_MS, TTL_SCRIPT, WARM_COLOR, cacheView, eastern, prefixOf, ttlFrom } from './cache'
import { COMPACT_PROMPT } from './compact'
import type { AskBoxPost, AskBoxProps } from './askbox'
import { ASK_BOX, NO_SIDE, SIDE_PANE, forkFailure, sideOf, sidePrompt } from './side'
import { CAP, FIRST_LINE, HANDOFF_PROMPT, IDLE, TOOL, TOOL_SPEC, estimateTokens, fail, ok, textOf } from './handoff'

// The validator reads state only through atoms declared in this file.
const line = atom({ plugin: 'desk-status', key: 'line' } as const, null)
const isOpen = atom({ plugin: 'desk-status', key: 'isOpen' } as const, false)
const now = atom({ plugin: 'desk-status', key: 'now' } as const, 0)
const handoff = atom({ plugin: 'desk-status', key: 'handoff' } as const, IDLE)
const isCompacting = atom({ plugin: 'desk-status', key: 'isCompacting' } as const, false)
const side = atom({ plugin: 'desk-status', key: 'side' } as const, NO_SIDE)
const cache = atom({ plugin: 'desk-status', key: 'cache' } as const, null as CacheSeen | null)

// One color per source, biggest first. Readable on dark and light.
// Neighbors sit far apart in hue, so the two biggest sources (side by side in the bar) never look alike.
const PALETTE = ['#7aa2f7', '#ff9e64', '#9ece6a', '#f7768e', '#bb9af7', '#e0af68', '#7dcfff', '#c0caf5']
// Free space: solid grey.
const FREE = '#4b5563'
// Terminal bar length when the band's width is unknown.
const TEXT_BAR_CELLS = 40
// Cells kept clear on the terminal bar's line for the gap, the Details button and its marks.
const TEXT_BAR_RESERVE = 16
// Desktop bar height in CSS pixels. The picture sets it: a box can't be sized in pixels, and drew round corners.
// No width: the bar stretches to fill its row, so Details sits at the right edge.
const BAR_H = 9
// The bar is split into this many parts; a box's flexGrow may not pass 10000.
const BAR_PARTS = 10_000
// A source too small to see still takes this many parts (0.2%), so its hover card can be reached.
const MIN_PARTS = 20

// Higher used is worse, for context and both rate limits.
const level = (pct: number) => (pct >= 80 ? 'error' : pct >= 50 ? 'warning' : 'success')

const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

const pct = (n: number, of: number) => (of > 0 ? `${((n / of) * 100).toFixed(1)}%` : '0%')

const rate = (limits: readonly SessionRateLimit[], kind: string) =>
  limits.find((l) => l.kind === kind)?.percentUsed ?? null

// Only sources that occupy the window; free space and the compaction reserve are left out.
function partsOf(usage: SessionUsage): Part[] | null {
  const cats = usage.context.breakdown?.categories
  if (cats === undefined) return null
  return cats
    .filter((c) => c.kind === 'used' && c.tokens > 0)
    .map((c) => ({ name: c.name, tokens: c.tokens }))
    .sort((a, b) => b.tokens - a.tokens)
}

async function branchOf($: EngineInterface): Promise<string | null> {
  try {
    const cwd = await $.session.cwd()
    const r = await $.process.run(['git', '-C', cwd, '--no-optional-locks', 'branch', '--show-current'], {
      timeoutMs: 3000,
    })
    const name = r.stdout.trim()
    return r.exitCode === 0 && name !== '' ? name : null
  } catch {
    return null
  }
}

// While Details is open, the token-count service's figures; otherwise a free local estimate.
// Assumed: one exact usage call per turn while Details stays open is an acceptable cost.
async function refresh(
  $: EngineInterface,
  opts: { figures?: { context: SessionContextUsage; rateLimits: readonly SessionRateLimit[] } } = {},
) {
  const isExact = await read($, isOpen)
  const [usage, branch] = await Promise.all([$.session.usage({ breakdown: isExact ? 'full' : 'summary' }), branchOf($)])
  const figures = opts.figures ?? usage
  await update($, line, () => ({
    branch,
    ctxUsed: figures.context.tokens ?? null,
    ctxWindow: figures.context.window,
    ctxPercent: figures.context.percent ?? null,
    rate5: rate(figures.rateLimits, 'five_hour'),
    rate7: rate(figures.rateLimits, 'seven_day'),
    parts: partsOf(usage),
    isExact,
  }))
}

type BarPiece = { grow: number; color: string; label: string }

// The desktop bar's pieces: one per source, then free space, each sized in parts of BAR_PARTS.
// The picture and the hover boxes over it are both drawn from these, so they line up.
function barPieces(parts: Part[], window: number): BarPiece[] {
  const raw = parts.map((p) => Math.max(window > 0 ? (p.tokens * BAR_PARTS) / window : 0, MIN_PARTS))
  // Floors on a nearly full window, or a source bigger than the window, can overrun the bar.
  // Shrink every piece alike so the hover boxes still sit over their colors, and none passes 10000.
  const rawSum = raw.reduce((s, g) => s + g, 0)
  const scale = rawSum > BAR_PARTS ? BAR_PARTS / rawSum : 1
  const pieces = parts.map((p, i) => ({
    grow: (raw[i] ?? 0) * scale,
    color: PALETTE[i % PALETTE.length] ?? FREE,
    label: `${p.name}: ${short(p.tokens)} (${pct(p.tokens, window)})`,
  }))
  const taken = pieces.reduce((s, p) => s + p.grow, 0)
  const free = Math.max(0, window - parts.reduce((s, p) => s + p.tokens, 0))
  return [...pieces, { grow: Math.max(0, BAR_PARTS - taken), color: FREE, label: `Free: ${short(free)}` }]
}

// The bar's picture: square-ended rects, drawn as a plain image.
// Not interactive: a picture in a hover frame flickered on every repaint, so hover lives in boxes laid over it.
function barSvg(pieces: BarPiece[]): string {
  let x = 0
  const rects = pieces.map((p) => {
    const r = `<rect x="${x.toFixed(1)}" y="0" width="${p.grow.toFixed(1)}" height="${BAR_H}" fill="${p.color}"/>`
    x += p.grow
    return r
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${BAR_H}" viewBox="0 0 ${BAR_PARTS} ${BAR_H}" preserveAspectRatio="none" style="display:block">` +
    `${rects.join('')}</svg>`
  )
}

// The terminal bar: one colored run of cells per source, then dim free cells.
function textBar(parts: Part[], window: number, total: number): { cells: string; color: string }[] {
  const runs: { cells: string; color: string }[] = []
  let left = total
  parts.forEach((p, i) => {
    const n = Math.min(left, Math.max(1, Math.round((p.tokens / window) * total)))
    if (n > 0) runs.push({ cells: '█'.repeat(n), color: PALETTE[i % PALETTE.length] ?? FREE })
    left -= n
  })
  if (left > 0) runs.push({ cells: '░'.repeat(left), color: FREE })
  return runs
}

// The one clock the band counts from. It only moves forward: a reply's send time can be older than it.
const advance = ($: EngineInterface, t: number) => update($, now, (n) => Math.max(n, t))

// The Handoff button's press: queue the request, or reset one that never finished.
async function startHandoff($: EngineInterface, surface: RenderSurface) {
  // Claimed inside one update, so two presses at once cannot both queue a request.
  const after = await update($, handoff, (h): Handoff => (h.phase === 'idle' ? { phase: 'queued', surface } : IDLE))
  if (after.phase === 'idle') {
    $.ui.toast('Handoff reset. Press Handoff again to write a new one.')
    return
  }
  const cancel = async () => {
    await update($, handoff, () => IDLE)
    $.ui.toast('The handoff request could not be sent.')
  }
  // Resolves when the handoff turn starts, which may wait for a running turn; the press does not wait for it.
  // A hook that refuses the prompt answers { drop } rather than failing the call.
  void $.prompt.submit({ text: HANDOFF_PROMPT }).then((r) => (r.drop === undefined ? undefined : cancel()), cancel)
}

const why = (err: unknown) => (err instanceof Error ? err.message : String(err))

// The Compact button's press: run `/compact <instructions>` as if the user typed it.
// Not $.session.compact: the desktop app runs the session headless, where that call is refused.
// The engine queues the command until the session is idle; its result shows in the transcript.
async function startCompact($: EngineInterface) {
  // Claimed inside one update, so two presses at once run one command. Set on every run of the change, so a retry decides afresh.
  let isClaimed = false
  await update($, isCompacting, (isBusy) => {
    isClaimed = !isBusy
    return true
  })
  if (!isClaimed) return
  try {
    await $.command.run({ command: 'compact', args: COMPACT_PROMPT })
  } catch (err) {
    $.ui.toast(`Could not compact (${why(err)}).`)
  } finally {
    await update($, isCompacting, () => false)
  }
}

// Reads the cache's lifetime from the transcript's last writes. A failed read keeps the last one known.
async function learnTtl($: EngineInterface, transcriptPath: string) {
  try {
    const r = await $.process.run(['/bin/sh', '-c', TTL_SCRIPT, 'sh', transcriptPath], { timeoutMs: 3000 })
    const ttlMs = ttlFrom(r.stdout)
    if (ttlMs !== null) await update($, cache, (c) => (c === null ? c : { ...c, ttlMs }))
  } catch {
    // The item falls back to the shorter lifetime.
  }
}

// The Keep warm press: a tiny prompt, whose request reads the whole cache and restarts its clock.
async function keepWarm($: EngineInterface) {
  const c = await read($, cache)
  const t = await $.clock.now()
  if (c !== null && t - c.sentAt < 60_000) {
    $.ui.toast('The cache was refreshed under a minute ago.')
    return
  }
  void $.prompt.submit({ text: KEEP_WARM_PROMPT }).then(
    (r) => (r.drop === undefined ? undefined : $.ui.toast('The keep-warm message was refused.')),
    () => $.ui.toast('The keep-warm message could not be sent.'),
  )
}

// Saved state outlives a reload, so a value an older version saved can lack newer fields or hold old turns.
// Every read and write of the side panel's state goes through these two, which bring it up to date.
const readSide = async ($: EngineInterface): Promise<Side> => sideOf(await read($, side))
const updateSide = ($: EngineInterface, fn: (s: Side) => Side) => update($, side, (s) => fn(sideOf(s)))

// The Side question button's press: open the panel with the keyboard in it.
async function openSide($: EngineInterface) {
  const r = await $.ui.open({ id: SIDE_PANE, title: 'Side questions', focus: true })
  if (!r.isPlaced) $.ui.toast(`Could not open the side panel (${r.reason}).`)
}

// Enter in the panel: one tool-less request over a copy of the main chat, earlier side turns included.
// The main agent never sees it, and nothing is added to the main chat.
async function askSide($: EngineInterface, text: string) {
  const question = text.trim()
  if (question === '') return
  // Claimed inside one update, so two asks at once send one fork. `at` and `earlier` come from the same
  // state the claim saw; both are set on every run of the change, so a retry decides afresh.
  let at = -1
  let earlier: SideTurn[] = []
  await updateSide($, (s) => {
    if (s.isAsking) {
      at = -1
      return s
    }
    at = s.turns.length
    earlier = s.turns
    return {
      ...s,
      draft: '',
      draftSeq: s.draftSeq + 1,
      isAsking: true,
      turns: [...s.turns, { question, state: 'pending' }],
    }
  })
  if (at < 0) {
    $.ui.toast('Still busy with the last side question.')
    return
  }
  let settled: SideTurn
  try {
    const r = await $.model.fork({ prompt: sidePrompt(earlier, question) })
    settled = r.isAnswered
      ? { question, state: 'answered', answer: r.text }
      : { question, state: 'failed', failure: forkFailure(r) }
  } catch (err) {
    settled = { question, state: 'failed', failure: `No answer (${why(err)}).` }
  }
  await updateSide($, (s) => ({
    ...s,
    isAsking: false,
    turns: s.turns.map((t, i) => (i === at ? settled : t)),
  }))
}

// A main-thread model request ended: it restarts the cache's clock.
async function noteCache($: EngineInterface, sentAt: number, usage: ModelUsage) {
  try {
    const prefix = prefixOf(usage)
    await update($, cache, (c) => ({ sentAt, prefix, ttlMs: c?.ttlMs ?? null }))
    await advance($, sentAt)
  } catch {
    // The item keeps its last reading.
  }
}

// The handoff turn ended without a copy: free the button and say so.
async function handoffTurnEnded($: EngineInterface) {
  if ((await read($, handoff)).phase !== 'writing') return
  await update($, handoff, () => IDLE)
  $.ui.toast('The handoff was not copied. Press Handoff to try again.')
}

// The save_handoff tool: copy the handoff to the clipboard, or say why not.
async function saveHandoff($: EngineInterface, raw: unknown) {
  const text = textOf(raw)
  if (text === '') return fail('No handoff text arrived. Call save_handoff with the whole handoff as `text`.')

  const tokens = estimateTokens(text)
  if (tokens > CAP) {
    return fail(
      `Too long: about ${tokens} tokens, and the cap is ${CAP}. Cut about ${tokens - CAP} tokens and call save_handoff again.`,
    )
  }

  const request = await read($, handoff)
  const copied = await $.ui.copy(request.phase === 'idle' ? { text } : { text, surface: request.surface })
  await update($, handoff, () => IDLE)
  if (!copied.isCopied) {
    $.ui.toast(`The handoff could not be copied (${copied.reason}).`)
    return fail(
      `The clipboard refused it (${copied.reason}). Tell the user, and put the handoff in your reply so they can copy it themselves.`,
    )
  }
  $.ui.toast(`Handoff copied to your clipboard, about ${tokens} tokens.`)
  return ok(`Copied to the user's clipboard, about ${tokens} tokens. Reply with one line saying so.`)
}

// Every value the band draws, and where it is drawn.
type Band = {
  figures: Line
  isOpen: boolean
  handoff: Handoff
  isCompacting: boolean
  cache: CacheSeen | null
  t: number
  surface: RenderSurface
  bodyColumns: number
}

// A card under its parent, shown only while the pointer is over the parent. Unkeyed: the engine refused a keyed one.
function hoverCard(els: ElementTable, body: JSX.Element[]) {
  const { Box } = els
  return (
    <Box
      flexDirection="column"
      position="absolute"
      top={1}
      left={0}
      display="none"
      hover={{ display: 'flex' }}
      borderStyle="round"
      paddingX={1}
    >
      {body}
    </Box>
  )
}

function sep(els: ElementTable, k: string) {
  const { Text } = els
  return (
    <Text key={k} color="subtle">
      {' | '}
    </Text>
  )
}

function na(els: ElementTable, k: string, label: string) {
  const { Text } = els
  return (
    <Text key={k} color="subtle">
      {label}
    </Text>
  )
}

// A figure in bold, or a dim stand-in when it is missing.
function stat(
  els: ElementTable,
  k: string,
  missing: string,
  text: string | null,
  color: ReturnType<typeof level> | 'suggestion',
) {
  const { Text } = els
  if (text === null) return na(els, k, missing)
  return (
    <Text key={k} color={color} bold>
      {text}
    </Text>
  )
}

const rateStat = (els: ElementTable, k: string, label: string, used: number | null) =>
  stat(els, k, `${label} n/a`, used === null ? null : `${label} ${Math.round(used)}%`, level(used ?? 0))

function ctxLabel(els: ElementTable, f: Line) {
  const { Text } = els
  if (f.ctxUsed === null || f.ctxPercent === null) return na(els, 'ctx', `0/${short(f.ctxWindow)} ctx`)
  return (
    <Text key="ctx" color={level(f.ctxPercent)} bold>
      {`${short(f.ctxUsed)}/${short(f.ctxWindow)} ctx (${f.ctxPercent}%)`}
    </Text>
  )
}

// The terminal lays out in whole cells, so it gets the text bar, as wide as the line allows.
// Either way the bar sits in a box that grows, so it fills the row and Details lands at the right edge.
// On the desktop, see-through boxes lie over the picture, one per piece, each holding a card
// shown while the pointer is over it (as the cache item's is).
function contextBar(els: ElementTable, b: Band) {
  const { Box, Text } = els
  const parts = b.figures.parts ?? []
  if (b.surface !== 'terminal' && 'Svg' in els && els.Svg !== undefined) {
    const pieces = barPieces(parts, b.figures.ctxWindow)
    return (
      <Box key="bar" flexDirection="column" flexGrow={1}>
        <els.Svg key="svg" source={barSvg(pieces)} alt={`Context ${b.figures.ctxPercent ?? 0}% used`} height={BAR_H} />
        <Box key="hover" position="absolute" top={0} bottom={0} left={0} right={0} flexDirection="row">
          {pieces.map((p, i) => (
            <Box key={`seg${i}`} flexGrow={p.grow}>
              {hoverCard(els, [<Text key="label">{p.label}</Text>])}
            </Box>
          ))}
        </Box>
      </Box>
    )
  }
  const cells = b.bodyColumns > 0 ? Math.max(10, b.bodyColumns - TEXT_BAR_RESERVE) : TEXT_BAR_CELLS
  return (
    <Box key="bar" flexDirection="row" flexGrow={1}>
      {textBar(parts, b.figures.ctxWindow, cells).map((r, i) => (
        <Text key={`run${i}`} color={r.color}>
          {r.cells}
        </Text>
      ))}
    </Box>
  )
}

// Warm or cold; its card appears while the pointer is over the item.
function cacheItem($: EngineInterface, els: ElementTable, seen: CacheSeen, t: number) {
  const { Box, Text, Button } = els
  const view = cacheView(seen, t)
  const lines =
    view.state === 'warm'
      ? [
          <Text key="cwhen">{`Goes cold at ${eastern(view.coldAt)} (in ${view.minutesLeft} min)`}</Text>,
          <Button key="keepwarm" label="Keep warm" dimColor onPress={() => keepWarm($)} />,
        ]
      : [
          <Text key="cwhen">{`Went cold at ${eastern(view.coldAt)}`}</Text>,
          <Text key="ccost">{`Next message re-stores ~${short(view.prefix)} tokens`}</Text>,
        ]
  return (
    <Box key="cache" flexDirection="row">
      <Text key="cstate" color={view.state === 'warm' ? WARM_COLOR : 'subtle'} bold>{`cache: ${view.state}`}</Text>
      {hoverCard(els, lines)}
    </Box>
  )
}

function detailsList(els: ElementTable, f: Line) {
  const { Box, Text } = els
  return (
    <Box key="list" flexDirection="column">
      <Text key="head" color="subtle">
        {f.isExact ? 'Exact count, by source:' : 'Estimate, by source:'}
      </Text>
      {(f.parts ?? []).map((p, i) => (
        <Box key={`p${i}`} flexDirection="row">
          <Text key="sw" color={PALETTE[i % PALETTE.length]}>
            {'■ '}
          </Text>
          <Text key="nm">{p.name}</Text>
          <Text key="tk" color="subtle">{`  ${short(p.tokens)}  ${pct(p.tokens, f.ctxWindow)}`}</Text>
        </Box>
      ))}
    </Box>
  )
}

// Side question, Compact and Handoff, pinned to the right end of line 1.
function actions($: EngineInterface, els: ElementTable, b: Band) {
  const { Box, Text, Button } = els
  return (
    <Box key="actions" flexDirection="row" flexShrink={0}>
      <Button key="side" label="Side question" dimColor onPress={() => openSide($)} />
      <Text key="sgap">{'  '}</Text>
      <Button
        key="compact"
        label={b.isCompacting ? 'Compacting…' : 'Compact'}
        dimColor
        onPress={() => startCompact($)}
      />
      <Text key="agap">{'  '}</Text>
      <Button
        key="handoff"
        label={b.handoff.phase === 'idle' ? 'Handoff' : 'Writing handoff…'}
        dimColor
        onPress={(press) => startHandoff($, press.surface)}
      />
    </Box>
  )
}

// Line 1: the figures on the left, the buttons pinned to the right end.
function firstRow($: EngineInterface, els: ElementTable, b: Band) {
  const { Box } = els
  const item = b.cache === null ? null : cacheItem($, els, b.cache, b.t)
  return (
    <Box key="row1" flexDirection="row" justifyContent="space-between" alignItems="center" width="100%">
      <Box key="stats" flexDirection="row" flexWrap="wrap" flexShrink={1}>
        {stat(els, 'br', 'no branch', b.figures.branch, 'suggestion')}
        {sep(els, 's1')}
        {rateStat(els, 'r5', '5h', b.figures.rate5)}
        {sep(els, 's2')}
        {rateStat(els, 'r7', '7d', b.figures.rate7)}
        {sep(els, 's3')}
        {ctxLabel(els, b.figures)}
        {item === null ? null : sep(els, 's4')}
        {item}
      </Box>
      {actions($, els, b)}
    </Box>
  )
}

// Line 2: the context bar and the Details button.
// Off the terminal a button stands taller than a line, so line 1's buttons would touch Details.
function secondRow($: EngineInterface, els: ElementTable, b: Band) {
  const { Box, Text, Button } = els
  return (
    <Box key="row2" flexDirection="row" alignItems="center" width="100%" marginTop={b.surface === 'terminal' ? 0 : 1}>
      {contextBar(els, b)}
      <Text key="gap">{'  '}</Text>
      <Button
        key="details"
        label={b.isOpen ? 'Hide' : 'Details'}
        dimColor
        onPress={async () => {
          const opening = !b.isOpen
          await update($, isOpen, () => opening)
          if (opening) await refresh($)
        }}
      />
    </Box>
  )
}

function sideReply(els: ElementTable, t: SideTurn, key: string) {
  const { Text, Markdown } = els
  switch (t.state) {
    case 'answered':
      return <Markdown key={key} text={t.answer} />
    case 'failed':
      return (
        <Text key={key} color="error">
          {t.failure}
        </Text>
      )
    case 'pending':
      return (
        <Text key={key} dimColor>
          Thinking…
        </Text>
      )
  }
}

function sideThread(els: ElementTable, turns: Side['turns']) {
  const { Box, Text } = els
  return turns.map((t, i) => (
    <Box key={`t${i}`} flexDirection="column">
      {/* Yours in blue, Claude's under an orange label: the two colors tell them apart. */}
      <Text key={`q${i}`} bold color="suggestion">{`You: ${t.question}`}</Text>
      <Text key={`c${i}`} bold color="claude">
        Claude:
      </Text>
      {sideReply(els, t, `a${i}`)}
    </Box>
  ))
}

// Terminal and desktop get the drawn box (askbox.tsx), full width and wrapping.
// VS Code has no drawn boxes, so it gets the engine's field with the whole draft shown under it.
// The mobile app draws no field yet: its table still hands one out, which draws nothing.
function askField(
  $: EngineInterface,
  els: ElementTable,
  surface: RenderSurface,
  s: Side,
  placeholder: string,
  isPaneFocused: boolean,
) {
  const { Box, Text } = els
  if ((surface === 'terminal' || surface === 'desktop') && 'Client' in els && els.Client !== undefined) {
    return (
      <els.Client
        key={ASK_BOX}
        module="./askbox.tsx"
        props={{ draft: s.draft, seq: s.draftSeq, placeholder, isPaneFocused } satisfies AskBoxProps}
        width="100%"
      />
    )
  }
  if (surface !== 'mobile' && 'Input' in els && els.Input !== undefined) {
    return (
      <Box key="askfield" flexDirection="column">
        <els.Input
          key="ask"
          value={s.draft}
          placeholder={placeholder}
          submitLabel="ask"
          autoFocus
          onInput={(v) => updateSide($, (cur) => ({ ...cur, draft: v }))}
          onSubmit={(v) => askSide($, v)}
        />
        {s.draft.trim() === '' ? null : (
          <Box key="draftview">
            <Text key="drafttext" dimColor wrap="wrap">
              {s.draft}
            </Text>
          </Box>
        )}
      </Box>
    )
  }
  return (
    <Text key="ask" dimColor>
      Type side questions in the desktop app or the terminal.
    </Text>
  )
}

// Hooks that gate an event end in .catch(... next(e)): if one throws, the event goes on as if
// this plugin were absent, and a next() it already made is replayed, never run twice.

function sessionHooks(on: On) {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    await $.tool.register(TOOL_SPEC)
    // Every TICK_MS, so the cache item's minutes count down.
    $.clock.every(TICK_MS, () => {
      void $.clock.now().then((t) => advance($, t))
    })
    await advance($, await $.clock.now())
    await refresh($)
    return out
  })

  // Pushed by the engine after each turn and when a rate limit moves a point.
  on('session.measure', async ($, e, next) => {
    await refresh($, { figures: e })
    return next(e)
  })
}

function stepHooks(on: On) {
  on('turn.step', async function* ($, e, next) {
    // The cache's lifetime runs from when the request is sent, so the time is taken before it goes.
    // A subagent's request leaves the main thread's cache alone.
    const sentAt = e.agentId === undefined ? await $.clock.now() : null
    const r = yield* next(e)
    if (r.usage !== null && sentAt !== null) await noteCache($, sentAt, r.usage)
    return r
  })

  // The main turn's end: the transcript now holds its cache writes, each split by lifetime.
  on('classic.Stop', async ($, e, next) => {
    const r = await next(e)
    await learnTtl($, e.transcript_path)
    return r
  }).catch(($, e, next) => next(e))
}

function handoffHooks(on: On) {
  // The handoff tool only copies text, so it runs without a permission prompt.
  on('tool.check', { tool: TOOL }, () => ({
    decision: 'allow' as const,
    reason: 'desk-status: save_handoff only copies text to the clipboard.',
  })).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, ($, e) => saveHandoff($, e.text)).catch(() =>
    fail('save_handoff hit an error. Put the handoff in your reply so the user can copy it themselves.'),
  )

  on('turn.start', async ($, e, next) => {
    if (e.text.startsWith(FIRST_LINE)) {
      await update($, handoff, (h): Handoff => (h.phase === 'queued' ? { ...h, phase: 'writing' } : h))
    }
    return next(e)
  })
}

function turnEndHooks(on: On) {
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await handoffTurnEnded($)
    return next(e)
  })
}

function bandHooks(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Every value the band draws, read at once.
    const [figures, open, handoffNow, compacting, seen, t] = await Promise.all([
      read($, line),
      read($, isOpen),
      read($, handoff),
      read($, isCompacting),
      read($, cache),
      read($, now),
    ])
    if (e.props.hasSurvey || figures === null) return next(e)

    const els = $.ui.resolve(e)
    const { Box } = els
    const b: Band = {
      figures,
      isOpen: open,
      handoff: handoffNow,
      isCompacting: compacting,
      cache: seen,
      t,
      surface: e.surface,
      bodyColumns: e.props.bodyColumns,
    }
    return (
      <Box flexDirection="column">
        {firstRow($, els, b)}
        {secondRow($, els, b)}
        {open ? detailsList(els, figures) : null}
      </Box>
    )
  })
}

function sideHooks(on: On) {
  // The typing box's posts (askbox.tsx): each change keeps the draft, and Enter asks.
  // Its data came from code on the surface, so its shape is checked before use.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== SIDE_PANE || e.element !== ASK_BOX) return next(e)
    const post = e.data as Partial<AskBoxPost> | null
    if (post === null || typeof post !== 'object' || typeof post.text !== 'string') return {}
    const text = post.text
    if (post.kind === 'draft') await updateSide($, (s) => ({ ...s, draft: text }))
    else if (post.kind === 'ask') await askSide($, text)
    return {}
  })

  // The side-question panel: the thread and a typing box.
  on('ui.render', { component: 'Pane', requestId: SIDE_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const s = await readSide($)
    const placeholder = s.turns.length === 0 ? 'Ask about this chat…' : 'Ask a follow-up…'
    // The desktop app clipped the field's lower edge: the padding gives it room.
    // Docked, the panel takes its full height and the thread takes the spare rows,
    // which pins the typing box to the bottom. Inline, the frame fits the tree, so no stretch.
    // Spread, not minHeight={undefined}: the desktop app refuses a prop that holds undefined.
    const fullHeight = e.props.placement === 'dock' ? { minHeight: e.props.scroll.bodyRows } : {}
    return (
      <Box key="sidepane" flexDirection="column" alignItems="stretch" paddingBottom={1} {...fullHeight}>
        <Box key="thread" flexDirection="column" flexGrow={1}>
          {s.turns.length === 0 ? (
            <Text key="hint" dimColor>
              Ask about the main chat. The main agent won't see this.
            </Text>
          ) : null}
          {sideThread(els, s.turns)}
        </Box>
        <Box key="askrow" flexDirection="column" alignItems="stretch" width="100%" paddingY={1}>
          {askField($, els, e.surface, s, placeholder, e.props.isFocused)}
        </Box>
      </Box>
    )
  })
}

export const register: Register = (on) => {
  sessionHooks(on)
  stepHooks(on)
  handoffHooks(on)
  turnEndHooks(on)
  bandHooks(on)
  sideHooks(on)
}
