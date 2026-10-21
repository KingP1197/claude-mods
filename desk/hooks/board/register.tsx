// The agent board: a side panel with one card per subagent of the current batch.
// It opens by itself when a batch starts (an agent spawns while none runs); /agent-board reopens it.
// Top: three cards with the batch's agent count, tokens used in all, and time from first start to last end.
// Then Live and Finished sections. Each card: a pixel critter whose hat shows the effort level, the task's
// name, agent type, effort level and model, the agent's to-do progress when it keeps a list, its context share, tokens and
// time, and a bar. A click on the name shows the brief, the token detail, the agent's Transcript,
// a box to message it, and a Stop button while it runs.
// Hooks the board shares with another area (session.start, session.measure, turn.step, turn.complete, agent.spawn)
// are exported as handlers, and ../register.tsx registers them; `register` below holds the rest.
import { atom, read, update } from 'claude-code'
import type { Chunk, ElementTable, EngineInterface, On, RenderSurface } from 'claude-code'

import {
  isOwnPress,
  takenByPressHook,
  type EventIn,
  type EventOut,
  type PlainNext,
  type StreamingNext,
} from '../handler'
import { because, errorText, failToast } from '../failures'
import { isLive } from '../live'
import { inputOf, svgOf } from '../surface'
import type { AgentReport, AgentRow, CardSections, Chat, TranscriptLine, SentLine } from '../../types'
import {
  BAR_KEY,
  COMMAND,
  type SectionName,
  MARK,
  NUDGE,
  PANE,
  PART_SEP,
  TOOL,
  TOOL_SPEC,
  TITLE,
  barKindOf,
  cardLine,
  clockText,
  fail,
  ok,
  prettyModel,
  refusalNote,
  progress,
  short,
  statParts,
  stepsFromReport,
  stepsFromTodos,
  type Tier,
  tierOf,
  tokenParts,
  tokensLine,
  totals,
} from './agents'
import {
  type Fact,
  apply,
  highestCounter,
  newCard,
  nextNumber,
  noted,
  orphanIds,
  pruned,
  reconcile,
  startBatch,
  whereTo,
  waitingFor,
  withEarly,
  withoutApplied,
} from './book'
import { FILL_FAILED, FILL_RAISED } from './colors'
import { BAR_H, CRITTER_H, CRITTER_W, barSvg, critterSvg, hatColor } from './critter'
import {
  type MetaParts,
  type TitleParts,
  cutMiddle,
  headerCells,
  metaParts,
  numsRow,
  partRows,
  targetRoom,
  titleParts,
} from './header'
import { BOARD_DOING, boardKey, boardPressOf, type Pressed } from './keys'
import {
  BRIEF_CHARS,
  DIVIDER_H,
  briefShown,
  isThoughtOpen,
  dividerSvg,
  isCallOpen,
  ruleLabel,
  ruleTail,
  sectionsOf,
  toggled,
} from './sections'
import {
  BLANK_ICON,
  type Dot,
  GUTTER_W,
  ICON_SIZE,
  ROW_H,
  capped,
  childOf,
  dotSvg,
  elbowSvg,
  entriesOf,
  firstShown,
  isHung,
  isThinkingMissing,
  lineSvg,
  newChat,
  openedSource,
  thoughtsOf,
  toolIcon,
  wrappedRows,
} from './transcript'

// The validator reads state only through atoms declared in this file.
const agents = atom({ plugin: 'desk', key: 'agents' } as const, [] as AgentRow[])
const early = atom({ plugin: 'desk', key: 'early' } as const, { byAgent: {}, next: 0 })
const openAgent = atom({ plugin: 'desk', key: 'openAgent' } as const, null)
const now = atom({ plugin: 'desk', key: 'boardNow' } as const, 0)
const effort = atom({ plugin: 'desk', key: 'effort' } as const, null)
const contextWindow = atom({ plugin: 'desk', key: 'window' } as const, null as number | null)
const isFinishedShown = atom({ plugin: 'desk', key: 'isFinishedShown' } as const, true)
const chat = atom({ plugin: 'desk', key: 'chat' } as const, null as Chat | null)
const sectionLog = atom({ plugin: 'desk', key: 'sections' } as const, {} as Record<string, CardSections>)
const sentLog = atom({ plugin: 'desk', key: 'sent' } as const, {} as Record<string, SentLine[]>)

/** A saved Chat with its defaults filled: one saved by an older board may lack a count or a mark. */
function chatOf(c: Chat | null): Chat | null {
  if (c === null) return null
  const saved: Partial<Chat> = c
  return {
    ...c,
    dropped: saved.dropped ?? 0,
    isUnread: saved.isUnread ?? false,
    isThinkingMissing: saved.isThinkingMissing ?? false,
    sent: saved.sent ?? 0,
  }
}

// The one clock the cards count from. It only moves forward.
function advance($: EngineInterface, t: number) {
  return update($, now, (n) => Math.max(n, t))
}

// Each second: while any agent runs, move the clock and fold in the engine's agent list. The open card reads
// its agent's messages every second either way, as one opened in the app's own window can still be talked to.
async function tick($: EngineInterface) {
  const rows = await read($, agents)
  if (rows.some(isLive)) {
    const t = await $.clock.now()
    // No list this second: the rows keep their state and the clock still moves.
    const infos = await $.agent.list().catch(() => null)
    if (infos !== null) await update($, agents, (list) => reconcile(list, infos, t))
    await advance($, t)
  }
  const shown = await read($, openAgent)
  const agentId = rows.find((r) => r.id === shown)?.agentId ?? null
  if (agentId === null) return
  // A card opened while Starting has no Chat; the spawn's answer gave it an agent, so its Transcript starts now.
  if ((await read($, chat))?.agentId !== agentId)
    await update($, chat, (c) => (c?.agentId === agentId ? c : newChat(agentId)))
  await loadChat($, agentId)
}

/** Reads the open card's agent's conversation into the chat view as Transcript entries, if that card is still the open one. */
async function loadChat($: EngineInterface, agentId: string) {
  const [found, api, allSent, cwd, rows] = await Promise.all([
    $.session.messages({ agentId }).catch(() => null),
    $.session.messages({ agentId, as: 'api' }).catch(() => null),
    read($, sentLog),
    $.session.cwd().catch(() => null),
    read($, agents),
  ])
  const brief = rows.find((r) => r.agentId === agentId)?.task ?? null
  const sentHere = allSent[agentId] ?? []
  const isUnread = !Array.isArray(found)
  // Unread and nothing sent from here: nothing to show. Unread with sends: just the user's own lines.
  const thinks = rows.find((r) => r.agentId === agentId)?.effort != null
  const thoughts = Array.isArray(found) && Array.isArray(api) ? thoughtsOf(found, api) : undefined
  const held =
    isUnread && sentHere.length === 0 ? null : capped(entriesOf(isUnread ? [] : found, sentHere, cwd, brief, thoughts))
  await update($, chat, (c) =>
    c?.agentId === agentId
      ? {
          ...c,
          lines: held?.lines ?? null,
          dropped: held?.dropped ?? 0,
          isUnread,
          isThinkingMissing: isThinkingMissing(api, thinks),
        }
      : c,
  )
}

// Whether the board had the keyboard at its last drawing. The desktop app spends a first click on an
// unfocused board on focusing it and sends the button no press, so the focus hook presses it instead.
let isBoardFocused = false

/** Runs a card-bound button: the card's name, an Agent call's row (the child's card), or the card's Stop. The card
 *  is read now, not when the button was drawn. */
async function pressOnCard($: EngineInterface, id: string, isStop: boolean) {
  const r = (await read($, agents)).find((x) => x.id === id)
  if (r === undefined) return
  if (!isStop) return toggleCard($, r)
  if (r.agentId !== null && isLive(r)) return stopAgent($, r.agentId)
}

/** The board's one press table: what the button drawn with `key` does. The board's `ui.press` hook and a first click on
 *  the unfocused board, which arrives only as focus landing on the key, both run it. A press the engine refuses
 *  (every action reads or writes saved state, so any can) is told to the user: the press hook's catch would
 *  otherwise hand it on to a do-nothing closure. */
async function press($: EngineInterface, key: string | undefined) {
  const p = boardPressOf(key)
  if (p === null) return
  await pressed($, p).catch((err: unknown) => {
    $.ui.toast(failToast(BOARD_DOING[p.kind], errorText(err)))
  })
}

async function pressed($: EngineInterface, p: Pressed) {
  switch (p.kind) {
    case 'finished':
      return update($, isFinishedShown, (v) => !v)
    case 'name':
    case 'child':
    case 'stop':
      return pressOnCard($, p.id, p.kind === 'stop')
    default:
      return update($, sectionLog, (saved) => toggled(saved, p))
  }
}

/** Opens a card, or closes it when it is the open one. Opening reads its agent's last messages. */
async function toggleCard($: EngineInterface, r: AgentRow) {
  let isOpening = false
  await update($, openAgent, (cur) => {
    isOpening = cur !== r.id
    return isOpening ? r.id : null
  })
  const fresh: Chat | null = isOpening && r.agentId !== null ? newChat(r.agentId) : null
  await update($, chat, () => fresh)
  if (fresh !== null) await loadChat($, fresh.agentId)
}

function noteChat($: EngineInterface, agentId: string, note: string, isSent = false) {
  return update($, chat, (saved) => {
    const c = chatOf(saved)
    return c?.agentId === agentId ? { ...c, note, sent: c.sent + (isSent ? 1 : 0) } : saved
  })
}

/** A call that threw reads as a refusal with the error as its reason. */
const thrownAsDeny = (err: unknown) => ({ deny: errorText(err) })

/** Sends the user's message to the agent. A running agent gets it as a plain user message in its conversation,
 *  as the built-in agent window's messages read; a finished one (or a refused append) gets it delivered, which
 *  wakes it, so its card runs again. */
async function sendTo($: EngineInterface, agentId: string, isRunning: boolean, typed: string) {
  const text = typed.trim()
  if (text === '') return
  // Where it goes among the agent's messages, counted before it is sent.
  const before = await $.session.messages({ agentId }).catch(() => null)
  const line: SentLine = { text, after: Array.isArray(before) ? before.length : 0 }
  const remember = () => update($, sentLog, (all) => ({ ...all, [agentId]: [...(all[agentId] ?? []), line] }))
  if (isRunning) {
    const added = await $.session
      .append({ agentId, message: { type: 'user', content: [{ type: 'text', text }] } })
      .catch(thrownAsDeny)
    if (added.deny === undefined) {
      await remember()
      await noteChat($, agentId, 'Added to its conversation. It reads it at its next step.', true)
      return loadChat($, agentId)
    }
  }
  const delivery = await $.session.send({ to: { agentId }, text }).catch((err: unknown) => ({
    isDelivered: false as const,
    reason: errorText(err),
  }))
  if (!delivery.isDelivered) return noteChat($, agentId, refusalNote('SendMessage', delivery.reason))
  await remember()
  await noteChat($, agentId, 'Sent. It reads it at its next step.', true)
  await changeCard($, agentId, { kind: 'resumed' }, await $.clock.now())
  await loadChat($, agentId)
}

/** Stops the agent through Claude's own stop tool. The call goes through the user's permission settings as is. */
async function stopAgent($: EngineInterface, agentId: string) {
  await noteChat($, agentId, 'Stopping…')
  const out = await $.tool.call({ tool: 'TaskStop', task_id: agentId }).catch(thrownAsDeny)
  const refused = 'deny' in out ? out.deny : out.isError === true ? out.text : undefined
  if (refused !== undefined) return noteChat($, agentId, refusalNote('TaskStop', refused))
  const t = await $.clock.now()
  await changeCard($, agentId, { kind: 'stopped' }, t)
  await noteChat($, agentId, 'Stopped.')
}

/** Applies a fact to the card linked to `agentId`. */
function changeCard($: EngineInterface, agentId: string, fact: Fact, t: number) {
  return update($, agents, (list) => apply(list, { agentId }, fact, t))
}

/** Opens the board, or says why it could not. */
async function openBoard($: EngineInterface): Promise<string> {
  const r = await $.ui.open({ id: PANE, title: TITLE })
  return r.isPlaced ? 'Agent board opened.' : `Could not open the agent board ${because(errorText(r.reason))}.`
}

/** Takes out of the early store the reports their cards have applied. It runs only after the card is saved, so a
 *  reload between the two saves loses no report: the card keeps it, and the next take skips it. */
async function dropApplied($: EngineInterface) {
  const rows = await read($, agents)
  await update($, early, (store) => withoutApplied(store, rows))
}

/** Applies the reports still waiting for `agentId`'s card to it, then takes them out of the early store. */
async function catchUp($: EngineInterface, agentId: string) {
  const reports = waitingFor(await read($, early), agentId)
  if (reports.length === 0) return
  await update($, agents, (list) => withEarly(list, agentId, reports))
  await dropApplied($)
}

/** Drops the early reports no card can take any more. Only reports from before the cards were read can go. */
async function prune($: EngineInterface) {
  const before = nextNumber(await read($, early))
  const rows = await read($, agents)
  await update($, early, (store) => pruned(store, rows, before))
}

/** Records what an agent reported: on its card once its spawn has answered, else in the early store, with its time. */
async function tell($: EngineInterface, agentId: string, report: AgentReport) {
  const t = await $.clock.now()
  // Held in an object: TypeScript would read a plain variable as still 'nowhere', not seeing the write inside update.
  const found: { where: ReturnType<typeof whereTo> } = { where: 'nowhere' }
  await update($, agents, (list) => {
    found.where = whereTo(list, agentId)
    return found.where === 'card' ? apply(list, { agentId }, report, t) : list
  })
  if (found.where !== 'early') return
  await update($, early, (store) => noted(store, agentId, report, t))
  // Its spawn may have answered while the report was being saved; then the card takes it now.
  if ((await read($, agents)).some((r) => r.agentId === agentId)) await catchUp($, agentId)
}

// A model request's start says the model and effort it runs on. The main thread's
// effort is the session's; a subagent's own requests replace the guess on its card.
async function noteStep($: EngineInterface, agentId: string | undefined, model: string, lvl: string | null) {
  if (agentId !== undefined) return tell($, agentId, { kind: 'step', model, effort: lvl })
  if (lvl !== null && lvl !== (await read($, effort))) await update($, effort, () => lvl)
}

/** The new task's id in a TaskCreate result, read with care: the result's shape is the tool's. */
function createdId(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const task = (result as { task?: { id?: unknown } }).task
  return typeof task?.id === 'string' ? task.id : null
}

// Every value the board draws, and where it is drawn.
type Board = {
  rows: readonly AgentRow[]
  shown: string | null
  chat: Chat | null
  sections: Record<string, CardSections>
  t: number
  window: number | null
  isFinishedShown: boolean
  surface: RenderSurface
  bodyColumns: number
}

function statCard(els: ElementTable, k: string, label: string, value: string) {
  const { Box, Text } = els
  return (
    <Box key={k} flexDirection="column" flexGrow={1} borderStyle="round" paddingX={1}>
      <Text key="label" color="inactive">
        {label}
      </Text>
      <Text key="value" bold>
        {value}
      </Text>
    </Box>
  )
}

function statCards(els: ElementTable, b: Board) {
  const { Box } = els
  const sum = totals(b.rows, b.t)
  return (
    <Box key="cards" flexDirection="row" gap={1}>
      {statCard(els, 'c-agents', 'Agents', `${sum.count}`)}
      {statCard(els, 'c-tokens', 'Tokens', short(sum.tokens))}
      {statCard(els, 'c-time', 'Time', clockText(sum.spanMs))}
    </Box>
  )
}

// The critter, off the terminal only: the terminal draws no pictures.
function critter(els: ElementTable, b: Board, r: AgentRow, tier: Tier) {
  const Svg = svgOf(b.surface, els)
  if (Svg === null) return null
  const isFaded = r.state === 'failed' || r.state === 'stopped' || r.state === 'lost'
  return (
    <Svg
      key="pic"
      source={critterSvg(tier.hat, isFaded)}
      alt={`${tier.label} critter`}
      width={CRITTER_W}
      height={CRITTER_H}
    />
  )
}

// How many cells a Card's content has: its width less the four its border and padding take (two a side).
const insideCard = (b: Board) => Math.max(10, b.bodyColumns - 4)

// The cells a message's timeline takes beside its text: on desktop the 16px gutter (about two) and the gap; in the
// terminal a `│` and the gap.
const GUTTER_COLUMNS = 3
const BAR_COLUMNS = 2

// How many rows a message's text takes beside its timeline, by wrapping its words at the cells left of it.
const textRows = (b: Board, text: string) =>
  wrappedRows(text, insideCard(b) - (b.surface === 'terminal' ? BAR_COLUMNS : GUTTER_COLUMNS))

// The progress bar: a picture off the terminal, a run of line cells on it. None while progress is unknown.
function bar(els: ElementTable, b: Board, r: AgentRow) {
  const { Box, Text } = els
  const f = progress(r)
  if (f === null) return null
  const kind = barKindOf(r.state)
  const Svg = svgOf(b.surface, els)
  if (Svg !== null) {
    const alt = r.state === 'done' ? 'Finished' : `${Math.round(f * 100)}% of its to-do list done`
    return (
      <Box key="bar" flexDirection="column" marginTop={1}>
        <Svg key="barsvg" source={barSvg(f, kind)} alt={alt} height={BAR_H} />
      </Box>
    )
  }
  const cells = insideCard(b)
  const full = Math.round(f * cells)
  return (
    <Box key="bar" flexDirection="row">
      <Text key="on" color={BAR_KEY[kind]}>
        {'━'.repeat(full)}
      </Text>
      <Text key="off" color="subtle">
        {'─'.repeat(cells - full)}
      </Text>
    </Box>
  )
}

// The terminal's Card edge takes no padding, so its rules meet the edge. What sits between the rules takes the
// padding itself; on desktop the Card's own padding does.
const insetOf = (b: Board) => (b.surface === 'terminal' ? ({ paddingX: 1 } as const) : ({} as const))

// How many cells a terminal rule fills: the Card's width less its two edge characters.
const ruleCells = (b: Board) => Math.max(10, b.bodyColumns - 2)

// The line that opens the footer: a picture off the terminal; on it a bare rule from edge to edge.
function footerRule(els: ElementTable, b: Board) {
  const { Box, Text } = els
  const Svg = svgOf(b.surface, els)
  if (Svg !== null) {
    return (
      <Box key="divider:footer" flexDirection="column" marginTop={1}>
        <Svg key="line" source={dividerSvg()} alt="Divider" height={DIVIDER_H} />
      </Box>
    )
  }
  return (
    <Box key="divider:footer" flexDirection="row" marginTop={1}>
      <Text key="start" color="subtle">
        {`├${ruleTail(ruleCells(b), '')}┤`}
      </Text>
    </Box>
  )
}

// The line that opens a closable section, with its heading: a chevron that closes it, the name in bold, and any
// count after it. Off the terminal that is a divider picture over the heading; in the terminal a titled rule
// from edge to edge, `├─ ▾ Brief ───┤`, the dimmest grey but for the bold title.
function sectionHead(
  $: EngineInterface,
  els: ElementTable,
  b: Board,
  r: AgentRow,
  which: SectionName,
  title: string,
  count: number | null = null,
) {
  const { Box, Text, Button } = els
  const isOpen =
    which === 'brief' ? sectionsOf(b.sections, r.id).isBriefOpen : sectionsOf(b.sections, r.id).isTranscriptOpen
  const key = boardKey({ kind: 'section', id: r.id, which })
  const chevron = <Button key={key} plain dimColor label={isOpen ? '▾' : '▸'} onPress={takenByPressHook} />
  const Svg = svgOf(b.surface, els)
  if (Svg !== null) {
    return [
      <Box key={`divider:${which}`} flexDirection="column" marginTop={1}>
        <Svg key="line" source={dividerSvg()} alt="Divider" height={DIVIDER_H} />
      </Box>,
      <Box key={`heading:${which}`} flexDirection="row" gap={1} marginTop={1}>
        {chevron}
        <Text key="title" bold>
          {title}
        </Text>
        {count === null ? null : (
          <Text key="count" color="inactive">
            {`${count}`}
          </Text>
        )}
      </Box>,
    ]
  }
  const label = ruleLabel(title, count)
  return [
    <Box key={`divider:${which}`} flexDirection="row" marginTop={1}>
      <Text key="start" color="subtle">
        ├─{' '}
      </Text>
      {chevron}
      <Text key="head" bold>
        {label.slice(2)}
      </Text>
      <Text key="end" color="subtle">
        {`${ruleTail(ruleCells(b), label)}┤`}
      </Text>
    </Box>,
  ]
}

// Under an opened card's header: the Brief section, its divider reaching the Card's edges.
function briefSection($: EngineInterface, els: ElementTable, b: Board, r: AgentRow) {
  const { Box, Text, Button } = els
  const sections = sectionsOf(b.sections, r.id)
  const more = boardKey({ kind: 'more', id: r.id })
  return [
    ...sectionHead($, els, b, r, 'brief', 'Brief'),
    sections.isBriefOpen ? (
      <Box key="brief-body" flexDirection="column" {...insetOf(b)}>
        <Text key="brief" color="inactive" wrap="wrap">
          {briefShown(r.task, sections.isBriefWhole)}
        </Text>
        {r.task.length > BRIEF_CHARS ? (
          <Button
            key={more}
            plain
            dimColor
            label={sections.isBriefWhole ? 'Show less' : 'Show whole brief'}
            onPress={takenByPressHook}
          />
        ) : null}
      </Box>
    ) : null,
  ]
}

// Where one entry sits among the rows drawn: the entries, the first one drawn, and whether the agent runs (a waiting one writes nothing).
type Flow = { card: string; lines: readonly TranscriptLine[]; first: number; isRunning: boolean }

// The start of a row that hangs off the timeline, a Tool call or a Thought: the elbow (in the terminal `├─`, or `└─`
// for the last of its run), the icon of the tool of that name and the name.
function rowLead(els: ElementTable, b: Board, flow: Flow, i: number, name: string, isLive = false) {
  const { Text } = els
  const Svg = svgOf(b.surface, els)
  const picture = toolIcon(name)
  return [
    Svg === null ? (
      <Text key="mark" color="subtle">
        {isHung(flow.lines[i + 1]) ? '├─' : '└─'}
      </Text>
    ) : (
      <Svg key="elbow" source={elbowSvg(i < flow.lines.length - 1)} alt="Tool call" width={GUTTER_W} height={ROW_H} />
    ),
    Svg === null ? null : (
      <Svg
        key="icon"
        source={(picture ?? BLANK_ICON).source}
        alt={(picture ?? BLANK_ICON).alt}
        width={ICON_SIZE}
        height={ICON_SIZE}
      />
    ),
    isLive ? (
      <Text key="name" color="claude" bold>
        {name}
      </Text>
    ) : (
      <Text key="name">{name}</Text>
    ),
  ]
}

/** What ends a Tool call's row after its target: `✗ Failed`, the child's state mark, or what came back; null where nothing does. */
function tailOf(
  l: Extract<TranscriptLine, { kind: 'tool' }>,
  child: AgentRow | null,
  isLive: boolean,
): { text: string; color: string; isBold: boolean } | null {
  if (l.isFailed) return { text: '✗ Failed', color: 'error', isBold: true }
  if (isLive) return null
  if (child !== null) {
    const mark = MARK[child.state]
    return { text: `${mark.glyph} ${mark.word}`, color: mark.color, isBold: false }
  }
  return l.summary ? { text: l.summary, color: 'inactive', isBold: false } : null
}

/** The cells a Tool call's target may take in its row, from the Card's inside. */
const roomOf = (b: Board, name: string, tail: ReturnType<typeof tailOf>, hasChevron: boolean): number =>
  targetRoom(insideCard(b), b.surface === 'terminal', name, tail === null ? null : tail.text, hasChevron)

/** How a Tool call's row ends: whose Card an Agent call opens, whether the call is in flight, its tail, and the cells its target may take. */
type Tail = { child: AgentRow | null; isLive: boolean; tail: ReturnType<typeof tailOf>; room: number }

/** The button an Agent call's target becomes: it opens the child's Card. */
function childButton($: EngineInterface, els: ElementTable, child: AgentRow, label: string) {
  const { Button } = els
  const key = boardKey({ kind: 'child', id: child.id })
  return <Button key={key} plain dimColor label={label} onPress={takenByPressHook} />
}

// The end of a Tool call's row: what it touched, cut in the middle to the cells the row leaves it, then the tail.
function toolTail($: EngineInterface, els: ElementTable, l: Extract<TranscriptLine, { kind: 'tool' }>, t: Tail) {
  const { Box, Text } = els
  const { child } = t
  const target = l.target ? cutMiddle(l.target, t.room) : null
  return [
    target ? (
      <Box key="target" flexShrink={1} flexGrow={1} minWidth={0}>
        {child === null ? (
          <Text {...(t.isLive ? { color: 'claude', bold: true } : { color: 'inactive' })}>{target}</Text>
        ) : (
          childButton($, els, child, target)
        )}
      </Box>
    ) : null,
    t.tail === null ? null : (
      <Box key={l.isFailed ? 'failed' : 'summary'} flexShrink={0}>
        <Text color={t.tail.color} bold={t.tail.isBold}>
          {t.tail.text}
        </Text>
      </Box>
    ),
  ]
}

// What an opened Tool call shows, indented under its row: in the terminal a failed one's output as plain lines, else
// the engine's Code element.
function toolDetail(els: ElementTable, b: Board, l: Extract<TranscriptLine, { kind: 'tool' }>) {
  const { Box, Text, Code } = els
  const source = openedSource(l)
  return (
    <Box key="detail" marginLeft={4} flexDirection="column">
      {l.isFailed && b.surface === 'terminal' ? (
        source.split('\n').map((line, n) => (
          <Text key={`out${n}`} wrap="wrap">
            {line}
          </Text>
        ))
      ) : (
        <Code source={source} />
      )}
    </Box>
  )
}

// Whether a Tool call has anything to open. A call in flight has no result to open yet. A failed call opens to its
// output alone, so with none it has nothing to open.
const hasDetail = (l: Extract<TranscriptLine, { kind: 'tool' }>, isLive: boolean) =>
  !isLive && (l.isFailed ? !!l.output : !!(l.input || l.output))

// A Tool call hangs off the timeline. With something to show it has a chevron that opens it; a failed one starts open
// on the failed fill, off the terminal. While the agent runs, a call in flight draws in Claude colour.
function toolEntry(
  $: EngineInterface,
  els: ElementTable,
  b: Board,
  flow: Flow,
  i: number,
  l: Extract<TranscriptLine, { kind: 'tool' }>,
) {
  const { Box, Button } = els
  const key = boardKey({ kind: 'call', id: flow.card, callId: l.id })
  // An Agent call whose child the board holds draws as an Agent call, in flight or not.
  const child = childOf(b.rows, flow.card, l)
  const isLive = flow.isRunning && l.isInFlight === true && child === null
  const isOpenable = hasDetail(l, isLive)
  const isOpen = isOpenable && isCallOpen(b.sections, flow.card, l.id, l.isFailed)
  const tail = tailOf(l, child, isLive)
  const room = roomOf(b, l.name, tail, isOpenable)
  return (
    <Box
      key="call"
      flexDirection="column"
      {...(l.isFailed && b.surface !== 'terminal' ? { backgroundColor: FILL_FAILED } : {})}
    >
      <Box key="tool" flexDirection="row" gap={1}>
        {rowLead(els, b, flow, i, l.name, isLive)}
        {toolTail($, els, l, { child, isLive, tail, room })}
        {isOpenable ? <Button key={key} plain dimColor label={isOpen ? '▾' : '▸'} onPress={takenByPressHook} /> : null}
      </Box>
      {isOpen ? toolDetail(els, b, l) : null}
    </Box>
  )
}

// A Thought hangs off the timeline like a Tool call, closed to its name and a chevron.
function thoughtEntry(
  $: EngineInterface,
  els: ElementTable,
  b: Board,
  flow: Flow,
  i: number,
  l: Extract<TranscriptLine, { kind: 'thought' }>,
) {
  const { Box, Text, Button } = els
  const isOpen = isThoughtOpen(b.sections, flow.card, l.id)
  const key = boardKey({ kind: 'thought', id: flow.card, thoughtId: l.id })
  return (
    <Box key="thought" flexDirection="column">
      <Box key="tool" flexDirection="row" gap={1}>
        {rowLead(els, b, flow, i, 'Thought')}
        <Box key="room" flexGrow={1} />
        <Button key={key} plain dimColor label={isOpen ? '▾' : '▸'} onPress={takenByPressHook} />
      </Box>
      {isOpen ? (
        <Box key="detail" marginLeft={4} flexDirection="column">
          <Text wrap="wrap">{l.body}</Text>
          {l.more > 0 ? <Text key="more" color="inactive">{`… ${l.more} more characters`}</Text> : null}
        </Box>
      ) : null}
    </Box>
  )
}

// What leads a message's first row: its dot, or in the terminal `⏺` or `>`.
function messageMark(els: ElementTable, b: Board, flow: Flow, i: number, dot: Dot) {
  const { Text } = els
  const Svg = svgOf(b.surface, els)
  if (Svg === null)
    return (
      <Text key="mark" color={dot === 'writing' ? 'claude' : 'inactive'}>
        {dot === 'user' ? '>' : '⏺'}
      </Text>
    )
  return (
    <Svg
      key="dot"
      source={dotSvg(dot, i > flow.first)}
      alt={dot === 'user' ? 'Your message' : 'Agent message'}
      width={GUTTER_W}
      height={ROW_H}
    />
  )
}

// A message's first row: its mark, its label, and `Writing…` while the agent writes it.
function messageHead(els: ElementTable, b: Board, flow: Flow, i: number, l: Extract<TranscriptLine, { text: string }>) {
  const { Box, Text } = els
  const isAgent = l.kind === 'agent'
  // The agent is writing the newest message while it runs and nothing has followed it.
  const isWriting = flow.isRunning && isAgent && i === flow.lines.length - 1
  return (
    <Box key="head" flexDirection="row" gap={1}>
      {messageMark(els, b, flow, i, isWriting ? 'writing' : isAgent ? 'agent' : 'user')}
      <Text key="who" color={isAgent ? 'claude' : 'text'} bold>
        {isAgent ? 'Agent' : 'You'}
      </Text>
      {isWriting ? (
        <Text key="writing" color="claude" bold>
          Writing…
        </Text>
      ) : null}
    </Box>
  )
}

// In the terminal, the line beside a message of more than one row: a `│` for each row while another row follows, else
// blank cells to keep the text in line. A one-row message has none; the `│` below it joins it to the next entry.
function timelineBars(els: ElementTable, rows: number, hasBelow: boolean) {
  const { Box, Text } = els
  if (rows < 2) return null
  return (
    <Box key="bars" flexDirection="column">
      {Array.from({ length: rows }, (_, n) => (
        <Text key={`bar${n}`} color="subtle">
          {hasBelow ? '│' : ' '}
        </Text>
      ))}
    </Box>
  )
}

// A message hangs on a dot: filled grey for the agent's, hollow for the user's, orange while the agent writes it.
function messageEntry(
  els: ElementTable,
  b: Board,
  flow: Flow,
  i: number,
  l: Extract<TranscriptLine, { text: string }>,
) {
  const { Box, Text } = els
  const Svg = svgOf(b.surface, els)
  const rows = textRows(b, l.text)
  const hasBelow = i < flow.lines.length - 1
  return (
    <Box key="message" flexDirection="column">
      {messageHead(els, b, flow, i, l)}
      <Box key="body" flexDirection="row" gap={1}>
        {Svg === null ? (
          timelineBars(els, rows, hasBelow)
        ) : (
          <Svg key="line" source={lineSvg(hasBelow, rows)} alt="Timeline" width={GUTTER_W} height={rows * ROW_H} />
        )}
        <Text key="said" wrap="wrap">
          {l.text}
        </Text>
      </Box>
    </Box>
  )
}

// One entry of the Transcript. In the terminal a `│` follows it where the line goes on to a message.
function entry($: EngineInterface, els: ElementTable, b: Board, flow: Flow, i: number) {
  const { Box, Text } = els
  const l = flow.lines[i]
  const next = flow.lines[i + 1]
  if (l === undefined) return null
  // A message of more than one row carries its own line down its side, so it needs no `│` below.
  const isBarred = !isHung(l) && textRows(b, l.text) > 1
  const joint =
    b.surface !== 'terminal' || next === undefined || isHung(next) || isBarred ? null : (
      <Text key="joint" color="subtle">
        │
      </Text>
    )
  return (
    <Box key={`line${i}`} flexDirection="column">
      {l.kind === 'tool'
        ? toolEntry($, els, b, flow, i, l)
        : l.kind === 'thought'
          ? thoughtEntry($, els, b, flow, i, l)
          : messageEntry(els, b, flow, i, l)}
      {joint}
    </Box>
  )
}

// What the opened card has read of the agent's conversation.
function chatLines($: EngineInterface, els: ElementTable, b: Board, r: AgentRow, c: Chat | null) {
  const { Box, Text, Button } = els
  if (c === null) return null
  const unread = (
    <Text key="unread" color="inactive" wrap="wrap">
      Its messages can't be read here.
    </Text>
  )
  if (c.lines === null) return unread
  const lines = c.lines
  if (lines.length === 0)
    return (
      <Text key="unread" color="inactive">
        No messages yet.
      </Text>
    )
  const isAll = sectionsOf(b.sections, r.id).isEarlierShown
  const earlier = boardKey({ kind: 'earlier', id: r.id })
  const first = firstShown(lines.length, isAll)
  const body = (
    <Box key="lines" flexDirection="column">
      {c.isThinkingMissing ? (
        <Text key="thinking-missing" color="inactive">
          Thinking is not available for this agent
        </Text>
      ) : null}
      {c.dropped > 0 ? (
        <Text key="dropped" color="inactive">
          {`Earlier entries dropped: ${c.dropped}.`}
        </Text>
      ) : null}
      {firstShown(lines.length, false) > 0 ? (
        <Button
          key={earlier}
          plain
          dimColor
          label={isAll ? 'Show fewer' : `Show ${first} earlier`}
          onPress={takenByPressHook}
        />
      ) : null}
      {lines.map((_, i) =>
        i < first ? null : entry($, els, b, { card: r.id, lines, first, isRunning: r.state === 'running' }, i),
      )}
    </Box>
  )
  // The user's own messages still show, under a note that the agent's could not be read.
  return c.isUnread ? (
    <Box key="chat" flexDirection="column">
      {unread}
      {body}
    </Box>
  ) : (
    body
  )
}

// The box to message the agent. The phone draws no text field (its table's Input draws nothing), so there it says where to type instead.
function sayBox($: EngineInterface, els: ElementTable, b: Board, r: AgentRow, agentId: string, c: Chat | null) {
  const Input = inputOf(b.surface, els)
  if (Input === null)
    return (
      <els.Text key="say-elsewhere" color="inactive" wrap="wrap">
        Message it from the desktop app or the terminal.
      </els.Text>
    )
  // A fresh key after each send draws an empty box.
  return (
    <Input
      key={`say:${r.id}:${c?.sent ?? 0}`}
      placeholder={isLive(r) ? 'Message this agent' : 'Message it to pick up again'}
      submitLabel="send"
      onSubmit={(text: string) => void sendTo($, agentId, isLive(r), text)}
    />
  )
}

// The footer of an opened card: its rule, the box to message the agent, and Stop while it runs, and the last send's note.
function footer($: EngineInterface, els: ElementTable, b: Board, r: AgentRow, agentId: string, c: Chat | null) {
  const { Box, Text, Button } = els
  const stop = boardKey({ kind: 'stop', id: r.id })
  return [
    footerRule(els, b),
    <Box key="say-row" flexDirection="row" gap={1} marginTop={1} {...insetOf(b)}>
      <Box key="say-box" flexGrow={1} flexShrink={1}>
        {sayBox($, els, b, r, agentId, c)}
      </Box>
      {isLive(r) ? <Button key={stop} label="Stop" onPress={takenByPressHook} /> : null}
    </Box>,
    c === null || c.note === null ? null : (
      <Box key="note-room" {...insetOf(b)}>
        <Text key="note" color="inactive" wrap="wrap">
          {c.note}
        </Text>
      </Box>
    ),
  ]
}

// Under an opened card's Brief: the Transcript, then the footer.
function talk($: EngineInterface, els: ElementTable, b: Board, r: AgentRow) {
  const { Box, Text } = els
  if (r.agentId === null)
    return [
      <Box key="talk" {...insetOf(b)}>
        <Text key="starting" color="inactive">
          Starting. Its messages show here once it runs.
        </Text>
      </Box>,
    ]
  const agentId = r.agentId
  const c = b.chat?.agentId === agentId ? b.chat : null
  return [
    ...sectionHead(
      $,
      els,
      b,
      r,
      'transcript',
      'Transcript',
      c === null || c.lines === null ? null : c.lines.length + c.dropped,
    ),
    sectionsOf(b.sections, r.id).isTranscriptOpen ? (
      <Box key="transcript-body" marginTop={1} {...insetOf(b)}>
        {chatLines($, els, b, r, c)}
      </Box>
    ) : null,
    ...footer($, els, b, r, agentId, c),
  ]
}

// The type line: agent type, effort word and model, set apart by dim separators. The header has already cut them to its
// cells (metaParts), and a separator is drawn only between two parts that are drawn. The engine cannot be trusted to
// shrink a row, so the type is not asked to: it is drawn as cut, with no shrink or truncate setting, and the rest of
// the row (the `effort-room` Box) is held at its size.
function typeLine(els: ElementTable, meta: MetaParts) {
  const { Box, Text } = els
  return (
    <Box key="who" flexDirection="row">
      {meta.type === '' ? null : (
        <Text key="type" color="inactive">
          {meta.type}
        </Text>
      )}
      <Box key="effort-room" flexShrink={0}>
        {meta.type === '' ? null : (
          <Text key="sep-type" color="subtle">
            {PART_SEP}
          </Text>
        )}
        {meta.effort === '' ? null : (
          <Text key="tier" color="inactive">
            {meta.effort}
          </Text>
        )}
        {meta.effort === '' ? null : (
          <Text key="sep-model" color="subtle">
            {PART_SEP}
          </Text>
        )}
        <Text key="model" color="inactive">
          {meta.model}
        </Text>
      </Box>
    </Box>
  )
}

// The card's first row: its name, and its state mark at the right edge. In the terminal a hat mark leads the
// name; the name gives way before the state mark does, so a narrow pane keeps the mark.
function titleRow($: EngineInterface, els: ElementTable, b: Board, r: AgentRow, tier: Tier, parts: TitleParts) {
  const { Box, Text, Button } = els
  const mark = MARK[r.state]
  const key = boardKey({ kind: 'name', id: r.id })
  // The label carries the cut name too: the desktop app draws a Button's label, not the Text inside it (the user's
  // 2026-10-15 screenshot showed the whole name pushing the header past the Card's edge); the terminal draws the Text.
  const name = (
    <Button key={key} plain label={parts.name} onPress={takenByPressHook}>
      <Text color="text" bold>
        {parts.name}
      </Text>
    </Button>
  )
  const state = (
    <Box key="mark-box" flexDirection="row" gap={1}>
      <Text key="mark" color={mark.color} bold>
        {mark.glyph}
      </Text>
      <Text key="word" color={mark.color} bold={mark.isWordBold}>
        {parts.word}
      </Text>
    </Box>
  )
  const isHatShown = svgOf(b.surface, els) === null
  return (
    <Box key="top" flexDirection="row" justifyContent="space-between">
      {isHatShown ? (
        <Box key="name-room" flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
          <Text key="hat" color={hatColor(tier.hat) ?? 'inactive'}>
            ▲
          </Text>
          {name}
        </Box>
      ) : (
        name
      )}
      {isHatShown ? (
        <Box key="mark-room" flexShrink={0}>
          {state}
        </Box>
      ) : (
        state
      )}
    </Box>
  )
}

// What makes a card one block. The desktop paints a raised fill with inner padding. The terminal paints no
// see-through fill, so its edge is the engine's round border (╭ ╮ ╰ ╯ │) in the dimmest grey.
const blockOf = (b: Board) =>
  b.surface === 'terminal'
    ? ({ borderStyle: 'round', borderColor: 'subtle' } as const)
    : ({ padding: 1, backgroundColor: FILL_RAISED } as const)

// The Card's stats (`ctx 9% | 992k | 1:43`); they never shrink, so the header counts them out of its cells.
function metricsBox(els: ElementTable, stats: string) {
  const { Box, Text } = els
  return (
    <Box key="metrics" flexShrink={0}>
      <Text key="metrics-text" color="inactive">
        {stats}
      </Text>
    </Box>
  )
}

// The open Card's token line. The terminal wraps it as one Text. The desktop app wraps a Text inside its parts, where a
// row could begin with `|` (the user's 2026-10-15 screenshot), so there the parts share the header's `cells` by rows.
function tokensBox(els: ElementTable, b: Board, r: AgentRow, cells: number) {
  const { Box, Text } = els
  const lines = b.surface === 'terminal' ? [tokensLine(r)] : partRows(tokenParts(r), cells)
  return (
    <Box key="details" flexDirection="column" marginTop={1}>
      {/* A drawn Text loses its key, so the lines sit in a keyed Box. */}
      <Box key="tokens" flexDirection="column">
        {lines.map((line, i) => (
          <Text key={`tokens-${i}`} color="inactive" wrap="wrap">
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

// Where the title cuts the name, the open Card draws all of it once, dim and wrapping, under the title: the design
// foundations keep a way to see the whole of a cut label.
function fullName(els: ElementTable, r: AgentRow, title: TitleParts, isOpen: boolean) {
  const { Box, Text } = els
  if (!isOpen || title.name === r.description || r.description.trim() === '') return null
  return (
    <Box key="full-name">
      <Text color="inactive" wrap="wrap">
        {r.description}
      </Text>
    </Box>
  )
}

function agentCard($: EngineInterface, els: ElementTable, b: Board, r: AgentRow) {
  const { Box, Text } = els
  const tier = tierOf(r.effort)
  const cells = headerCells(b.surface === 'terminal', insideCard(b))
  const { steps, stats, isStacked } = numsRow(cardLine(r), statParts(r, b.t, b.window), cells)
  const isOpen = b.shown === r.id
  const title = titleParts(r.description, r.state, cells)
  return (
    <Box key={`card:${r.id}`} flexDirection="column" marginBottom={1} {...blockOf(b)}>
      <Box key="header" flexDirection="row" gap={1} {...insetOf(b)}>
        {critter(els, b, r, tier)}
        <Box key="body" flexDirection="column" flexGrow={1} flexShrink={1}>
          {titleRow($, els, b, r, tier, title)}
          {fullName(els, r, title, isOpen)}
          {typeLine(
            els,
            metaParts(
              { type: r.type, effort: tier.label, model: prettyModel(r.model) },
              cells,
              svgOf(b.surface, els) !== null,
            ),
          )}
          {/* A long step name gives way, cut short with an ellipsis; the numbers keep one line. */}
          <Box key="nums" flexDirection="row" justifyContent={steps === '' ? 'flex-end' : 'space-between'} gap={1}>
            {steps === '' ? null : (
              <Box key="steps" flexShrink={1} minWidth={0}>
                <Text key="step-text" wrap="truncate-end">
                  {steps}
                </Text>
              </Box>
            )}
            {stats === '' || isStacked ? null : metricsBox(els, stats)}
          </Box>
          {stats === '' || !isStacked ? null : (
            <Box key="stats-row" flexDirection="row" justifyContent="flex-end">
              {metricsBox(els, stats)}
            </Box>
          )}
          {bar(els, b, r)}
          {isOpen ? tokensBox(els, b, r, cells) : null}
        </Box>
      </Box>
      {/* The sections sit below the header, outside its inset, so their dividers reach the Card's edges. */}
      {isOpen ? briefSection($, els, b, r) : null}
      {isOpen ? talk($, els, b, r) : null}
    </Box>
  )
}

function runningSection($: EngineInterface, els: ElementTable, b: Board) {
  const { Box, Text } = els
  const live = b.rows.filter(isLive)
  return (
    <Box key="running" flexDirection="column">
      <Text key="head" color="inactive">{`Live | ${live.length}`}</Text>
      {live.map((r) => agentCard($, els, b, r))}
    </Box>
  )
}

function finishedSection($: EngineInterface, els: ElementTable, b: Board) {
  const { Box, Button } = els
  const ended = b.rows.filter((r) => !isLive(r))
  if (ended.length === 0) return null
  const finished = boardKey({ kind: 'finished' })
  return (
    <Box key="finished" flexDirection="column">
      <Button
        key={finished}
        plain
        dimColor
        label={`${b.isFinishedShown ? '▾' : '▸'} Finished | ${ended.length}`}
        onPress={takenByPressHook}
      />
      {b.isFinishedShown ? ended.map((r) => agentCard($, els, b, r)) : null}
    </Box>
  )
}

// Hooks that gate an event end in .catch(... next(e)): if one throws, the event goes on as if
// this plugin were absent, and a next() it already made is replayed, never run twice.

// The board's links between events, rebuilt on every load (register resets them).
let seq = 0
// The ids of the cards whose spawn this copy of the board is waiting on. A card still waiting that is not here was
// begun by a copy a reload replaced. UNVERIFIED: that the old copy's hook stops and nothing will answer for the card;
// the engine's docs say only that a reload cancels a plugin's pending clock waits (see orphanIds in book.ts). Safe
// either way once this code is loaded: the card reads lost meanwhile, and a late answer to its spawn runs it again.
// A hook from an older copy answers with the older code, which has no such revival.
let spawning = new Set<string>()
// The Agent call's effort, by its tool call id; agent.spawn does not carry it.
let effortAsked = new Map<string, string>()

export async function sessionStart(
  $: EngineInterface,
  e: EventIn<'session.start'>,
  next: PlainNext<'session.start'>,
): Promise<EventOut<'session.start'>> {
  const out = await next(e)
  // A reload restarts the counter at zero; saved cards keep their ids, so count on from the highest.
  seq = Math.max(seq, highestCounter(await read($, agents)))
  await $.command.register({ name: COMMAND, description: 'Show the agent board: one card per subagent' })
  await $.tool.register(TOOL_SPEC)
  $.clock.every(1000, () => {
    void tick($)
  })
  await advance($, await $.clock.now())
  await loseOrphans($)
  // A reload may have cut a link or a report short between its two saves; finish them now.
  for (const r of await read($, agents)) if (r.agentId !== null) await catchUp($, r.agentId)
  const usage = await $.session.usage().catch(() => null)
  if (usage !== null) await update($, contextWindow, () => usage.context.window)
  return out
}

/** After a reload, reads lost each card whose spawn the old copy was waiting on, then drops the early reports that
 *  leaves no card to take. */
async function loseOrphans($: EngineInterface) {
  const orphans = orphanIds(await read($, agents), spawning)
  if (orphans.length === 0) return
  const at = await $.clock.now()
  for (const id of orphans) await update($, agents, (list) => apply(list, { id }, { kind: 'abandoned' }, at))
  await prune($)
}

// Pushed by the engine after each turn: the window changes when the model does.
export async function sessionMeasure(
  $: EngineInterface,
  e: EventIn<'session.measure'>,
  next: PlainNext<'session.measure'>,
): Promise<EventOut<'session.measure'>> {
  await update($, contextWindow, () => e.context.window)
  return next(e)
}

export async function* turnStep(
  $: EngineInterface,
  e: EventIn<'turn.step'>,
  next: StreamingNext<'turn.step'>,
): AsyncGenerator<Chunk<'turn.step'>, EventOut<'turn.step'>> {
  const lvl = e.effort === undefined ? null : String(e.effort)
  await noteStep($, e.agentId, e.model, lvl)
  const r = yield* next(e)
  // Each request is keyed, so it counts once.
  if (r.usage !== null && e.agentId !== undefined) {
    const { input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens } = r.usage
    const usage = { input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens }
    await tell($, e.agentId, { kind: 'usage', key: `${e.turnId}:${e.index}`, usage })
  }
  return r
}

export async function turnComplete(
  $: EngineInterface,
  e: EventIn<'turn.complete'>,
  next: PlainNext<'turn.complete'>,
): Promise<EventOut<'turn.complete'>> {
  // A subagent's turn ending ends it; a teammate's only idles it.
  if (e.agentId !== undefined) await tell($, e.agentId, { kind: 'ended', reason: e.reason })
  return next(e)
}

/** Saves a new agent's card, and starts a new batch when none was live. */
async function startCard($: EngineInterface, row: AgentRow, t: number) {
  // Decided inside the update, so two spawns at once start one batch. Set on every run of the change.
  let isNewBatch = false
  await update($, agents, (list) => {
    isNewBatch = !list.some(isLive)
    return [...startBatch(list), row]
  })
  if (isNewBatch) {
    await update($, openAgent, () => null)
    await update($, chat, () => null)
    await update($, sentLog, () => ({}))
    await update($, sectionLog, () => ({}))
    void openBoard($)
  }
  await advance($, t)
}

/** Passes the spawn on, then links the card `id` to the agent that started, or drops it if the spawn was refused. */
async function answerSpawn(
  $: EngineInterface,
  e: EventIn<'agent.spawn'>,
  next: PlainNext<'agent.spawn'>,
  id: string,
): Promise<EventOut<'agent.spawn'>> {
  // The row keeps the task as Claude wrote it; the agent also reads how to report its steps.
  const r = await next({ ...e, prompt: e.prompt + NUDGE })
  const at = await $.clock.now()
  if (r.deny !== undefined) {
    await update($, agents, (list) => apply(list, { id }, { kind: 'refused' }, at))
    await prune($)
    return r
  }
  const agentId = r.agentId ?? null
  // The reports that came before the answer go onto the card as it links, each at the time it came. They leave the
  // early store only once the card is saved.
  const waiting = agentId === null ? [] : waitingFor(await read($, early), agentId)
  const linked: Fact = { kind: 'linked', agentId, model: r.model }
  await update($, agents, (list) => {
    const withAgent = apply(list, { id }, linked, at)
    return agentId === null ? withAgent : withEarly(withAgent, agentId, waiting)
  })
  if (waiting.length > 0) await dropApplied($)
  // A report saved while the card was linking is taken now.
  if (agentId !== null) await catchUp($, agentId)
  await prune($)
  return r
}

export async function agentSpawn(
  $: EngineInterface,
  e: EventIn<'agent.spawn'>,
  next: PlainNext<'agent.spawn'>,
): Promise<EventOut<'agent.spawn'>> {
  const t = await $.clock.now()
  seq += 1
  const id = `${e.tool_use_id}#${seq}`
  const asked = effortAsked.get(e.tool_use_id)
  effortAsked.delete(e.tool_use_id)
  const row = newCard(e, id, asked, await read($, effort), t)
  spawning.add(id)
  try {
    await startCard($, row, t)
    return await answerSpawn($, e, next, id)
  } finally {
    spawning.delete(id)
  }
}

function agentHooks(on: On) {
  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    if (e.tool_use_id !== undefined && typeof e.effort === 'string') effortAsked.set(e.tool_use_id, e.effort)
    return next(e)
  }).catch(($, e, next) => next(e))
}

// A subagent's own to-do list, from either kind of to-do tool. The main thread's lists are not shown.
function todoHooks(on: On) {
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined && r.deny === undefined && r.isError !== true)
      await tell($, e.agentId, { kind: 'steps', steps: stepsFromTodos(e.todos) })
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    const id = r.isError === true ? null : createdId(r.result)
    if (e.agentId !== undefined && id !== null) await tell($, e.agentId, { kind: 'stepAdded', id, title: e.subject })
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined && r.deny === undefined && r.isError !== true)
      await tell($, e.agentId, {
        kind: 'stepChanged',
        id: e.taskId,
        status: e.status ?? null,
        title: e.subject ?? null,
      })
    return r
  }).catch(($, e, next) => next(e))
}

// The board's own progress tool, which subagents can call (they get no to-do tools).
function progressHooks(on: On) {
  on('tool.check', { tool: TOOL }, () => ({
    decision: 'allow' as const,
    reason: 'desk: report_progress only updates the board.',
  })).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId === undefined) return fail('Only subagents report progress here. Carry on without it.')
    const steps = stepsFromReport(e.steps)
    if (steps === null)
      return fail('Send steps as a list, each with a title and a status: pending, in_progress or completed.')
    await tell($, e.agentId, { kind: 'steps', steps })
    return ok('Shown on the agent board.')
  }).catch(() => fail('report_progress hit an error. Carry on with your task.'))
}

function paneHooks(on: On) {
  // Every board button press comes here; a key that is none of the board's goes on beneath.
  on('ui.press', {}, async ($, e, next) => {
    if (!isOwnPress(e) || boardPressOf(e.element) === null) return next(e)
    await press($, e.element)
    return { element: e.element }
  }).catch(($, e, next) => next(e))

  // A click while the board had the keyboard sends its own press; Tab and the arrows move the ring
  // only inside a focused board. So focus from the person onto a button of an unfocused board is a click.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const isClick = !isBoardFocused && e.origin.kind === 'person'
    const out = await next(e)
    if (isClick) await press($, e.element)
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isBoardFocused = e.props.isFocused
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [rows, shown, openChat, savedSections, t, window, finishedShown] = await Promise.all([
      read($, agents),
      read($, openAgent),
      read($, chat).then(chatOf),
      read($, sectionLog),
      read($, now),
      read($, contextWindow),
      read($, isFinishedShown),
    ])
    if (rows.length === 0) {
      return (
        <Box key="board" flexDirection="column">
          <Text key="empty" color="inactive">
            No agents yet. A card appears here when Claude starts one.
          </Text>
        </Box>
      )
    }
    const b: Board = {
      rows,
      shown,
      chat: openChat,
      sections: savedSections,
      t,
      window,
      isFinishedShown: finishedShown,
      surface: e.surface,
      bodyColumns: e.props.bodyColumns,
    }
    return (
      <Box key="board" flexDirection="column" gap={1}>
        {statCards(els, b)}
        {runningSection($, els, b)}
        {finishedSection($, els, b)}
      </Box>
    )
  })
}

export const register = (on: On): void => {
  // Shared events, behind the empty matcher: see the entry file.
  on('session.start', {}, sessionStart).catch(($, e, next) => next(e))
  on('session.measure', {}, sessionMeasure).catch(($, e, next) => next(e))
  on('turn.step', {}, turnStep).catch(async function* ($, e, next) {
    return yield* next(e)
  })
  on('turn.complete', {}, turnComplete).catch(($, e, next) => next(e))
  on('agent.spawn', {}, agentSpawn).catch(($, e, next) => next(e))
  seq = 0
  spawning = new Set()
  effortAsked = new Map()
  on('command.run', { command: COMMAND }, async ($) => ({ text: await openBoard($) }))
  agentHooks(on)
  todoHooks(on)
  progressHooks(on)
  paneHooks(on)
}
