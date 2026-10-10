// The agent board: a side panel with one card per subagent of the current batch.
// It opens by itself when a batch starts (an agent spawns while none runs); /agent-board reopens it.
// Top: three cards with the batch's agent count, tokens used in all, and time from first start to last end.
// Then Running and Finished sections. Each card: a pixel critter whose hat shows the effort tier, the task's
// name, tier, model and effort, the agent's to-do progress when it keeps a list, its context share, tokens and
// time, and a bar. A click on the name shows the brief, the token detail, the agent's last three messages,
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

import type { AgentRow, Chat, SentLine, Step } from '../types'
import {
  COMMAND,
  MARK,
  NUDGE,
  PANE,
  TOOL,
  TOOL_SPEC,
  addStep,
  addTokens,
  changeStep,
  clockText,
  type Early,
  effortText,
  endingOf,
  fail,
  isLive,
  metricsLine,
  moveTo,
  observed,
  ok,
  prettyModel,
  notSentNote,
  progress,
  recentLines,
  reconcile,
  resumed,
  settle,
  short,
  startBatch,
  stepLine,
  stepsFromReport,
  stepsFromTodos,
  type Tier,
  tierOf,
  tokensLine,
  totals,
} from './agents'
import { BAR_H, CRITTER_H, CRITTER_W, barSvg, critterSvg } from './critter'

const TITLE = 'Agents'

// The validator reads state only through atoms declared in this file.
const agents = atom({ plugin: 'agent-board', key: 'agents' } as const, [] as AgentRow[])
const openAgent = atom({ plugin: 'agent-board', key: 'openAgent' } as const, null)
const now = atom({ plugin: 'agent-board', key: 'now' } as const, 0)
const effort = atom({ plugin: 'agent-board', key: 'effort' } as const, null)
const contextWindow = atom({ plugin: 'agent-board', key: 'window' } as const, null as number | null)
const isFinishedShown = atom({ plugin: 'agent-board', key: 'isFinishedShown' } as const, true)
const chat = atom({ plugin: 'agent-board', key: 'chat' } as const, null as Chat | null)
const sentLog = atom({ plugin: 'agent-board', key: 'sent' } as const, {} as Record<string, SentLine[]>)

// The one clock the cards count from. It only moves forward.
const advance = ($: EngineInterface, t: number) => update($, now, (n) => Math.max(n, t))

// Each second: while any agent runs, move the clock and fold in the engine's agent list.
async function tick($: EngineInterface) {
  const rows = await read($, agents)
  if (!rows.some(isLive)) return
  const t = await $.clock.now()
  // No list this second: the rows keep their state and the clock still moves.
  const infos = await $.agent.list().catch(() => null)
  if (infos !== null) await update($, agents, (list) => reconcile(list, infos, t))
  await advance($, t)
  const shown = await read($, openAgent)
  const agentId = rows.find((r) => r.id === shown)?.agentId ?? null
  if (agentId !== null) await loadChat($, agentId)
}

/** Reads the open card's agent's last messages into the chat view, if that card is still the open one. */
async function loadChat($: EngineInterface, agentId: string) {
  const [found, sent] = await Promise.all([$.session.messages({ agentId }).catch(() => null), read($, sentLog)])
  const mine = sent[agentId] ?? []
  const lines = Array.isArray(found) ? recentLines(found, mine) : mine.length === 0 ? null : recentLines([], mine)
  await update($, chat, (c) => (c?.agentId === agentId ? { ...c, lines } : c))
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

/** Sends the user's message to the agent. A running agent gets it as a plain user message in its conversation,
 *  as the built-in agent window's messages read; a finished one (or a refused append) gets it delivered, which
 *  wakes it, so its card runs again. */
async function sendTo($: EngineInterface, r: AgentRow, typed: string) {
  const text = typed.trim()
  if (r.agentId === null || text === '') return
  const agentId = r.agentId
  // Where it goes among the agent's messages, counted before it is sent.
  const before = await $.session.messages({ agentId }).catch(() => null)
  const log = { text, after: Array.isArray(before) ? before.length : 0 }
  const remember = () => update($, sentLog, (all) => ({ ...all, [agentId]: [...(all[agentId] ?? []), log] }))
  if (isLive(r)) {
    const added = await $.session
      .append({ agentId, message: { type: 'user', content: [{ type: 'text', text }] } })
      .catch((err: unknown) => ({ deny: String(err) }))
    if (added.deny === undefined) {
      await remember()
      await noteChat($, agentId, 'Added to its conversation. It reads it at its next step.', true)
      return loadChat($, agentId)
    }
  }
  const sent = await $.session.send({ to: { agentId }, text }).catch((err: unknown) => ({
    isDelivered: false as const,
    reason: String(err),
  }))
  if (!sent.isDelivered) return noteChat($, agentId, notSentNote(sent.reason))
  await remember()
  await noteChat($, agentId, 'Sent. It reads it at its next step.', true)
  await changeAgent($, agentId, resumed)
  await loadChat($, agentId)
}

/** Stops the agent through Claude's own stop tool. The call goes through the user's permission settings as is. */
async function stopAgent($: EngineInterface, r: AgentRow) {
  if (r.agentId === null) return
  const agentId = r.agentId
  await noteChat($, agentId, 'Stopping…')
  const out = await $.tool.call({ tool: 'TaskStop', task_id: agentId }).catch((err: unknown) => ({ deny: String(err) }))
  if ('deny' in out && out.deny !== undefined) return noteChat($, agentId, `Not stopped: ${out.deny}`)
  if ('isError' in out && out.isError === true) return noteChat($, agentId, `Not stopped: ${out.text}`)
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
      <Text key="label" color="subtle">
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
  if (b.surface === 'terminal' || !('Svg' in els) || els.Svg === undefined) return null
  const isFaded = r.state === 'failed' || r.state === 'stopped' || r.state === 'lost'
  return (
    <els.Svg
      key="pic"
      source={critterSvg(tier.hat, isFaded)}
      alt={`${tier.label} critter`}
      width={CRITTER_W}
      height={CRITTER_H}
    />
  )
}

// The progress bar: a picture off the terminal, a run of line cells on it. None while progress is unknown.
function bar(els: ElementTable, b: Board, r: AgentRow, color: string) {
  const { Box, Text } = els
  const f = progress(r)
  if (f === null) return null
  if (b.surface !== 'terminal' && 'Svg' in els && els.Svg !== undefined) {
    const alt = r.state === 'done' ? 'Finished' : `${Math.round(f * 100)}% of its to-do list done`
    return (
      <Box key="bar" flexDirection="column" marginTop={1}>
        <els.Svg key="barsvg" source={barSvg(f, color)} alt={alt} height={BAR_H} />
      </Box>
    )
  }
  const cells = Math.max(10, b.bodyColumns - 4)
  const full = Math.round(f * cells)
  return (
    <Box key="bar" flexDirection="row">
      <Text key="on" color={color}>
        {'━'.repeat(full)}
      </Text>
      <Text key="off" color="subtle">
        {'─'.repeat(cells - full)}
      </Text>
    </Box>
  )
}

// Under an opened card: the token detail and the brief.
function details(els: ElementTable, r: AgentRow) {
  const { Box, Text } = els
  return (
    <Box key="details" flexDirection="column" marginTop={1}>
      <Text key="tokens" color="subtle" wrap="wrap">
        {tokensLine(r)}
      </Text>
      <Text key="brief" color="subtle" wrap="wrap">
        {r.task}
      </Text>
    </Box>
  )
}

// What the opened card has read of the agent's conversation.
function chatLines(els: ElementTable, c: Chat | null) {
  const { Box, Text } = els
  if (c === null) return null
  if (c.lines === null)
    return (
      <Text key="unread" color="subtle" wrap="wrap">
        Its messages can't be read here.
      </Text>
    )
  if (c.lines.length === 0)
    return (
      <Text key="unread" color="subtle">
        No messages yet.
      </Text>
    )
  return (
    <Box key="lines" flexDirection="column">
      {c.lines.map((l, i) => (
        <Box key={`line${i}`} flexDirection="column">
          <Text key="who" color={l.who === 'agent' ? 'success' : 'subtle'} bold>
            {l.who === 'agent' ? 'Agent' : 'To the agent'}
          </Text>
          <Text key="said" wrap="wrap">
            {l.text}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

// The box to message the agent. The phone app draws no text field, so there it says where to type instead.
function sayBox($: EngineInterface, els: ElementTable, r: AgentRow, c: Chat | null) {
  if (!('Input' in els) || els.Input === undefined)
    return (
      <els.Text key="say-elsewhere" color="subtle" wrap="wrap">
        Message it from the desktop app or the terminal.
      </els.Text>
    )
  // A fresh key after each send draws an empty box.
  return (
    <els.Input
      key={`say:${r.id}:${c?.sent ?? 0}`}
      placeholder={isLive(r) ? 'Message this agent' : 'Message it to pick up again'}
      submitLabel="send"
      onSubmit={(text: string) => void sendTo($, r, text)}
    />
  )
}

// Under an opened card's brief: its last messages, a box to message it, and Stop while it runs.
function talk($: EngineInterface, els: ElementTable, b: Board, r: AgentRow) {
  const { Box, Text, Button } = els
  if (r.agentId === null)
    return (
      <Text key="talk" color="subtle">
        Starting. Its messages show here once it runs.
      </Text>
    )
  const c = b.chat?.agentId === r.agentId ? b.chat : null
  return (
    <Box key="talk" flexDirection="column" marginTop={1} gap={1}>
      <Text key="talk-head" color="subtle">
        Last messages
      </Text>
      {chatLines(els, c)}
      <Box key="say-row" flexDirection="row" gap={1}>
        <Box key="say-box" flexGrow={1} flexShrink={1}>
          {sayBox($, els, r, c)}
        </Box>
        {isLive(r) ? <Button key={`stop:${r.id}`} label="Stop" onPress={() => stopAgent($, r)} /> : null}
      </Box>
      {c === null || c.note === null ? null : (
        <Text key="note" color="subtle" wrap="wrap">
          {c.note}
        </Text>
      )}
    </Box>
  )
}

function agentCard($: EngineInterface, els: ElementTable, b: Board, r: AgentRow) {
  const { Box, Text, Button } = els
  const tier = tierOf(r.effort)
  const mark = MARK[r.state]
  const steps = stepLine(r.steps)
  return (
    <Box key={`card:${r.id}`} flexDirection="row" gap={1} marginBottom={1}>
      {critter(els, b, r, tier)}
      <Box key="body" flexDirection="column" flexGrow={1} flexShrink={1}>
        <Box key="top" flexDirection="row" justifyContent="space-between">
          <Button key={`name:${r.id}`} plain label={r.description} onPress={() => toggleCard($, r)} />
          <Text key="mark" color={mark.color} bold>
            {mark.glyph}
          </Text>
        </Box>
        <Box key="who" flexDirection="row">
          <Text key="tier" color={tier.color}>
            {tier.label}
          </Text>
          <Text key="model" color="subtle">{` ${prettyModel(r.model)} · ${effortText(r)}`}</Text>
        </Box>
        {/* A long step name gives way, cut short with an ellipsis; the numbers keep one line. */}
        <Box key="nums" flexDirection="row" justifyContent={steps === null ? 'flex-end' : 'space-between'} gap={1}>
          {steps === null ? null : (
            <Box key="steps" flexShrink={1} minWidth={0}>
              <Text key="step-text" wrap="truncate-end">
                {steps}
              </Text>
            </Box>
          )}
          <Box key="metrics" flexShrink={0}>
            <Text key="metrics-text" color="subtle">
              {metricsLine(r, b.t, b.window)}
            </Text>
          </Box>
        </Box>
        {bar(els, b, r, tier.color)}
        {b.shown === r.id ? details(els, r) : null}
        {b.shown === r.id ? talk($, els, b, r) : null}
      </Box>
    </Box>
  )
}

function runningSection($: EngineInterface, els: ElementTable, b: Board) {
  const { Box, Text } = els
  const live = b.rows.filter(isLive)
  return (
    <Box key="running" flexDirection="column">
      <Text key="head" color="subtle">{`Running · ${live.length}`}</Text>
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
        key="toggle-finished"
        plain
        dimColor
        label={`${b.isFinishedShown ? '▾' : '▸'} Finished · ${ended.length}`}
        onPress={() => update($, isFinishedShown, (v) => !v)}
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
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const [rows, shown, talking, t, window, finishedShown] = await Promise.all([
      read($, agents),
      read($, openAgent),
      read($, chat),
      read($, now),
      read($, contextWindow),
      read($, isFinishedShown),
    ])
    if (rows.length === 0) {
      return (
        <Box key="board" flexDirection="column">
          <Text key="empty" color="subtle">
            No agents yet. A card appears here when Claude starts one.
          </Text>
        </Box>
      )
    }
    const b: Board = {
      rows,
      shown,
      chat: talking,
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
