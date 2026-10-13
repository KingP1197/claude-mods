// The agent board: a side panel with one card per subagent of the current batch.
// It opens by itself when a batch starts (an agent spawns while none runs); /agent-board reopens it.
// Top: three cards with the batch's agent count, tokens used in all, and time from first start to last end.
// Then Running and Finished sections. Each card: a pixel critter whose hat shows the effort level, the task's
// name, agent type, effort level and model, the agent's to-do progress when it keeps a list, its context share, tokens and
// time, and a bar. A click on the name shows the brief, the token detail, the agent's Transcript,
// a box to message it, and a Stop button while it runs.
// Every hook lives in this file: the validator follows `$` only within one file.
import { atom, read, update } from 'claude-code'
import type {
  AgentSpawnInput,
  ElementTable,
  EngineInterface,
  ModelUsage,
  On,
  Register,
  RenderSurface,
} from 'claude-code'

import type { AgentRow, CardSections, Chat, TranscriptLine, SentLine, Step } from '../types'
import {
  BAR_KEY,
  COMMAND,
  FINISHED_KEY,
  type SectionName,
  earlierKey,
  moreKey,
  sectionKey,
  MARK,
  NUDGE,
  PANE,
  TOOL,
  TOOL_SPEC,
  addStep,
  addTokens,
  barKindOf,
  buttonOf,
  childKey,
  cardLine,
  changeStep,
  clockText,
  type Early,
  endingOf,
  fail,
  isLive,
  metricsLine,
  moveTo,
  nameKey,
  observed,
  ok,
  prettyModel,
  refusalNote,
  progress,
  reconcile,
  resumed,
  settle,
  short,
  startBatch,
  stepsFromReport,
  stepsFromTodos,
  stopKey,
  type Tier,
  tierOf,
  tokensLine,
  totals,
} from './agents'
import { FILL_FAILED, FILL_RAISED } from './colors'
import { BAR_H, CRITTER_H, CRITTER_W, barSvg, critterSvg, hatColor } from './critter'
import { cutMiddle, cutTo, headerCells, stepsRoom, targetRoom, titleParts } from './header'
import {
  BRIEF_CHARS,
  DIVIDER_H,
  briefShown,
  callKey,
  callPress,
  thoughtKey,
  thoughtPress,
  isThoughtOpen,
  toggledThought,
  dividerSvg,
  isCallOpen,
  ruleLabel,
  ruleTail,
  sectionsOf,
  toggledCall,
  toggledEarlier,
  toggledSection,
  toggledWhole,
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
  isEntry,
  lineSvg,
  openedSource,
  thoughtsOf,
  toolIcon,
  wrappedRows,
} from './transcript'

const TITLE = 'Agents'

// The validator reads state only through atoms declared in this file.
const agents = atom({ plugin: 'agent-board', key: 'agents' } as const, [] as AgentRow[])
const openAgent = atom({ plugin: 'agent-board', key: 'openAgent' } as const, null)
const now = atom({ plugin: 'agent-board', key: 'now' } as const, 0)
const effort = atom({ plugin: 'agent-board', key: 'effort' } as const, null)
const contextWindow = atom({ plugin: 'agent-board', key: 'window' } as const, null as number | null)
const isFinishedShown = atom({ plugin: 'agent-board', key: 'isFinishedShown' } as const, true)
const chat = atom({ plugin: 'agent-board', key: 'chat' } as const, null as Chat | null)
const sectionLog = atom({ plugin: 'agent-board', key: 'sections' } as const, {} as Record<string, CardSections>)
const sentLog = atom({ plugin: 'agent-board', key: 'sent' } as const, {} as Record<string, SentLine[]>)

// The one clock the cards count from. It only moves forward.
const advance = ($: EngineInterface, t: number) => update($, now, (n) => Math.max(n, t))

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
  if (agentId !== null) await loadChat($, agentId)
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

const toggleSection = ($: EngineInterface, id: string, which: SectionName) =>
  update($, sectionLog, (saved) => toggledSection(saved, id, which))

const toggleWhole = ($: EngineInterface, id: string) => update($, sectionLog, (saved) => toggledWhole(saved, id))

const toggleEarlier = ($: EngineInterface, id: string) => update($, sectionLog, (saved) => toggledEarlier(saved, id))

const toggleCall = ($: EngineInterface, id: string, callId: string) =>
  update($, sectionLog, (saved) => toggledCall(saved, id, callId))

const toggleThought = ($: EngineInterface, id: string, thoughtId: string) =>
  update($, sectionLog, (saved) => toggledThought(saved, id, thoughtId))

const toggleFinished = ($: EngineInterface) => update($, isFinishedShown, (v) => !v)

// Whether the board had the keyboard at its last drawing. The desktop app spends a first click on an
// unfocused board on focusing it and sends the button no press, so the focus hook presses it instead.
let isBoardFocused = false

/** Runs the card-bound button a first click landed on: the card's name or its Stop. */
async function pressOnCard($: EngineInterface, button: { kind: 'name' | 'stop' | 'child'; id: string }) {
  const r = (await read($, agents)).find((x) => x.id === button.id)
  if (r === undefined) return
  if (button.kind !== 'stop') return toggleCard($, r)
  if (r.agentId !== null && isLive(r)) return stopAgent($, r.agentId)
}

/** Runs the button a first click on the unfocused board landed on, as its onPress would. */
async function pressByKey($: EngineInterface, key: string | undefined) {
  const call = callPress(key)
  if (call !== null) return toggleCall($, call.id, call.callId)
  const thought = thoughtPress(key)
  if (thought !== null) return toggleThought($, thought.id, thought.thoughtId)
  const button = buttonOf(key)
  if (button === null) return
  if (button.kind === 'finished') return toggleFinished($)
  if (button.kind === 'section') return toggleSection($, button.id, button.which)
  if (button.kind === 'more') return toggleWhole($, button.id)
  if (button.kind === 'earlier') return toggleEarlier($, button.id)
  return pressOnCard($, button)
}

/** Opens a card, or closes it when it is the open one. Opening reads its agent's last messages. */
async function toggleCard($: EngineInterface, r: AgentRow) {
  let isOpening = false
  await update($, openAgent, (cur) => {
    isOpening = cur !== r.id
    return isOpening ? r.id : null
  })
  const fresh: Chat | null =
    isOpening && r.agentId !== null ? { agentId: r.agentId, lines: [], note: null, sent: 0 } : null
  await update($, chat, () => fresh)
  if (fresh !== null) await loadChat($, fresh.agentId)
}

const noteChat = ($: EngineInterface, agentId: string, note: string, isSent = false) =>
  update($, chat, (c) => (c?.agentId === agentId ? { ...c, note, sent: c.sent + (isSent ? 1 : 0) } : c))

/** A call that threw reads as a refusal with the error as its reason. */
const thrownAsDeny = (err: unknown) => ({ deny: String(err) })

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
    reason: String(err),
  }))
  if (!delivery.isDelivered) return noteChat($, agentId, refusalNote('SendMessage', delivery.reason))
  await remember()
  await noteChat($, agentId, 'Sent. It reads it at its next step.', true)
  await changeAgent($, agentId, resumed)
  await loadChat($, agentId)
}

/** Stops the agent through Claude's own stop tool. The call goes through the user's permission settings as is. */
async function stopAgent($: EngineInterface, agentId: string) {
  await noteChat($, agentId, 'Stopping…')
  const out = await $.tool.call({ tool: 'TaskStop', task_id: agentId }).catch(thrownAsDeny)
  const refused = 'deny' in out ? out.deny : out.isError === true ? out.text : undefined
  if (refused !== undefined) return noteChat($, agentId, refusalNote('TaskStop', refused))
  const t = await $.clock.now()
  await changeAgent($, agentId, (x) => moveTo(x, 'stopped', t))
  await noteChat($, agentId, 'Stopped.')
}

/** Changes the row of one agent; false when no row carries that agentId yet. */
async function changeAgent($: EngineInterface, agentId: string, change: (r: AgentRow) => AgentRow) {
  let isFound = false
  await update($, agents, (list) =>
    list.map((r) => {
      if (r.agentId !== agentId) return r
      isFound = true
      return change(r)
    }),
  )
  return isFound
}

/** Opens the board, or says why it could not. */
async function openBoard($: EngineInterface): Promise<string> {
  const r = await $.ui.open({ id: PANE, title: TITLE })
  return r.isPlaced ? 'Agent board opened.' : `Could not open the agent board (${r.reason}).`
}

// What an agent reported before its spawn answered. Each hook notes its fact here first, then
// changes the row if one exists; whichever of the two the spawn misses, the other catches.
type Notes = { early: Map<string, Early>; note: (agentId: string, fact: Early) => void }

function makeNotes(): Notes {
  const early = new Map<string, Early>()
  const note = (agentId: string, fact: Early) => {
    early.set(agentId, { ...early.get(agentId), ...fact })
  }
  return { early, note }
}

// A model request's start says the model and effort it runs on. The main thread's
// effort is the session's; a subagent's own requests replace the guess on its row.
async function noteStep(
  $: EngineInterface,
  notes: Notes,
  agentId: string | undefined,
  model: string,
  lvl: string | null,
) {
  if (agentId === undefined) {
    if (lvl !== null && lvl !== (await read($, effort))) await update($, effort, () => lvl)
    return
  }
  notes.note(agentId, { step: { model, effort: lvl } })
  if (await changeAgent($, agentId, (r) => observed(r, model, lvl))) notes.early.delete(agentId)
}

// A subagent's model request ended: add its counts. Each request is keyed, so it counts once.
async function noteUsage($: EngineInterface, notes: Notes, agentId: string, key: string, usage: ModelUsage) {
  notes.note(agentId, { tokens: addTokens(notes.early.get(agentId)?.tokens, usage, key) })
  if (await changeAgent($, agentId, (r) => ({ ...r, tokens: addTokens(r.tokens, usage, key) })))
    notes.early.delete(agentId)
}

const withSteps = (r: AgentRow, steps: Step[] | undefined): AgentRow => (steps === undefined ? r : { ...r, steps })

// A subagent changed its to-do list.
async function noteSteps(
  $: EngineInterface,
  notes: Notes,
  agentId: string,
  change: (steps: readonly Step[] | undefined) => Step[] | undefined,
) {
  notes.note(agentId, { steps: change(notes.early.get(agentId)?.steps) })
  if (await changeAgent($, agentId, (r) => withSteps(r, change(r.steps)))) notes.early.delete(agentId)
}

// A new agent's row, before its spawn answers.
function spawnRow(
  e: AgentSpawnInput,
  id: string,
  asked: string | undefined,
  sessionEffort: string | null,
  t: number,
): AgentRow {
  return {
    id,
    agentId: null,
    description: e.description.trim() === '' ? e.subagentType : e.description,
    type: e.subagentType,
    model: e.model ?? null,
    effort: asked ?? sessionEffort,
    isEffortInherited: asked === undefined,
    isTeammate: e.isTeammate === true,
    isWorkflow: e.workflow !== undefined,
    parentAgentId: e.parentAgentId ?? null,
    task: e.prompt,
    startedAt: t,
    endedAt: null,
    state: 'running',
  }
}

// A subagent's turn ending ends it; a teammate's only idles it.
async function agentTurnEnded($: EngineInterface, notes: Notes, agentId: string, reason: string) {
  const t = await $.clock.now()
  notes.note(agentId, { reason })
  if (await changeAgent($, agentId, (r) => moveTo(r, endingOf(reason, r.isTeammate), t))) notes.early.delete(agentId)
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

// The Svg element, or null where this surface draws no pictures (the terminal, and any surface without one).
// There text marks stand in for the pictures.
const svgOf = (els: ElementTable, b: Board) =>
  b.surface !== 'terminal' && 'Svg' in els && els.Svg !== undefined ? els.Svg : null

// The critter, off the terminal only: the terminal draws no pictures.
function critter(els: ElementTable, b: Board, r: AgentRow, tier: Tier) {
  const Svg = svgOf(els, b)
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
  const Svg = svgOf(els, b)
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
  const Svg = svgOf(els, b)
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
  const chevron = (
    <Button
      key={sectionKey(r.id, which)}
      plain
      dimColor
      label={isOpen ? '▾' : '▸'}
      onPress={() => toggleSection($, r.id, which)}
    />
  )
  const Svg = svgOf(els, b)
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
  return [
    ...sectionHead($, els, b, r, 'brief', 'Brief'),
    sections.isBriefOpen ? (
      <Box key="brief-body" flexDirection="column" {...insetOf(b)}>
        <Text key="brief" color="inactive" wrap="wrap">
          {briefShown(r.task, sections.isBriefWhole)}
        </Text>
        {r.task.length > BRIEF_CHARS ? (
          <Button
            key={moreKey(r.id)}
            plain
            dimColor
            label={sections.isBriefWhole ? 'Show less' : 'Show whole brief'}
            onPress={() => toggleWhole($, r.id)}
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
  const Svg = svgOf(els, b)
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

// The end of a Tool call's row: what it touched, cut in the middle to the cells the row leaves it, then the tail.
function toolTail($: EngineInterface, els: ElementTable, l: Extract<TranscriptLine, { kind: 'tool' }>, t: Tail) {
  const { Box, Text, Button } = els
  const { child } = t
  const target = l.target ? cutMiddle(l.target, t.room) : null
  return [
    target ? (
      <Box key="target" flexShrink={1} flexGrow={1} minWidth={0}>
        {child === null ? (
          <Text {...(t.isLive ? { color: 'claude', bold: true } : { color: 'inactive' })}>{target}</Text>
        ) : (
          <Button key={childKey(child.id)} plain dimColor label={target} onPress={() => toggleCard($, child)} />
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
  const callId = l.id
  // An Agent call whose child the board holds draws as an Agent call, in flight or not.
  const child = childOf(b.rows, flow.card, l)
  const isLive = flow.isRunning && l.isInFlight === true && child === null
  const isOpenable = callId !== undefined && hasDetail(l, isLive)
  const isOpen = isOpenable && isCallOpen(b.sections, flow.card, callId, l.isFailed === true)
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
        {isOpenable ? (
          <Button
            key={callKey(flow.card, callId)}
            plain
            dimColor
            label={isOpen ? '▾' : '▸'}
            onPress={() => toggleCall($, flow.card, callId)}
          />
        ) : null}
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
  return (
    <Box key="thought" flexDirection="column">
      <Box key="tool" flexDirection="row" gap={1}>
        {rowLead(els, b, flow, i, 'Thought')}
        <Box key="room" flexGrow={1} />
        <Button
          key={thoughtKey(flow.card, l.id)}
          plain
          dimColor
          label={isOpen ? '▾' : '▸'}
          onPress={() => toggleThought($, flow.card, l.id)}
        />
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
  const Svg = svgOf(els, b)
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
  const Svg = svgOf(els, b)
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
  const lines = c.lines.filter(isEntry)
  if (lines.length === 0)
    return (
      <Text key="unread" color="inactive">
        No messages yet.
      </Text>
    )
  const isAll = sectionsOf(b.sections, r.id).isEarlierShown
  const first = firstShown(lines.length, isAll)
  const body = (
    <Box key="lines" flexDirection="column">
      {c.isThinkingMissing === true ? (
        <Text key="thinking-missing" color="inactive">
          Thinking is not available for this agent
        </Text>
      ) : null}
      {(c.dropped ?? 0) > 0 ? (
        <Text key="dropped" color="inactive">
          {`Earlier entries dropped: ${c.dropped}.`}
        </Text>
      ) : null}
      {firstShown(lines.length, false) > 0 ? (
        <Button
          key={earlierKey(r.id)}
          plain
          dimColor
          label={isAll ? 'Show fewer' : `Show ${first} earlier`}
          onPress={() => toggleEarlier($, r.id)}
        />
      ) : null}
      {lines.map((_, i) =>
        i < first ? null : entry($, els, b, { card: r.id, lines, first, isRunning: r.state === 'running' }, i),
      )}
    </Box>
  )
  // The user's own messages still show, under a note that the agent's could not be read.
  return c.isUnread === true ? (
    <Box key="chat" flexDirection="column">
      {unread}
      {body}
    </Box>
  ) : (
    body
  )
}

// The box to message the agent. The phone app draws no text field, so there it says where to type instead.
function sayBox($: EngineInterface, els: ElementTable, r: AgentRow, agentId: string, c: Chat | null) {
  if (!('Input' in els) || els.Input === undefined)
    return (
      <els.Text key="say-elsewhere" color="inactive" wrap="wrap">
        Message it from the desktop app or the terminal.
      </els.Text>
    )
  // A fresh key after each send draws an empty box.
  return (
    <els.Input
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
  return [
    footerRule(els, b),
    <Box key="say-row" flexDirection="row" gap={1} marginTop={1} {...insetOf(b)}>
      <Box key="say-box" flexGrow={1} flexShrink={1}>
        {sayBox($, els, r, agentId, c)}
      </Box>
      {isLive(r) ? <Button key={stopKey(r.id)} label="Stop" onPress={() => stopAgent($, agentId)} /> : null}
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
      c === null || c.lines === null ? null : c.lines.length + (c.dropped ?? 0),
    ),
    sectionsOf(b.sections, r.id).isTranscriptOpen ? (
      <Box key="transcript-body" marginTop={1} {...insetOf(b)}>
        {chatLines($, els, b, r, c)}
      </Box>
    ) : null,
    ...footer($, els, b, r, agentId, c),
  ]
}

// The type line: agent type, effort word and model, set apart by dim separators. A long type is cut short.
function typeLine(els: ElementTable, r: AgentRow, tier: Tier) {
  const { Box, Text } = els
  return (
    <Box key="who" flexDirection="row">
      {r.type === '' ? null : (
        <Box key="type-room" flexShrink={1} minWidth={0}>
          <Text key="type" color="inactive" wrap="truncate-end">
            {r.type}
          </Text>
        </Box>
      )}
      <Box key="effort-room" flexShrink={0}>
        {r.type === '' ? null : (
          <Text key="sep-type" color="subtle">
            {' | '}
          </Text>
        )}
        <Text key="tier" color="inactive">
          {tier.label}
        </Text>
        <Text key="sep-model" color="subtle">
          {' | '}
        </Text>
        <Text key="model" color="inactive">
          {prettyModel(r.model)}
        </Text>
      </Box>
    </Box>
  )
}

// The card's first row: its name, and its state mark at the right edge. In the terminal a hat mark leads the
// name; the name gives way before the state mark does, so a narrow pane keeps the mark.
function titleRow($: EngineInterface, els: ElementTable, b: Board, r: AgentRow, tier: Tier, cells: number) {
  const { Box, Text, Button } = els
  const mark = MARK[r.state]
  const parts = titleParts(r.description, r.state, cells)
  const name = (
    <Button key={nameKey(r.id)} plain label={r.description} onPress={() => toggleCard($, r)}>
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
  const isHatShown = svgOf(els, b) === null
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

function agentCard($: EngineInterface, els: ElementTable, b: Board, r: AgentRow) {
  const { Box, Text } = els
  const tier = tierOf(r.effort)
  const cells = headerCells(b.surface === 'terminal', insideCard(b))
  const stats = metricsLine(r, b.t, b.window, cells)
  const line = cardLine(r)
  const steps = line === null ? '' : cutTo(line, stepsRoom(cells, stats))
  const isOpen = b.shown === r.id
  return (
    <Box key={`card:${r.id}`} flexDirection="column" marginBottom={1} {...blockOf(b)}>
      <Box key="header" flexDirection="row" gap={1} {...insetOf(b)}>
        {critter(els, b, r, tier)}
        <Box key="body" flexDirection="column" flexGrow={1} flexShrink={1}>
          {titleRow($, els, b, r, tier, cells)}
          {typeLine(els, r, tier)}
          {/* A long step name gives way, cut short with an ellipsis; the numbers keep one line. */}
          <Box key="nums" flexDirection="row" justifyContent={steps === '' ? 'flex-end' : 'space-between'} gap={1}>
            {steps === '' ? null : (
              <Box key="steps" flexShrink={1} minWidth={0}>
                <Text key="step-text" wrap="truncate-end">
                  {steps}
                </Text>
              </Box>
            )}
            {stats === '' ? null : (
              <Box key="metrics" flexShrink={0}>
                <Text key="metrics-text" color="inactive">
                  {stats}
                </Text>
              </Box>
            )}
          </Box>
          {bar(els, b, r)}
          {isOpen ? (
            <Box key="details" marginTop={1}>
              <Text key="tokens" color="inactive" wrap="wrap">
                {tokensLine(r)}
              </Text>
            </Box>
          ) : null}
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
      <Text key="head" color="inactive">{`Running | ${live.length}`}</Text>
      {live.map((r) => agentCard($, els, b, r))}
    </Box>
  )
}

function finishedSection($: EngineInterface, els: ElementTable, b: Board) {
  const { Box, Button } = els
  const ended = b.rows.filter((r) => !isLive(r))
  if (ended.length === 0) return null
  return (
    <Box key="finished" flexDirection="column">
      <Button
        key={FINISHED_KEY}
        plain
        dimColor
        label={`${b.isFinishedShown ? '▾' : '▸'} Finished | ${ended.length}`}
        onPress={() => toggleFinished($)}
      />
      {b.isFinishedShown ? ended.map((r) => agentCard($, els, b, r)) : null}
    </Box>
  )
}

// Hooks that gate an event end in .catch(... next(e)): if one throws, the event goes on as if
// this plugin were absent, and a next() it already made is replayed, never run twice.

function sessionHooks(on: On) {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    await $.command.register({ name: COMMAND, description: 'Show the agent board: one card per subagent' })
    await $.tool.register(TOOL_SPEC)
    $.clock.every(1000, () => {
      void tick($)
    })
    await advance($, await $.clock.now())
    const usage = await $.session.usage().catch(() => null)
    if (usage !== null) await update($, contextWindow, () => usage.context.window)
    return out
  })

  // Pushed by the engine after each turn: the window changes when the model does.
  on('session.measure', async ($, e, next) => {
    await update($, contextWindow, () => e.context.window)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($) => ({ text: await openBoard($) }))
}

function stepHooks(on: On, notes: Notes) {
  on('turn.step', async function* ($, e, next) {
    const lvl = e.effort === undefined ? null : String(e.effort)
    await noteStep($, notes, e.agentId, e.model, lvl)
    const r = yield* next(e)
    if (r.usage !== null && e.agentId !== undefined)
      await noteUsage($, notes, e.agentId, `${e.turnId}:${e.index}`, r.usage)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) await agentTurnEnded($, notes, e.agentId, e.reason)
    return next(e)
  }).catch(($, e, next) => next(e))
}

function agentHooks(on: On, notes: Notes) {
  // Short-lived links between events, rebuilt after a reload.
  let seq = 0
  // The Agent call's effort, by its tool call id; agent.spawn does not carry it.
  const effortAsked = new Map<string, string>()

  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    if (e.tool_use_id !== undefined && typeof e.effort === 'string') effortAsked.set(e.tool_use_id, e.effort)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const t = await $.clock.now()
    seq += 1
    const id = `${e.tool_use_id}#${seq}`
    const asked = effortAsked.get(e.tool_use_id)
    effortAsked.delete(e.tool_use_id)
    const row = spawnRow(e, id, asked, await read($, effort), t)
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

    // The row keeps the task as Claude wrote it; the agent also reads how to report its steps.
    const r = await next({ ...e, prompt: e.prompt + NUDGE })
    if (r.deny !== undefined) {
      await update($, agents, (list) => list.filter((x) => x.id !== id))
      return r
    }
    const agentId = r.agentId ?? null
    const at = await $.clock.now()
    // Read inside the update, so a fact noted during any await before it (or during a retry) lands.
    const before = () => (agentId === null ? undefined : notes.early.get(agentId))
    await update($, agents, (list) =>
      list.map((x) => (x.id === id ? settle({ ...x, agentId, model: r.model }, before(), at) : x)),
    )
    if (agentId !== null) notes.early.delete(agentId)
    return r
  }).catch(($, e, next) => next(e))
}

// A subagent's own to-do list, from either kind of to-do tool. The main thread's lists are not shown.
function todoHooks(on: On, notes: Notes) {
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined && r.deny === undefined && r.isError !== true)
      await noteSteps($, notes, e.agentId, () => stepsFromTodos(e.todos))
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    const id = r.isError === true ? null : createdId(r.result)
    if (e.agentId !== undefined && id !== null) await noteSteps($, notes, e.agentId, (s) => addStep(s, id, e.subject))
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined && r.deny === undefined && r.isError !== true)
      await noteSteps($, notes, e.agentId, (s) => changeStep(s, e.taskId, { status: e.status, title: e.subject }))
    return r
  }).catch(($, e, next) => next(e))
}

// The board's own progress tool, which subagents can call (they get no to-do tools).
function progressHooks(on: On, notes: Notes) {
  on('tool.check', { tool: TOOL }, () => ({
    decision: 'allow' as const,
    reason: 'agent-board: report_progress only updates the board.',
  })).catch(($, e, next) => next(e))

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId === undefined) return fail('Only subagents report progress here. Carry on without it.')
    const steps = stepsFromReport(e.steps)
    if (steps === null)
      return fail('Send steps as a list, each with a title and a status: pending, in_progress or completed.')
    await noteSteps($, notes, e.agentId, () => steps)
    return ok('Shown on the agent board.')
  }).catch(() => fail('report_progress hit an error. Carry on with your task.'))
}

function paneHooks(on: On) {
  // A click while the board had the keyboard sends its own press; Tab and the arrows move the ring
  // only inside a focused board. So focus from the person onto a button of an unfocused board is a click.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const isClick = !isBoardFocused && e.origin.kind === 'person'
    const out = await next(e)
    if (isClick) await pressByKey($, e.element)
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isBoardFocused = e.props.isFocused
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [rows, shown, openChat, savedSections, t, window, finishedShown] = await Promise.all([
      read($, agents),
      read($, openAgent),
      read($, chat),
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

export const register: Register = (on) => {
  const notes = makeNotes()
  sessionHooks(on)
  stepHooks(on, notes)
  agentHooks(on, notes)
  todoHooks(on, notes)
  progressHooks(on, notes)
  paneHooks(on)
}
