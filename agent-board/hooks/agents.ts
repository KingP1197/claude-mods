// The agent cards' data and wording. Nothing here calls the engine: the
// validator follows `$` only within one file, so the hooks live in register.tsx.
// A card appears when an agent spawns. Finished cards stay until the next batch
// starts, that is, until an agent spawns while none is running.
import type { AgentInfo, AgentStatus, ModelUsage, SessionMessage, ToolSpec } from 'claude-code'

import type { AgentRow, AgentState, AgentTokens, ChatLine, SentLine, Step, StepStatus } from '../types'
import type { Hat } from './critter'

export const PANE = 'agent-board'
export const COMMAND = 'agent-board'

// Subagents get no to-do tools, so the board gives them its own: a whole list of steps per call.
const TOOL_NAME = 'report_progress'
export const TOOL = `mcp__agent-board__${TOOL_NAME}`

const STATUSES: readonly StepStatus[] = ['pending', 'in_progress', 'completed']

// The tool's input, by hand: until the engine has loaded this mod with the tool, its generated
// types lack it, and a tool.call hook on an unknown tool sends TypeScript searching every tool's
// shape until it runs out of memory. This matches the shape the engine writes from TOOL_SPEC.
declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__agent-board__report_progress': { steps: { title: string; status: StepStatus }[] }
  }
}

export const TOOL_SPEC: ToolSpec = {
  name: TOOL_NAME,
  description:
    'Shows your steps on the agent board, for subagents. Send the whole list each time: once when you start, then whenever a step starts or finishes. Keep each title under six words.',
  inputSchema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, status: { type: 'string', enum: STATUSES } },
          required: ['title', 'status'],
        },
      },
    },
    required: ['steps'],
  },
  isDeferred: false,
}

/** Added to every agent's task, so it reports its steps without being asked by Claude. */
export const NUDGE = `\n\nAs you work, report your steps with the ${TOOL} tool: the whole list when you start, then again each time a step starts or finishes.`

export const ok = (message: string) => ({ result: message, text: message })
export const fail = (message: string) => ({ ...ok(message), isError: true as const })

const isStatus = (x: unknown): x is StepStatus => STATUSES.some((s) => s === x)

/** The tool call's `steps`, read with care: the model writes them. Null when any step is malformed. */
export function stepsFromReport(steps: unknown): Step[] | null {
  if (!Array.isArray(steps)) return null
  const out: Step[] = []
  for (const [i, x] of steps.entries()) {
    if (typeof x !== 'object' || x === null) return null
    const { title, status } = x as { title?: unknown; status?: unknown }
    if (typeof title !== 'string' || title.trim() === '' || !isStatus(status)) return null
    out.push({ id: `step${i}`, title: title.trim(), status })
  }
  return out
}

export const isLive = (r: AgentRow) => r.state === 'running' || r.state === 'idle'

function stateOf(s: AgentStatus, isTeammate: boolean): AgentState {
  switch (s) {
    case 'pending':
    case 'running':
      return 'running'
    case 'waiting':
    case 'idle':
      return isTeammate ? 'idle' : 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'killed':
      return 'stopped'
  }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** `claude-opus-5-5` reads `Opus 5.5`; a date suffix is dropped; an alias is capitalised. */
export function prettyModel(m: string | null): string {
  if (m === null) return 'model pending'
  const x = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(m)
  if (x !== null) return `${capital(x[1] ?? '')} ${x[2]}${x[3] === undefined ? '' : `.${x[3]}`}`
  return capital(m)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A stopwatch reading: `0:27`, `12:05`, `1:02:09`. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

export const short = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

/** One request's whole input plus its output. */
const allOf = (u: ModelUsage) =>
  u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens

/** Adds one request's counts; a request already counted (same key) changes nothing. */
export function addTokens(t: AgentTokens | undefined, u: ModelUsage, key: string): AgentTokens {
  if (t?.lastRequest === key) return t
  const all = allOf(u)
  return {
    context: all,
    total: (t?.total ?? 0) + all,
    output: (t?.output ?? 0) + u.output_tokens,
    requests: (t?.requests ?? 0) + 1,
    lastRequest: key,
  }
}

/** The opened card's token line, under its brief. */
export function tokensLine(r: AgentRow): string {
  const t = r.tokens
  if (t === undefined)
    return isLive(r) ? 'Tokens: none yet. The count starts when its first request answers.' : 'Tokens: none reported.'
  const when = isLive(r) ? 'now' : 'at the end'
  const reqs = `${t.requests} request${t.requests === 1 ? '' : 's'}`
  return `Tokens: ${short(t.context)} in its context ${when} · ${short(t.total)} used in all, over ${reqs} · ${short(t.output)} written by it`
}

/** The mark at a card's right edge, and its color. */
export const MARK: Record<AgentState, { glyph: string; color: string }> = {
  running: { glyph: '●', color: 'success' },
  idle: { glyph: '◌', color: 'subtle' },
  done: { glyph: '✓', color: 'success' },
  failed: { glyph: '✗', color: 'error' },
  stopped: { glyph: '■', color: 'subtle' },
  lost: { glyph: '?', color: 'warning' },
}

/** An effort level's name on the board, its color, and the critter's hat. */
export type Tier = { label: string; color: string; hat: Hat }

const TIERS: Record<string, Tier> = {
  low: { label: 'light', color: '#3fb27f', hat: 'light' },
  medium: { label: 'medium', color: '#4c8df6', hat: 'medium' },
  high: { label: 'careful', color: '#d9902f', hat: 'careful' },
  xhigh: { label: 'heavy', color: '#e5534b', hat: 'heavy' },
  max: { label: 'max', color: '#a371f7', hat: 'max' },
}

/** Effort names the tier: low light, medium medium, high careful, xhigh heavy, max max. */
export const tierOf = (effort: string | null): Tier =>
  (effort === null ? undefined : TIERS[effort]) ?? { label: 'tier ?', color: '#8b949e', hat: 'none' }

export const effortText = (r: AgentRow) =>
  r.effort === null ? 'effort ?' : r.isEffortInherited ? `${r.effort} (session)` : r.effort

/** A TodoWrite call's list, which replaces the whole list. */
export const stepsFromTodos = (todos: readonly { content: string; status: StepStatus }[]): Step[] =>
  todos.map((t, i) => ({ id: `todo${i}`, title: t.content, status: t.status }))

/** A TaskCreate call's new task, last in the list. */
export const addStep = (steps: readonly Step[] | undefined, id: string, title: string): Step[] => [
  ...(steps ?? []).filter((s) => s.id !== id),
  { id, title, status: 'pending' },
]

/** A TaskUpdate call's change to one task; `deleted` drops it. A task this board never saw changes nothing. */
export function changeStep(
  steps: readonly Step[] | undefined,
  id: string,
  change: { status?: StepStatus | 'deleted'; title?: string },
): Step[] | undefined {
  if (steps === undefined) return undefined
  if (change.status === 'deleted') return steps.filter((s) => s.id !== id)
  const status = change.status
  return steps.map((s) => (s.id !== id ? s : { ...s, status: status ?? s.status, title: change.title ?? s.title }))
}

/** `3/5 · Hero copy`: items done of all, then the one in progress. Null without a list. */
export function stepLine(steps: readonly Step[] | undefined): string | null {
  if (steps === undefined || steps.length === 0) return null
  const done = steps.filter((s) => s.status === 'completed').length
  const current = steps.find((s) => s.status === 'in_progress')
  return `${done}/${steps.length}${current === undefined ? '' : ` · ${current.title}`}`
}

/** How full the card's bar is: whole when done, else its to-do list's share done. Null draws no bar. */
export function progress(r: AgentRow): number | null {
  if (r.state === 'done') return 1
  const steps = r.steps ?? []
  if (steps.length === 0) return null
  return steps.filter((s) => s.status === 'completed').length / steps.length
}

/** `ctx 2% · 44k tok · 0:27`: context share of the window, tokens used in all, time. */
export function metricsLine(r: AgentRow, t: number, window: number | null): string {
  const time = clockText((r.endedAt ?? t) - r.startedAt)
  const k = r.tokens
  if (k === undefined) return time
  const ctx = window !== null && window > 0 ? `${Math.round((k.context / window) * 100)}%` : short(k.context)
  return `ctx ${ctx} · ${short(k.total)} tok · ${time}`
}

/** The cards at the top: how many agents, tokens used in all, and first start to last end. */
export function totals(rows: readonly AgentRow[], t: number) {
  const tokens = rows.reduce((s, r) => s + (r.tokens?.total ?? 0), 0)
  if (rows.length === 0) return { count: 0, tokens, spanMs: 0 }
  const start = Math.min(...rows.map((r) => r.startedAt))
  const end = Math.max(...rows.map((r) => r.endedAt ?? t))
  return { count: rows.length, tokens, spanMs: end - start }
}

/** An agent spawned while none runs starts a new batch, which clears the last one's cards. */
export const startBatch = (rows: readonly AgentRow[]): AgentRow[] => (rows.some(isLive) ? [...rows] : [])

/** Moves a live row to a new state; an ended row keeps its final state and time. */
export const moveTo = (r: AgentRow, state: AgentState, t: number): AgentRow =>
  isLive(r) ? { ...r, state, endedAt: state === 'running' || state === 'idle' ? null : t } : r

/** The row as its agent's own request reports it: exact model and effort. */
export function observed(r: AgentRow, model: string, level: string | null): AgentRow {
  return level === null ? { ...r, model } : { ...r, model, effort: level, isEffortInherited: false }
}

/** How a subagent's finished turn ends its row; a teammate's turn only idles it. */
export const endingOf = (reason: string, isTeammate: boolean): AgentState =>
  isTeammate ? 'idle' : reason === 'aborted' ? 'stopped' : reason === 'answer' ? 'done' : 'failed'

/** What an agent reported before its spawn's answer linked it to a row. */
export type Early = {
  step?: { model: string; effort: string | null }
  reason?: string
  tokens?: AgentTokens
  steps?: Step[]
}

/** A row once its spawn answers, with whatever its agent reported before that. */
export function settle(r: AgentRow, early: Early | undefined, t: number): AgentRow {
  const seen = early?.step === undefined ? r : observed(r, early.step.model, early.step.effort)
  const known = early?.tokens === undefined ? seen : { ...seen, tokens: early.tokens }
  const listed = early?.steps === undefined ? known : { ...known, steps: early.steps }
  return early?.reason === undefined ? listed : moveTo(listed, endingOf(early.reason, listed.isTeammate), t)
}

/** Folds the engine's agent list into the rows' states. */
export function reconcile(rows: readonly AgentRow[], infos: readonly AgentInfo[], t: number): AgentRow[] {
  const byId = new Map(infos.map((i) => [i.id, i]))
  return rows.map((r) => {
    if (r.agentId === null || !isLive(r)) return r
    const info = byId.get(r.agentId)
    // Listed agents stay listed until well after they end, so a missing one has ended without
    // a report this plugin saw; how it ended is unknown, so it reads lost rather than done.
    // A workflow's agents are never listed; their turn.complete ends them instead.
    if (info === undefined) return r.isWorkflow ? r : moveTo(r, 'lost', t)
    const state = stateOf(info.status, r.isTeammate)
    return state === r.state ? r : moveTo(r, state, t)
  })
}

/** How many of an agent's messages its opened card shows. */
const SHOWN_LINES = 3
/** A longer message is cut to this many characters, so one message cannot fill the board. */
const LINE_CHARS = 280

const clip = (s: string) => (s.length > LINE_CHARS ? `${s.slice(0, LINE_CHARS - 1).trimEnd()}…` : s)

/** `mcp__agent-board__report_progress` reads `report_progress`; a built-in tool keeps its name. */
const toolName = (t: string) => (t.startsWith('mcp__') ? t.slice(t.lastIndexOf('__') + 2) : t)

/** Claude Code's marker in a stopped agent's conversation. It reads as a user message, but nobody wrote it. */
const isStopMarker = (text: string) => /^\[Request interrupted by user[^\]]*\]$/.test(text)

/** One message as a line, or null for one with nothing to read (a tool's answer back to the agent, or a stop). */
function lineOf(m: SessionMessage): ChatLine | null {
  // The board's own nudge rides on every brief; the user did not write it.
  const text = m.text.replace(NUDGE, '').trim()
  if (m.role === 'user') return text === '' || isStopMarker(text) ? null : { who: 'to-agent', text: clip(text) }
  if (text !== '') return { who: 'agent', text: clip(text) }
  const tools = [...new Set(m.toolUses.map((u) => toolName(u.tool)))]
  return tools.length === 0 ? null : { who: 'agent', text: `Used ${tools.join(', ')}` }
}

const sentLine = (s: SentLine): ChatLine => ({ who: 'to-agent', text: clip(s.text) })

/** An agent's last few messages with something to read, oldest first, the user's own sent ones each in its
 *  place. One recorded past the end of what was read back still shows, last. A delivered message can show in
 *  the conversation read back while it waits for the agent; then the board's own copy is left out. */
export function recentLines(messages: readonly SessionMessage[], sentHere: readonly SentLine[]): ChatLine[] {
  const isReadBack = (s: SentLine) =>
    messages.some((m, i) => i >= s.after && m.role === 'user' && m.text.includes(s.text))
  const shown = sentHere.filter((s) => !isReadBack(s))
  const sentAfter = (n: number) => shown.filter((s) => s.after === n).map(sentLine)
  const lines = [
    ...sentAfter(0),
    ...messages.flatMap((m, i) => [lineOf(m), ...sentAfter(i + 1)]),
    ...shown.filter((s) => s.after > messages.length).map(sentLine),
  ]
  return lines.filter((l) => l !== null).slice(-SHOWN_LINES)
}

/** A finished agent woken by a message runs again; a live one is unchanged. */
export const resumed = (r: AgentRow): AgentRow => (isLive(r) ? r : { ...r, state: 'running', endedAt: null })

/** What the user can do after a permission check, such as auto mode's, refused the board's call to a tool. */
export const permissionHint = (tool: CardTool) => `Switch modes, or add ${tool} to your allow list.`

/** The engine gives no way to read the permission mode, so the refusal's own words say whether a check refused
 *  it. "denied" and "needs approval" are how a permission rule's refusals read. */
const isPermissionRefusal = (reason: string) => /auto.?mode|classifier|permission|denied|approval/i.test(reason)

/** The tools a card's buttons use, and what a refusal of each says first. */
const REFUSED = { SendMessage: 'Not sent', TaskStop: 'Not stopped' } as const
type CardTool = keyof typeof REFUSED

/** The note under the box after a card's send or stop was refused: only what to do when a permission check
 *  refused it (its own reason is written for Claude, not the user), else the reason. */
export function refusalNote(tool: CardTool, reason: string): string {
  return isPermissionRefusal(reason) ? permissionHint(tool) : `${REFUSED[tool]}: ${reason.trim().replace(/\.+$/, '')}.`
}
