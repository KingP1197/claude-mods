// The agent cards' data and wording. Nothing here calls the engine: the
// validator follows `$` only within one file, so the hooks live in register.tsx.
// A card appears when an agent spawns. Finished cards stay until the next batch
// starts, that is, until an agent spawns while none is running.
import type { ToolSpec } from 'claude-code'

import type { AgentRow, AgentState, Step, StepStatus } from '../../types'
import { reasonText } from '../failures'
import { isLive, isLiveState } from '../live'
import type { BarKind, Hat } from './critter'

export const PANE = 'agent-board'
export const TITLE = 'Agents'
export const COMMAND = 'agent-board'

/** The two sections of an open card that close; its footer does not. */
export type SectionName = 'brief' | 'transcript'

// Subagents get no to-do tools, so the board gives them its own: a whole list of steps per call.
const TOOL_NAME = 'report_progress'
export const TOOL = `mcp__desk__${TOOL_NAME}`

const STATUSES: readonly StepStatus[] = ['pending', 'in_progress', 'completed']

// The tool's input, by hand: until the engine has loaded this mod with the tool, its generated
// types lack it, and a tool.call hook on an unknown tool sends TypeScript searching every tool's
// shape until it runs out of memory. This matches the shape the engine writes from TOOL_SPEC.
declare module 'claude-code' {
  interface McpToolInputs {
    mcp__desk__report_progress: { steps: { title: string; status: StepStatus }[] }
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

/** What sets a line's parts apart where they share a row: the token line's, and the rows `partRows` packs. */
export const PART_SEP = ' | '

/** The opened card's token line in its parts, which the line joins with PART_SEP; a row breaks only between them. */
export function tokenParts(r: AgentRow): string[] {
  const t = r.tokens
  if (t === undefined)
    return [isLive(r) ? 'Tokens: none yet. The count starts when its first request answers.' : 'Tokens: none reported.']
  const when = isLive(r) ? 'now' : 'at the end'
  const reqs = `${t.requests} request${t.requests === 1 ? '' : 's'}`
  return [
    `Tokens: ${short(t.context)} in its context ${when}`,
    `${short(t.total)} used in all, over ${reqs}`,
    `${short(t.output)} written by it`,
  ]
}

/** The opened card's token line, under its brief. */
export const tokensLine = (r: AgentRow): string => tokenParts(r).join(PART_SEP)

/** The mark at a card's right edge, with the word that names the state, both in the state's colour.
 *  Only the running word is bold: Claude's colour on text is bold throughout the design system.
 *  `short` is the word where the full one does not fit beside the name (see `stateWord` in header.ts):
 *  Running reads `live`, Waiting `idle`, Failed `fail`, Stopped `stop`; Done and Lost are short already. */
export const MARK: Record<
  AgentState,
  { glyph: string; word: string; short: string; color: string; isWordBold: boolean }
> = {
  running: { glyph: '●', word: 'Running', short: 'live', color: 'claude', isWordBold: true },
  idle: { glyph: '◌', word: 'Waiting', short: 'idle', color: 'inactive', isWordBold: false },
  done: { glyph: '✓', word: 'Done', short: 'Done', color: 'success', isWordBold: false },
  failed: { glyph: '✗', word: 'Failed', short: 'fail', color: 'error', isWordBold: false },
  stopped: { glyph: '■', word: 'Stopped', short: 'stop', color: 'inactive', isWordBold: false },
  lost: { glyph: '?', word: 'Lost', short: 'Lost', color: 'warning', isWordBold: false },
}

/** Which fill a card's bar wears: orange while it runs, red when it failed, grey once it ended otherwise. */
export const barKindOf = (state: AgentState): BarKind =>
  isLiveState(state) ? 'live' : state === 'failed' ? 'failed' : 'done'

/** The terminal's bar cannot draw the Svg's hex, so each kind takes a theme key. */
export const BAR_KEY: Record<BarKind, string> = { live: 'claude', done: 'inactive', failed: 'error' }

/** An effort level as the board shows it: its name and the critter's hat. */
export type Tier = { label: string; hat: Hat }

const HATS: Record<string, Hat> = { low: 'light', medium: 'medium', high: 'careful', xhigh: 'heavy', max: 'max' }

/** The card names the real effort level; each level keeps its own hat. */
export const tierOf = (effort: string | null): Tier => ({
  label: effort ?? 'effort —',
  hat: (effort === null ? undefined : HATS[effort]) ?? 'none',
})

/** A TodoWrite call's list, which replaces the whole list. */
export const stepsFromTodos = (todos: readonly { content: string; status: StepStatus }[]): Step[] =>
  todos.map((t, i) => ({ id: `todo${i}`, title: t.content, status: t.status }))

/** `3/5 | Hero copy`: items done of all, then the one in progress. Null without a list. */
function stepLine(steps: readonly Step[] | undefined): string | null {
  if (steps === undefined || steps.length === 0) return null
  const done = steps.filter((s) => s.status === 'completed').length
  const current = steps.find((s) => s.status === 'in_progress')
  return `${done}/${steps.length}${current === undefined ? '' : ` | ${current.title}`}`
}

/** The card's step line: the count done and the step in progress. How the agent ended is the header's word to say. */
export const cardLine = (r: AgentRow): string | null => stepLine(r.steps)

/** How full the card's bar is: whole when done, else its to-do list's share done. Null draws no bar. */
export function progress(r: AgentRow): number | null {
  if (r.state === 'done') return 1
  const steps = r.steps ?? []
  if (steps.length === 0) return null
  return steps.filter((s) => s.status === 'completed').length / steps.length
}

/**
 * The stats parts: context share of the window, tokens used in all, time (`ctx 2%`, `44k tok`, `0:27`). `full` keeps
 * the word `tok` after the tokens; `bare` leaves it off, for a header with too little room (the user's ruling of
 * 2026-10-15). An agent with no request answered yet has the time alone, in both.
 */
export type StatParts = { full: string[]; bare: string[] }

/** The stats parts of a card at time `t`, given the model's context window if known. */
export function statParts(r: AgentRow, t: number, window: number | null): StatParts {
  const time = clockText((r.endedAt ?? t) - r.startedAt)
  const k = r.tokens
  if (k === undefined) return { full: [time], bare: [time] }
  const ctx = window !== null && window > 0 ? `${Math.round((k.context / window) * 100)}%` : short(k.context)
  const tokens = short(k.total)
  return { full: [`ctx ${ctx}`, `${tokens} tok`, time], bare: [`ctx ${ctx}`, tokens, time] }
}

/** The cards at the top: how many agents, tokens used in all, and first start to last end. */
export function totals(rows: readonly AgentRow[], t: number) {
  const tokens = rows.reduce((s, r) => s + (r.tokens?.total ?? 0), 0)
  if (rows.length === 0) return { count: 0, tokens, spanMs: 0 }
  const start = Math.min(...rows.map((r) => r.startedAt))
  const end = Math.max(...rows.map((r) => r.endedAt ?? t))
  return { count: rows.length, tokens, spanMs: end - start }
}

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
  if (isPermissionRefusal(reason)) return permissionHint(tool)
  return `${REFUSED[tool]}: ${reasonText(reason)}.`
}
