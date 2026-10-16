// Desktop version of ~/.claude/statusline-command.sh.
// Row 1, the band's first line: the Tracer, Side question (terminal only), Compact and Write handoff buttons, at the trailing edge.
// Row 2: branch, 5-hour and 7-day rate limits, context used, cache warm or cold, the Agent counter; the stats alone, with the whole width.
// As the band narrows, figures drop out: branch, then 7d, then the cache item, then the Agent counter, then context shortens (fit.ts).
// Hovering the cache item shows when it goes cold and the Auto warm switch, or once cold, what the next message re-stores.
// The Agent counter (`agents N`, N the board's Live agents) opens the agent board when pressed; hovering it shows the running and finished counts.
// Side question opens an Ask box under the Band's three lines; the Side questions panel still asks Claude over a copy of the chat, out of the main agent's sight.
// Row 3: context bar split by source, and a Show details button.
// On desktop the bar is an SVG whose pieces show a tooltip on hover.
// Colors: plain text under 50% (low usage is not news), warning under 80%, error above.
// Every hook lives in this file, the five on events other areas share (session.start, prompt.submit, session.measure,
// turn.step, turn.complete) too: `register` here adds them all, and the entry file ../register.tsx only calls it.
import { atom, read, update } from 'claude-code'
import type {
  Chunk,
  ElementTable,
  EngineInterface,
  ModelUsage,
  On,
  RenderSurface,
  SessionContextUsage,
  SessionRateLimit,
  SessionUsage,
} from 'claude-code'

import {
  isOwnPress,
  takenByPressHook,
  type EventIn,
  type EventOut,
  type PlainNext,
  type StreamingNext,
} from '../handler'
import { REFUSED_BY_HOOK, because, errorText, failToast } from '../failures'
import { buttonPad, inputOf, isAppAttached, svgOf } from '../surface'
import type { AgentRow, AutoWarm, CacheSeen, Handoff, Line, Part, Side, SideTurn } from '../../types'
import {
  AUTO_MARK,
  KEEP_WARM_PROMPT,
  NO_AUTO_WARM,
  NO_PING,
  TICK_MS,
  TTL_SCRIPT,
  type Ping,
  autoWarmOf,
  cacheAfterReply,
  cacheView,
  eastern,
  prefixOf,
  pressOn,
  promptEndsAutoWarm,
  tickAction,
  ttlFrom,
} from './cache'
import { PANE as BOARD_PANE, TITLE as BOARD_PANE_TITLE } from '../board/agents'
import { PANE as TRACER_PANE, TITLE as TRACER_TITLE } from '../tracer/record'
import { agentsCard, countAgents } from './agents'
import { BAND_DOING, bandButtonOf, type BandButton } from './keys'
import { COMPACT, HANDOFF, SIDE, claim } from './busy'
import { COMPACT_PROMPT } from './compact'
import {
  answerRows,
  cardLeft,
  cutAnswer,
  cutQuestion,
  type Figures,
  type RowItem,
  type RowKey,
  SEP_TEXT,
  statsItems,
  type StatsItems,
  textRows,
} from './fit'
import type { AskBoxPost, AskBoxProps } from './askbox'
import { ASK_BOX, NO_SIDE, SIDE_PANE, forkFailure, forkThrew, sidePrompt } from './side'
import { CAP, FIRST_LINE, HANDOFF_PROMPT, IDLE, TOOL, TOOL_SPEC, estimateTokens, fail, ok, textOf } from './handoff'

// The validator reads state only through atoms declared in this file.
const line = atom({ plugin: 'desk', key: 'line' } as const, null)
const isOpen = atom({ plugin: 'desk', key: 'isOpen' } as const, false)
const now = atom({ plugin: 'desk', key: 'bandNow' } as const, 0)
const handoff = atom({ plugin: 'desk', key: 'handoff' } as const, IDLE)
const isCompacting = atom({ plugin: 'desk', key: 'isCompacting' } as const, false)
const side = atom({ plugin: 'desk', key: 'side' } as const, NO_SIDE)
const isSideOpen = atom({ plugin: 'desk', key: 'isSideOpen' } as const, false)
const keyboardLeaves = atom({ plugin: 'desk', key: 'keyboardLeaves' } as const, 0)
const cache = atom({ plugin: 'desk', key: 'cache' } as const, null as CacheSeen | null)
const autoWarm = atom({ plugin: 'desk', key: 'autoWarm' } as const, NO_AUTO_WARM)
// The board's Batch, which the Agent counter reads and never writes. The board declares the same key.
const agents = atom({ plugin: 'desk', key: 'agents' } as const, [] as AgentRow[])
// The tracer's own saved flag, which the Tracer button clears. The tracer declares the same key. It stays a literal: the engine's scan refuses an atom key imported from another file. shared.test.ts proves the keys agree.
const tracerClosed = atom({ plugin: 'desk', key: 'closed' } as const, false)

// One color per source, biggest first. Readable on dark and light.
// Neighbors sit far apart in hue, so the two biggest sources (side by side in the bar) never look alike.
const PALETTE = ['#7aa2f7', '#ff9e64', '#9ece6a', '#f7768e', '#bb9af7', '#e0af68', '#7dcfff', '#c0caf5']
// Free space: solid grey.
const FREE = '#4b5563'
// Terminal bar length when the band's width is unknown.
const TEXT_BAR_CELLS = 40
// Cells kept clear on the terminal bar's line: the two-cell gap, `[ Show details ]` (16, the same as
// `[ Hide details ]`) and three to spare. A bar any wider wraps its last cell onto a row of its own.
const TEXT_BAR_RESERVE = 21
// Desktop bar height in CSS pixels. The picture sets it: a box can't be sized in pixels, and drew round corners.
// No width: the bar stretches to fill its row, so Details sits at the right edge.
const BAR_H = 9
// The bar is split into this many parts; a box's flexGrow may not pass 10000.
const BAR_PARTS = 10_000
// A source too small to see still takes this many parts (0.2%), so its hover card can be reached.
const MIN_PARTS = 20

// Higher used is worse, for context and both rate limits.
const level = (pct: number) => (pct >= 80 ? 'error' : pct >= 50 ? 'warning' : 'text')

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
function advance($: EngineInterface, t: number) {
  return update($, now, (n) => Math.max(n, t))
}

// The Handoff button's press: queue the request; or, on a request already out, free the button and end its turn if it runs.
async function startHandoff($: EngineInterface, surface: RenderSurface) {
  // Claimed inside one update, so two presses at once cannot both queue a request. A refused claim frees the button.
  const press = claim(HANDOFF, surface)
  await update($, handoff, press.change)
  if (press.isTaken()) return sendHandoff($)
  const was = press.seen()
  if (was?.phase === 'writing' && was.turnId !== undefined) return stopHandoff($, was.turnId)
  $.ui.toast('Handoff reset. Press Write handoff again to write a new one.')
}

// A second press while the handoff turn runs: end that turn. The button is already free, so the turn's end says nothing.
async function stopHandoff($: EngineInterface, turnId: string) {
  try {
    await $.turn.abort({ turnId })
    $.ui.toast('Handoff stopped.')
  } catch (err) {
    $.ui.toast(`Could not stop the handoff ${because(errorText(err))}. The button is free again.`)
  }
}

// Why a hook refused a prompt: the text it gave, or a plain line where it gave none.
const dropReason = (drop: string) => drop || REFUSED_BY_HOOK

// Sends the handoff request for a press that queued one.
function sendHandoff($: EngineInterface) {
  const cancel = async (reason: string) => {
    await update($, handoff, HANDOFF.release)
    $.ui.toast(`The handoff request could not be sent ${because(reason)}.`)
  }
  // Resolves when the handoff turn starts, which may wait for a running turn; the press does not wait for it.
  // A hook that refuses the prompt answers { drop } rather than failing the call.
  void $.prompt.submit({ text: HANDOFF_PROMPT }).then(
    (r) => (r.drop === undefined ? undefined : cancel(dropReason(r.drop))),
    (err: unknown) => cancel(errorText(err)),
  )
}

// The Tracer button's press: bring the tracer's pane back with the keyboard, as a press on a Trail row does.
// A pane the engine rejects is left as it is, and the toast says why.
async function openTracer($: EngineInterface) {
  await update($, tracerClosed, () => false)
  await $.ui.open({ id: TRACER_PANE, title: TRACER_TITLE, focus: true }).catch((err: unknown) => {
    $.ui.toast(`Could not open ${TRACER_TITLE}: ${errorText(err)}`)
  })
}

// The Agent counter's press: open the board's pane with the keyboard, as the board's own `/agent-board` does.
// The board keeps no closed flag, so there is no state to reset. A pane the engine rejects is left as it is, and the toast says why.
async function openBoard($: EngineInterface) {
  await $.ui.open({ id: BOARD_PANE, title: BOARD_PANE_TITLE, focus: true }).catch((err: unknown) => {
    $.ui.toast(`Could not open ${BOARD_PANE_TITLE}: ${errorText(err)}`)
  })
}

// The Compact button's press: run `/compact <instructions>` as if the user typed it.
// Not $.session.compact: the desktop app runs the session headless, where that call is refused.
// The engine queues the command until the session is idle; its result shows in the transcript.
async function startCompact($: EngineInterface) {
  // Claimed inside one update, so two presses at once run one command.
  const press = claim(COMPACT)
  await update($, isCompacting, press.change)
  if (!press.isTaken()) return
  try {
    await $.command.run({ command: 'compact', args: COMPACT_PROMPT })
  } catch (err) {
    $.ui.toast(`Could not compact ${because(errorText(err))}.`)
  } finally {
    await update($, isCompacting, COMPACT.release)
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

// Every read of the switch goes through this, so a saved value missing a field is brought up to date.
async function readAuto($: EngineInterface): Promise<AutoWarm> {
  return autoWarmOf(await read($, autoWarm))
}

// The Auto warm press: off when on; else on until three hours from now. Only the hour-long cache can be kept warm.
// It answers the switch as the press left it, or null where the press was refused.
async function pressAutoWarm($: EngineInterface): Promise<AutoWarm | null> {
  if ((await readAuto($)).isOn) {
    await update($, autoWarm, () => NO_AUTO_WARM)
    return NO_AUTO_WARM
  }
  const press = pressOn(await read($, cache), await $.clock.now())
  if (!press.isOk) {
    $.ui.toast(press.toast)
    return null
  }
  await update($, autoWarm, () => press.auto)
  return press.auto
}

// The terminal's button: the same press as the card's switch, then a toast, since the card's line is not on screen there.
async function pressAutoWarmButton($: EngineInterface) {
  const after = await pressAutoWarm($)
  if (after === null) return
  $.ui.toast(after.isOn ? `Auto warm on, off at ${eastern(after.offAt)}` : 'Auto warm off')
}

// The Keep-warm ping: a tiny prompt, whose request reads the whole cache and restarts its clock.
// False comes back where the ping never entered, so nothing will answer it.
function sendPing($: EngineInterface): Promise<boolean> {
  return $.prompt.submit({ text: KEEP_WARM_PROMPT }).then(
    (r) => {
      if (r.drop === undefined) return true
      $.ui.toast(`The keep-warm message was refused ${because(dropReason(r.drop))}.`)
      return false
    },
    (err: unknown) => {
      $.ui.toast(`The keep-warm message could not be sent ${because(errorText(err))}.`)
      return false
    },
  )
}

// Each tick: the rules in cache.ts say whether Auto warm stays, switches off or pings. True comes back when this tick
// should ping. A ping that waits (queued behind a long tool call, say) holds the next until its reply restarts the
// cache's clock.
async function autoWarmTick($: EngineInterface, t: number, ping: Ping): Promise<boolean> {
  const action = tickAction(await readAuto($), await read($, cache), t, ping)
  if (action.kind === 'off') await update($, autoWarm, () => NO_AUTO_WARM)
  return action.kind === 'ping'
}

// The Details button's press: opens the details, or closes them. Whether they are open is read now, not when the button was drawn.
async function toggleDetails($: EngineInterface) {
  let isOpening = false
  await update($, isOpen, (open) => {
    isOpening = !open
    return isOpening
  })
  if (isOpening) await refresh($)
}

// The action of each band Button: the one copy, which the band's `ui.press` hook runs. `surface` is where the press came from.
const bandActions = ($: EngineInterface, surface: RenderSurface): Record<BandButton, () => Promise<unknown>> => ({
  tracer: () => openTracer($),
  side: () => toggleSide($),
  compact: () => startCompact($),
  handoff: () => startHandoff($, surface),
  agents: () => openBoard($),
  details: () => toggleDetails($),
  openpane: () => openSidePane($),
  clearthread: () => clearThread($),
  autowarm: () => pressAutoWarm($),
  cstate: () => pressAutoWarmButton($),
})

// The Side question button's press: show or fold the Ask box under the Band's two lines.
async function toggleSide($: EngineInterface) {
  await update($, isSideOpen, (open) => !open)
}

// Open in pane: the existing Side questions pane, which draws the whole Thread.
// A pane the engine rejects, or does not place, is left as it is, and the toast says why.
async function openSidePane($: EngineInterface) {
  try {
    const r = await $.ui.open({ id: SIDE_PANE, title: 'Side questions', focus: true })
    if (!r.isPlaced) $.ui.toast(`Could not open the side panel ${because(errorText(r.reason))}.`)
  } catch (err) {
    $.ui.toast(`Could not open the side panel ${because(errorText(err))}.`)
  }
}

// Clear: empties the Thread. No confirmation: it holds side questions only, and the main chat is untouched.
async function clearThread($: EngineInterface) {
  await update($, side, (s) => ({ ...s, turns: [] }))
}

// Enter in the panel: one tool-less request over a copy of the main chat, earlier side turns included.
// The main agent never sees it, and nothing is added to the main chat.
async function askSide($: EngineInterface, text: string) {
  const question = text.trim()
  if (question === '') return
  // Claimed inside one update, so two asks at once send one fork. The question went in last, so the turns
  // before it are the ones the claim saw.
  const ask = claim(SIDE, question)
  const after = await update($, side, ask.change)
  if (!ask.isTaken()) {
    $.ui.toast('Still busy with the last side question.')
    return
  }
  const at = after.turns.length - 1
  const earlier = after.turns.slice(0, at)
  let settled: SideTurn
  try {
    const r = await $.model.fork({ prompt: sidePrompt(earlier, question) })
    settled = r.isAnswered
      ? { question, state: 'answered', answer: r.text }
      : { question, state: 'failed', failure: forkFailure(r) }
  } catch (err) {
    settled = { question, state: 'failed', failure: forkThrew(err) }
  }
  await update($, side, (s) => ({
    ...SIDE.release(s),
    turns: s.turns.map((t, i) => (i === at ? settled : t)),
  }))
}

// A main-thread model request ended: it restarts the cache's clock.
async function noteCache($: EngineInterface, sentAt: number, usage: ModelUsage) {
  try {
    const prefix = prefixOf(usage)
    await update($, cache, (c) => cacheAfterReply(c, sentAt, prefix))
    await advance($, sentAt)
  } catch {
    // The item keeps its last reading.
  }
}

// Why a handoff turn ended without a copy, by how the turn ended.
const TURN_ENDED: Record<EventIn<'turn.complete'>['reason'], string> = {
  answer: 'the turn ended without calling save_handoff',
  aborted: 'the turn was stopped',
  refusal: 'the model refused the request',
  error: 'the turn ended on an error',
}

// The handoff turn ended without a copy: free the button and say so.
async function handoffTurnEnded($: EngineInterface, reason: EventIn<'turn.complete'>['reason']) {
  if ((await read($, handoff)).phase !== 'writing') return
  await update($, handoff, HANDOFF.release)
  $.ui.toast(`The handoff was not copied (${TURN_ENDED[reason]}). Press Write handoff to try again.`)
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
  await update($, handoff, HANDOFF.release)
  if (!copied.isCopied) {
    const why = because(errorText(copied.reason))
    $.ui.toast(`The handoff could not be copied ${why}.`)
    return fail(
      `The clipboard refused it ${why}. Tell the user, and put the handoff in your reply so they can copy it themselves.`,
    )
  }
  $.ui.toast(`Handoff copied to your clipboard, about ${tokens} tokens.`)
  return ok(`Copied to the user's clipboard, about ${tokens} tokens. Reply with one line saying so.`)
}

// Whether the session draws on the desktop app, which has its own side question: the band keeps none there.
const isOnDesktop = async ($: EngineInterface) => isAppAttached(await $.session.surfaces())

// Every value the band draws, and where it is drawn.
type Band = {
  figures: Line
  isOpen: boolean
  handoff: Handoff
  isCompacting: boolean
  cache: CacheSeen | null
  auto: AutoWarm
  t: number
  surface: RenderSurface
  bodyColumns: number
  isSideOpen: boolean
  batch: AgentRow[]
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

// The terminal's card: one dim line on the item's own row, `left` cells past the item's start, which puts it a cell past the row's end
// (cardLeft, fit.ts). Null `left`: the card would run past the band's edge, so it is not drawn. Unkeyed Box, as above.
// A bordered box there was painted over the two rows below it.
function lineCard(els: ElementTable, k: string, text: string, left: number | null) {
  const { Box, Text } = els
  if (left === null) return null
  return (
    <Box position="absolute" top={0} left={left} display="none" hover={{ display: 'flex' }}>
      <Text key={k} color="inactive">
        {text}
      </Text>
    </Box>
  )
}

function sep(els: ElementTable, k: string) {
  const { Text } = els
  return (
    <Text key={k} color="subtle">
      {SEP_TEXT}
    </Text>
  )
}

function na(els: ElementTable, k: string, label: string) {
  const { Text } = els
  return (
    <Text key={k} color="inactive">
      {label}
    </Text>
  )
}

// A figure of the stats row in bold (or regular, for the branch), or a dim stand-in when it is missing.
function figure(
  els: ElementTable,
  item: RowItem,
  isMissing: boolean,
  color: ReturnType<typeof level> | 'inactive',
  isBold = true,
) {
  const { Text } = els
  if (isMissing) return na(els, item.key, item.text)
  return (
    <Text key={item.key} color={color} bold={isBold}>
      {item.text}
    </Text>
  )
}

const rateText = (label: string, used: number | null) =>
  used === null ? `${label} —` : `${label} ${Math.round(used)}%`

// The context figure: in full, or short (`ctx 13%`) when the line is tight.
const ctxText = (f: Line, isShort: boolean) => {
  if (f.ctxUsed === null || f.ctxPercent === null) return isShort ? 'ctx —' : `0/${short(f.ctxWindow)} ctx`
  return isShort ? `ctx ${f.ctxPercent}%` : `${short(f.ctxUsed)}/${short(f.ctxWindow)} ctx (${f.ctxPercent}%)`
}

// The terminal lays out in whole cells, so it gets the text bar, as wide as the line allows.
// Either way the bar sits in a box that grows, so it fills the row and Details lands at the right edge.
// On the desktop, see-through boxes lie over the picture, one per piece, each holding a card
// shown while the pointer is over it (as the cache item's is).
function contextBar(els: ElementTable, b: Band) {
  const { Box, Text } = els
  const parts = b.figures.parts ?? []
  const Svg = svgOf(b.surface, els)
  if (Svg !== null) {
    const pieces = barPieces(parts, b.figures.ctxWindow)
    return (
      <Box key="bar" flexDirection="column" flexGrow={1}>
        <Svg key="svg" source={barSvg(pieces)} alt={`Context ${b.figures.ctxPercent ?? 0}% used`} height={BAR_H} />
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
function cacheItem(
  $: EngineInterface,
  els: ElementTable,
  seen: CacheSeen,
  auto: AutoWarm,
  t: number,
  isTerminal: boolean,
  row: StatsItems,
) {
  const { Box, Text, Button } = els
  const view = cacheView(seen, t)
  const when =
    view.state === 'warm'
      ? `Goes cold at ${eastern(view.coldAt)} (in ${view.minutesLeft} min)`
      : `Went cold at ${eastern(view.coldAt)}`
  const lines =
    view.state === 'warm'
      ? [
          <Text key="cwhen">{when}</Text>,
          ...(auto.isOn ? [<Text key="cauto">{`Auto warm on, off at ${eastern(auto.offAt)}`}</Text>] : []),
          <Button
            key="autowarm"
            label={auto.isOn ? 'Turn auto warm off' : 'Turn auto warm on'}
            dimColor
            onPress={takenByPressHook}
          />,
        ]
      : [
          <Text key="cwhen">{when}</Text>,
          <Text key="ccost">{`Next message re-stores ~${short(view.prefix)} tokens`}</Text>,
        ]
  // Inside the terminal's Button the text carries no key: the Button has it.
  const stateText = (key?: string) => (
    <Text key={key} color={view.state === 'warm' ? 'claude' : 'inactive'} bold={view.state === 'warm'}>
      {`cache ${view.state}`}
    </Text>
  )
  return (
    <Box key="cache" flexDirection="row">
      {isTerminal ? (
        <Button key="cstate" plain label={`cache ${view.state}`} onPress={takenByPressHook}>
          {stateText()}
        </Button>
      ) : (
        stateText('cstate')
      )}
      {auto.isOn ? sep(els, 's5') : null}
      {auto.isOn ? (
        <Text key="cmark" color={view.state === 'warm' ? 'claude' : 'inactive'} bold={view.state === 'warm'}>
          {AUTO_MARK}
        </Text>
      ) : null}
      {isTerminal ? lineCard(els, 'cwhen', when, cardLeft(row, 'cache', when.length)) : hoverCard(els, lines)}
    </Box>
  )
}

function detailsList(els: ElementTable, f: Line) {
  const { Box, Text } = els
  return (
    <Box key="list" flexDirection="column">
      <Text key="head" color="inactive">
        {f.isExact ? 'Exact count, by source:' : 'Estimate, by source:'}
      </Text>
      {(f.parts ?? []).map((p, i) => (
        <Box key={`p${i}`} flexDirection="row">
          <Text key="sw" color={PALETTE[i % PALETTE.length]}>
            {'■ '}
          </Text>
          <Text key="nm">{p.name}</Text>
          <Text key="tk" color="inactive">{`  ${short(p.tokens)}  ${pct(p.tokens, f.ctxWindow)}`}</Text>
        </Box>
      ))}
    </Box>
  )
}

// The buttons' labels now, which change while a job runs or the Ask box is open.
// Desktop has its own side question, so there `side` is null and the row leaves the button out.
const buttonLabels = (b: Band) => ({
  tracer: 'Tracer',
  side: b.surface === 'desktop' ? null : b.isSideOpen ? 'Hide side question' : 'Side question',
  compact: b.isCompacting ? 'Compacting…' : 'Compact',
  handoff: b.handoff.phase === 'idle' ? 'Write handoff' : 'Writing handoff…',
})

// Tracer, Side question (not on desktop), Compact and Write handoff.
// A Button takes no layout props, so each sits in a box that never shrinks: a squeezed button clipped its label.
function actions($: EngineInterface, els: ElementTable, b: Band) {
  const { Box, Text, Button } = els
  const label = buttonLabels(b)
  return (
    <Box key="buttons" flexDirection="row" flexShrink={0}>
      <Box key="tracerbox" flexShrink={0}>
        <Button key="tracer" label={label.tracer} dimColor onPress={takenByPressHook} />
      </Box>
      <Text key="tgap">{'  '}</Text>
      <Box key="actions" flexDirection="row" flexShrink={0}>
        {label.side === null ? null : (
          <Box key="sidebox" flexShrink={0}>
            <Button key="side" label={label.side} dimColor onPress={takenByPressHook} />
          </Box>
        )}
        {label.side === null ? null : <Text key="sgap">{'  '}</Text>}
        <Box key="compactbox" flexShrink={0}>
          <Button key="compact" label={label.compact} dimColor onPress={takenByPressHook} />
        </Box>
        <Text key="agap">{'  '}</Text>
        <Box key="handoffbox" flexShrink={0}>
          <Button key="handoff" label={label.handoff} dimColor onPress={takenByPressHook} />
        </Box>
      </Box>
    </Box>
  )
}

// The Cache item's text: `cache warm` or `cache cold`; Auto warm adds a separator and its mark. The terminal's press is the item's own text.
const cacheText = (seen: CacheSeen, auto: AutoWarm, t: number) =>
  `cache ${cacheView(seen, t).state}${auto.isOn ? SEP_TEXT + AUTO_MARK : ''}`

// The text of each figure on the stats row, built once a render.
function figuresOf(b: Band): Figures<CacheSeen> {
  const f = b.figures
  return {
    branch: f.branch ?? 'no branch',
    rate5: rateText('5h', f.rate5),
    rate7: rateText('7d', f.rate7),
    ctx: ctxText(f, false),
    ctxShort: ctxText(f, true),
    cache: b.cache === null ? null : { text: cacheText(b.cache, b.auto, b.t), seen: b.cache },
    agents: `agents ${countAgents(b.batch).live}`,
    agentsPad: buttonPad(b.surface),
  }
}

// The Agent counter: `agents N`, N the Batch's Live agents, dim at zero. Drawn as a plain Button, the one pressable text.
// Its card appears while the pointer is over the item (as the cache item's does).
function agentsItem($: EngineInterface, els: ElementTable, b: Band, row: StatsItems) {
  const { Box, Text, Button } = els
  const { live } = countAgents(b.batch)
  const card = agentsCard(b.batch)
  return (
    <Box key="agentsitem" flexDirection="row" flexShrink={0}>
      <Button key="agents" label={`agents ${live}`} plain dimColor={live === 0} onPress={takenByPressHook} />
      {b.surface === 'terminal'
        ? lineCard(els, 'acard', card, cardLeft(row, 'agents', card.length))
        : hoverCard(els, [<Text key="acard">{card}</Text>])}
    </Box>
  )
}

// The blank rows above the stats row and the bar row: none on the terminal, one elsewhere, where a native button stands taller than a line.
const rowGap = (b: Band) => (b.surface === 'terminal' ? 0 : 1)

// The key of the separator drawn before each figure. The branch, when drawn, is first, so it has none.
const SEP_KEY: Record<Exclude<RowKey, 'br'>, string> = { r5: 's1', r7: 's2', ctx: 's3', cache: 's4', agents: 's6' }

// One figure of the stats row (statsItems, fit.ts), with the separator before it unless it starts the row.
function rowFigure(
  $: EngineInterface,
  els: ElementTable,
  b: Band,
  row: StatsItems<CacheSeen>,
  item: RowItem<CacheSeen>,
) {
  const f = b.figures
  const before = item.key === 'br' || item.start === 0 ? null : sep(els, SEP_KEY[item.key])
  // The Cache item draws from the `seen` its row item carries (figuresOf).
  const drawn =
    item.key === 'cache'
      ? cacheItem($, els, item.seen, b.auto, b.t, b.surface === 'terminal', row)
      : {
          br: () => figure(els, item, f.branch === null, 'inactive', false),
          r5: () => figure(els, item, f.rate5 === null, level(f.rate5 ?? 0)),
          r7: () => figure(els, item, f.rate7 === null, level(f.rate7 ?? 0)),
          ctx: () => figure(els, item, f.ctxUsed === null || f.ctxPercent === null, level(f.ctxPercent ?? 0)),
          agents: () => agentsItem($, els, b, row),
        }[item.key]()
  // Only drawn elements go in the row's list: no null among an array of children.
  return [before, drawn].filter((e) => e !== null)
}

// Row 2: the stats alone, with the whole width. The buttons have the row above (buttonRow).
// Off the terminal a native button stands taller than a line, so a row of margin keeps it off the stats text.
// As the band narrows the figures drop out (fit.ts), so none wrap into a column.
// The Agent counter sits beside the box that holds the other figures, not in it.
function statsRow($: EngineInterface, els: ElementTable, b: Band) {
  const { Box } = els
  const row = statsItems(b.bodyColumns, figuresOf(b))
  const drawn = (isAgents: boolean) =>
    row.items.filter((i) => (i.key === 'agents') === isAgents).flatMap((i) => rowFigure($, els, b, row, i))
  return (
    <Box key="row2" flexDirection="row" alignItems="center" width="100%" marginTop={rowGap(b)}>
      <Box key="left" flexDirection="row" flexShrink={1}>
        <Box key="stats" flexDirection="row" flexShrink={1}>
          {drawn(false)}
        </Box>
        {drawn(true)}
      </Box>
    </Box>
  )
}

// Row 1, the band's first line: the buttons, pinned to the trailing edge.
function buttonRow($: EngineInterface, els: ElementTable, b: Band) {
  const { Box } = els
  return (
    <Box key="row1" flexDirection="row" justifyContent="flex-end" alignItems="center" width="100%">
      {actions($, els, b)}
    </Box>
  )
}

// Row 3: the context bar and the Details button.
// Off the terminal the Agent counter's button stands taller than a line, so it would touch Details.
function barRow($: EngineInterface, els: ElementTable, b: Band) {
  const { Box, Text, Button } = els
  return (
    <Box key="row3" flexDirection="row" alignItems="center" width="100%" marginTop={rowGap(b)}>
      {contextBar(els, b)}
      <Text key="gap">{'  '}</Text>
      <Button key="details" label={b.isOpen ? 'Hide details' : 'Show details'} dimColor onPress={takenByPressHook} />
    </Box>
  )
}

function sideReply(els: ElementTable, t: SideTurn, key: string, cut = (answer: string) => answer) {
  const { Text, Markdown } = els
  switch (t.state) {
    case 'answered':
      return <Markdown key={key} text={cut(t.answer)} />
    case 'failed':
      return (
        <Text key={key} color="error">
          {cut(t.failure)}
        </Text>
      )
    case 'pending':
      return (
        <Text key={key} color="inactive">
          Thinking…
        </Text>
      )
  }
}

function sideThread(els: ElementTable, turns: Side['turns']) {
  const { Box, Text } = els
  return turns.map((t, i) => (
    <Box key={`t${i}`} flexDirection="column">
      {/* Yours in plain bold text, Claude's under its own colored label. */}
      <Text key={`q${i}`} bold color="text">{`You: ${t.question}`}</Text>
      <Text key={`c${i}`} bold color="claude">
        Claude:
      </Text>
      {sideReply(els, t, `a${i}`)}
    </Box>
  ))
}

// Terminal and desktop get the drawn box (askbox.tsx), full width and wrapping.
// VS Code has no drawn boxes, so it gets the engine's field with the whole draft shown under it.
// The mobile app draws no field yet (inputOf in ../surface).
const hasDrawnBox = (els: ElementTable, surface: RenderSurface) =>
  (surface === 'terminal' || surface === 'desktop') && 'Client' in els && els.Client !== undefined

/** What the Ask box needs from whoever draws it. */
type AskSetup = {
  s: Side
  placeholder: string
  /** Whether the surface holds the keyboard: the one sign the box gets that it lost it. */
  isPaneFocused: boolean
  /** Keyboard moves out of the Band so far. */
  leaves: number
  /** Whether the box sits beside its label in the Band, not in the pane. */
  isInBand: boolean
}

// The drawn box. Beside its label in the Band it takes the rest of the row, and the Band's hint says
// to click, so the box leaves its own click line out; in the panel it takes the whole width.
function drawnBox(els: ElementTable, a: AskSetup) {
  if (!('Client' in els) || els.Client === undefined) return null
  const props = {
    draft: a.s.draft,
    seq: a.s.draftSeq,
    placeholder: a.placeholder,
    isPaneFocused: a.isPaneFocused,
    leaves: a.leaves,
    hasClickLine: !a.isInBand,
  } satisfies AskBoxProps
  const size = a.isInBand ? ({ flexGrow: 1 } as const) : ({ width: '100%' } as const)
  return <els.Client key={ASK_BOX} {...size} module="./askbox.tsx" props={props} />
}

// The engine's own field, with the draft shown whole under it. Enter asks.
function typingField($: EngineInterface, els: ElementTable, s: Side, placeholder: string) {
  const { Box, Text } = els
  if (!('Input' in els) || els.Input === undefined) return null
  return (
    <Box key="askfield" flexDirection="column">
      <els.Input
        key="ask"
        value={s.draft}
        placeholder={placeholder}
        submitLabel="ask"
        autoFocus
        onInput={(v) => update($, side, (cur) => ({ ...cur, draft: v }))}
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

/** The Ask box's placeholder: the first question, or a follow-up once the Thread has an Exchange. */
const placeholderOf = (s: Side) => (s.turns.length === 0 ? 'Ask about this chat…' : 'Ask a follow-up…')

const MOBILE_NOTICE = 'Type side questions in the desktop app or the terminal.'

function askField($: EngineInterface, els: ElementTable, surface: RenderSurface, a: AskSetup) {
  if (hasDrawnBox(els, surface)) return drawnBox(els, a)
  if (inputOf(surface, els) !== null) return typingField($, els, a.s, a.placeholder)
  return (
    <els.Text key="ask" dimColor>
      {MOBILE_NOTICE}
    </els.Text>
  )
}

/** The Ask box's label in the Band: `Side question` first, `Follow-up` once the Thread has an Exchange. */
const labelOf = (s: Side) => (s.turns.length === 0 ? 'Side question' : 'Follow-up')

// The cells the Ask box takes beside the draft: its label, the margin after it, its borders, padding and cursor.
const askBoxCells = (s: Side) => labelOf(s).length + 6

// The cells a label (`You`, `Claude`) takes before its text.
const LABEL_CELLS = 7

// One line of the Exchange: a label in a fixed-width cell, then its text.
function exchangeLine(
  els: ElementTable,
  name: string,
  label: { text: string; color: 'text' | 'claude' },
  body: JSX.Element,
) {
  const { Box, Text } = els
  return (
    <Box key={`${name}line`} flexDirection="row">
      <Box key={`${name}label`} width={LABEL_CELLS} flexShrink={0}>
        <Text bold color={label.color}>
          {label.text}
        </Text>
      </Box>
      <Box key={`${name}text`} flexGrow={1}>
        {body}
      </Box>
    </Box>
  )
}

// The latest Exchange: `You` beside the question, `Claude` beside the answer.
function sideExchange(els: ElementTable, t: SideTurn, rows: number, columns: number) {
  const { Box, Text } = els
  return (
    <Box key="exchange" flexDirection="column">
      {exchangeLine(
        els,
        'you',
        { text: 'You', color: 'text' },
        <Text wrap="wrap">{cutQuestion(t.question, columns)}</Text>,
      )}
      {exchangeLine(
        els,
        'claude',
        { text: 'Claude', color: 'claude' },
        sideReply(els, t, 'reply', (answer) => cutAnswer(answer, rows, columns)),
      )}
    </Box>
  )
}

// The Thread line above the latest Exchange: how many Exchanges are not shown, on the leading edge.
function threadLine($: EngineInterface, els: ElementTable, hidden: number) {
  const { Box, Text, Button } = els
  return (
    <Box key="threadline" flexDirection="row" justifyContent="space-between">
      <Box key="earlier">{hidden === 0 ? null : <Text color="inactive">{`Earlier ${hidden}`}</Text>}</Box>
      <Box key="threadactions" flexShrink={0}>
        <Button key="openpane" label="Open in pane" dimColor onPress={takenByPressHook} />
        <Text key="clearsep">{'  '}</Text>
        <Button key="clearthread" label="Clear" dimColor onPress={takenByPressHook} />
      </Box>
    </Box>
  )
}

// The Band's Side question rows, under its two lines: a blank row, the latest Exchange once there is one,
// the Ask box with its label (`Follow-up` after the first Exchange), and the hint before the first.
// Mobile has no box to label or click, so it gets the blank row and its one-line notice.
function sideRows(
  $: EngineInterface,
  els: ElementTable,
  surface: RenderSurface,
  s: Side,
  leaves: number,
  rows: number,
  columns: number,
) {
  const { Box, Text } = els
  const field = askField($, els, surface, {
    s,
    placeholder: placeholderOf(s),
    isPaneFocused: true,
    leaves,
    isInBand: true,
  })
  const hasBox = hasDrawnBox(els, surface) || inputOf(surface, els) !== null
  // Mobile has no box, so a saved Thread draws nothing there.
  const latest = hasBox ? s.turns.at(-1) : undefined
  return (
    <Box key="siderows" flexDirection="column">
      {/* Drawn text loses its key, so each line sits in a keyed Box. */}
      <Box key="sidegap">
        <Text> </Text>
      </Box>
      {latest === undefined ? null : threadLine($, els, s.turns.length - 1)}
      {latest === undefined ? null : sideExchange(els, latest, rows, columns)}
      {hasBox ? (
        <Box key="askrow" flexDirection="row">
          <Box key="sidelabel" flexShrink={0} marginRight={1}>
            <Text>{labelOf(s)}</Text>
          </Box>
          {field}
        </Box>
      ) : (
        field
      )}
      {hasBox && latest === undefined ? (
        <Box key="sidehint" flexDirection="row">
          <Text key="h1" color="inactive">
            The main agent won't see this.
          </Text>
          {sep(els, 'h2')}
          <Text key="h3" color="inactive">
            Click to type
          </Text>
          {sep(els, 'h4')}
          <Text key="h5" color="inactive">
            Enter asks
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

// Hooks that gate an event end in .catch(... next(e)): if one throws, the event goes on as if
// this plugin were absent, and a next() it already made is replayed, never run twice.

// The five handlers below are the shared events, registered in `register` behind the empty matcher (see the entry file).

export async function sessionStart(
  $: EngineInterface,
  e: EventIn<'session.start'>,
  next: PlainNext<'session.start'>,
): Promise<EventOut<'session.start'>> {
  // The band's last Keep-warm ping; a reload forgets it, which at worst allows one early ping.
  let ping = NO_PING
  const out = await next(e)
  // A load or reload: the last load's waits were cancelled with it, so a busy flag they would have freed is freed here.
  await update($, isCompacting, COMPACT.atLoad)
  await update($, side, SIDE.atLoad)
  await update($, handoff, HANDOFF.atLoad)
  await $.tool.register(TOOL_SPEC)
  // Every TICK_MS, so the cache item's minutes count down.
  $.clock.every(TICK_MS, () => {
    void $.clock.now().then(async (t) => {
      await advance($, t)
      if (!(await autoWarmTick($, t, ping))) return
      ping = { at: t, isWaiting: true }
      if (!(await sendPing($))) ping = { ...ping, isWaiting: false }
    })
  })
  await advance($, await $.clock.now())
  await refresh($)
  return out
}

// Any prompt but the band's own ping is the user's (or another mod's) next message: Auto warm is done.
export async function promptSubmit(
  $: EngineInterface,
  e: EventIn<'prompt.submit'>,
  next: PlainNext<'prompt.submit'>,
): Promise<EventOut<'prompt.submit'>> {
  if (promptEndsAutoWarm(e.text, await readAuto($))) await update($, autoWarm, () => NO_AUTO_WARM)
  return next(e)
}

// Pushed by the engine after each turn and when a rate limit moves a point.
export async function sessionMeasure(
  $: EngineInterface,
  e: EventIn<'session.measure'>,
  next: PlainNext<'session.measure'>,
): Promise<EventOut<'session.measure'>> {
  await refresh($, { figures: e })
  return next(e)
}

export async function* turnStep(
  $: EngineInterface,
  e: EventIn<'turn.step'>,
  next: StreamingNext<'turn.step'>,
): AsyncGenerator<Chunk<'turn.step'>, EventOut<'turn.step'>> {
  // The cache's lifetime runs from when the request is sent, so the time is taken before it goes.
  // A subagent's request leaves the main thread's cache alone.
  const sentAt = e.agentId === undefined ? await $.clock.now() : null
  const r = yield* next(e)
  if (r.usage !== null && sentAt !== null) await noteCache($, sentAt, r.usage)
  return r
}

export async function turnComplete(
  $: EngineInterface,
  e: EventIn<'turn.complete'>,
  next: PlainNext<'turn.complete'>,
): Promise<EventOut<'turn.complete'>> {
  if (e.agentId === undefined) await handoffTurnEnded($, e.reason)
  return next(e)
}

function stopHooks(on: On) {
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
    reason: 'desk: save_handoff only copies text to the clipboard.',
  })).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, ($, e) => saveHandoff($, e.text)).catch(() =>
    fail('save_handoff hit an error. Put the handoff in your reply so the user can copy it themselves.'),
  )

  on('turn.start', async ($, e, next) => {
    if (e.text.startsWith(FIRST_LINE)) {
      // The turn's id is kept with the phase, so a press after a reload can still end this turn.
      await update($, handoff, (h): Handoff =>
        h.phase === 'queued' ? { phase: 'writing', surface: h.surface, turnId: e.turnId } : h,
      )
    }
    return next(e)
  })
}

function pressHooks(on: On) {
  // Every band Button press comes here; a key that is none of the band's goes on beneath.
  on('ui.press', {}, async ($, e, next) => {
    const name = isOwnPress(e) ? bandButtonOf(e.element) : null
    if (name === null) return next(e)
    // An action that does not report its own failure (a state write, the usage read) is caught here, so the press
    // is never silently dropped to the do-nothing closure beneath the hook.
    try {
      await bandActions($, e.surface)[name]()
    } catch (err) {
      $.ui.toast(failToast(BAND_DOING[name], errorText(err)))
    }
    return { element: e.element }
  }).catch(($, e, next) => next(e))
}

function bandHooks(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Every value the band draws, read at once.
    const [figures, open, handoffNow, compacting, seen, auto, t, sideOpen, s, leaves, batch] = await Promise.all([
      read($, line),
      read($, isOpen),
      read($, handoff),
      read($, isCompacting),
      read($, cache),
      readAuto($),
      read($, now),
      read($, isSideOpen),
      // Desktop has its own side question: the saved Thread is not read there.
      e.surface === 'desktop' ? NO_SIDE : read($, side),
      read($, keyboardLeaves),
      read($, agents),
    ])
    if (e.props.hasSurvey || figures === null) return next(e)

    const els = $.ui.resolve(e)
    const { Box } = els
    // Rows the Band uses besides the answer: its three lines (stats, bar, buttons), the list of Details, then the Side question's own
    // blank row, Thread line and question, and the Ask box: its borders and the rows its draft wraps to.
    const askBox = 2 + textRows(s.draft, Math.max(1, e.props.bodyColumns - askBoxCells(s)))
    const otherRows = 3 + (open ? 1 + (figures.parts ?? []).length : 0) + 3 + askBox
    const b: Band = {
      figures,
      isOpen: open,
      handoff: handoffNow,
      isCompacting: compacting,
      cache: seen,
      auto,
      t,
      surface: e.surface,
      bodyColumns: e.props.bodyColumns,
      isSideOpen: sideOpen,
      batch,
    }
    return (
      <Box flexDirection="column">
        {buttonRow($, els, b)}
        {statsRow($, els, b)}
        {barRow($, els, b)}
        {open ? detailsList(els, figures) : null}
        {sideOpen && b.surface !== 'desktop'
          ? sideRows(
              $,
              els,
              b.surface,
              s,
              leaves,
              answerRows(e.props.maxRows, otherRows),
              Math.max(1, e.props.bodyColumns - LABEL_CELLS),
            )
          : null}
      </Box>
    )
  })
}

// Desktop has its own side question, so the Side questions pane only says so.
function desktopNotice(els: ElementTable) {
  const { Box, Text } = els
  return (
    <Box key="sidenotice">
      <Text color="inactive">The desktop app has its own side question; use that one.</Text>
    </Box>
  )
}

// Whether a keyboard move landed on one of this mod's own elements in the Band.
const isOwnBandFocus = (e: EventIn<'ui.focus'>): boolean =>
  e.component === 'AbovePrompt' && isOwnPress(e) && e.element !== undefined

function sideHooks(on: On) {
  // The typing box's posts (askbox.tsx): each change keeps the draft, and Enter asks.
  // Its data came from code on the surface, so its shape is checked before use.
  on('ui.message', async ($, e, next) => {
    const isAskBox = e.element === ASK_BOX && (e.requestId === SIDE_PANE || e.component === 'AbovePrompt')
    if (!isAskBox) return next(e)
    const post = e.data as Partial<AskBoxPost> | null
    if (post === null || typeof post !== 'object' || typeof post.text !== 'string') return {}
    const text = post.text
    if (post.kind === 'draft') await update($, side, (s) => ({ ...s, draft: text }))
    else if (post.kind === 'ask') await askSide($, text)
    return {}
  })

  // The Ask box can't see the keyboard, so every move the engine reports tells it: one that lands
  // on another site, or on something of the Band's that is not this mod's, means it left.
  on('ui.focus', async ($, e, next) => {
    const out = await next(e)
    const isOwnBandElement = isOwnBandFocus(e)
    // Hidden, there is no Ask box to tell, and a write would redraw the Band for nothing. The desktop has no Side question at all.
    const isMove = out.deny === undefined && !isOwnBandElement && !(await isOnDesktop($)) && (await read($, isSideOpen))
    if (isMove) await update($, keyboardLeaves, (n) => n + 1)
    return out
  }).catch(($, e, next) => next(e))

  // The side-question panel: the thread and a typing box.
  on('ui.render', { component: 'Pane', requestId: SIDE_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    if (e.surface === 'desktop') return desktopNotice(els)
    const s = await read($, side)
    const placeholder = placeholderOf(s)
    // The desktop app clipped the field's lower edge: the padding gives it room.
    // Docked, the panel takes its full height and the thread takes the spare rows,
    // which pins the typing box to the bottom. Inline, the frame fits the tree, so no stretch.
    // Spread, not minHeight={undefined}: the desktop app refuses a prop that holds undefined.
    const fullHeight = e.props.placement === 'dock' ? { minHeight: e.props.scroll.bodyRows } : {}
    return (
      <Box key="sidepane" flexDirection="column" alignItems="stretch" paddingBottom={1} {...fullHeight}>
        <Box key="thread" flexDirection="column" flexGrow={1}>
          {s.turns.length === 0 ? (
            <Text key="hint" color="inactive">
              Ask about the main chat. The main agent won't see this.
            </Text>
          ) : null}
          {sideThread(els, s.turns)}
        </Box>
        <Box key="askrow" flexDirection="column" alignItems="stretch" width="100%" paddingY={1}>
          {askField($, els, e.surface, {
            s,
            placeholder,
            isPaneFocused: e.props.isFocused,
            leaves: 0,
            isInBand: false,
          })}
        </Box>
      </Box>
    )
  })
}

export const register = (on: On): void => {
  // Shared events, behind the empty matcher: see the entry file.
  on('session.start', {}, sessionStart).catch(($, e, next) => next(e))
  on('prompt.submit', {}, promptSubmit).catch(($, e, next) => next(e))
  on('session.measure', {}, sessionMeasure).catch(($, e, next) => next(e))
  on('turn.step', {}, turnStep).catch(async function* ($, e, next) {
    return yield* next(e)
  })
  on('turn.complete', {}, turnComplete).catch(($, e, next) => next(e))
  stopHooks(on)
  handoffHooks(on)
  pressHooks(on)
  bandHooks(on)
  sideHooks(on)
}
