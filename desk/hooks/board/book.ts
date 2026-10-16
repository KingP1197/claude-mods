// The Agent Book: every fact about an agent, applied to its card in one place, and every card's state decided here.
// Nothing here calls the engine. The engine answers a spawn only once the agent has started, so the agent's own
// reports can come first. Those wait in the early store, its own saved value under the key `early`, each with its
// time, until the spawn answers and links the card to its agent.
import type { AgentInfo, AgentSpawnInput, AgentStatus } from 'claude-code'

import type {
  AgentReport,
  AgentRow,
  AgentState,
  AgentTokens,
  EarlyReport,
  EarlyReports,
  FactTimes,
  Step,
} from '../../types'
import { isLive, isLiveState } from '../live'

/** A card whose spawn has not answered: live, with no agent linked yet. */
const isPending = (r: AgentRow) => r.agentId === null && isLive(r)

/** What the board learns about an agent from the engine and the user, beside the agent's own reports. */
type BoardFact =
  /** The spawn answered: the agent's id, null when a hook answered without starting one, and its model. */
  | { kind: 'linked'; agentId: string | null; model: string }
  /** The spawn was refused: the card goes. */
  | { kind: 'refused' }
  /** The engine's agent list names the agent with this status. */
  | { kind: 'listed'; status: AgentStatus }
  /** The engine's agent list leaves the agent out. */
  | { kind: 'missing' }
  /** The user's Stop went through. */
  | { kind: 'stopped' }
  /** The user's message woke the agent. */
  | { kind: 'resumed' }
  /** A reload of the board cut off the spawn this card waits on, so no answer will come. */
  | { kind: 'abandoned' }

/** Every fact about an agent. */
export type Fact = AgentReport | BoardFact

/** Which card a fact is about: by the card's own id until its spawn answers, else by its agent. */
type Card = { id: string } | { agentId: string }

/** A new agent's card, before its spawn answers. */
export function newCard(
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
    isTeammate: e.isTeammate === true,
    isWorkflow: e.workflow !== undefined,
    parentAgentId: e.parentAgentId ?? null,
    task: e.prompt,
    startedAt: t,
    endedAt: null,
    state: 'running',
  }
}

/** The highest counter among the cards' ids (`<tool_use_id>#<n>`), or 0 for none. A reloaded board starts its counter
 *  from it, so a new card never takes an id a saved card has. */
export const highestCounter = (rows: readonly AgentRow[]): number =>
  Math.max(0, ...rows.map((r) => Number(/#(\d+)$/.exec(r.id)?.[1] ?? 0)))

/** The ids of the cards still waiting on a spawn that this copy of the board is not running. UNVERIFIED: this reads
 *  such a spawn as cut off by the reload, so its answer will never come. The engine's docs say only that a reload
 *  cancels a plugin's pending clock waits; they do not say what becomes of a hook awaiting `next`. The premise is
 *  harmless either way: if the old hook does answer, its link revives the card (see `revived`). */
export const orphanIds = (rows: readonly AgentRow[], running: ReadonlySet<string>): string[] =>
  rows.filter((r) => isPending(r) && !running.has(r.id)).map((r) => r.id)

/** An agent spawned while none is live starts a new batch, which clears the last one's cards. */
export const startBatch = (rows: readonly AgentRow[]): AgentRow[] => (rows.some(isLive) ? [...rows] : [])

/** The cards once a fact about one of them is applied at time `t`. Applying a fact twice changes nothing more. */
export function apply(rows: readonly AgentRow[], card: Card, fact: Fact, t: number): AgentRow[] {
  const isIt = (r: AgentRow) => ('id' in card ? r.id === card.id : r.agentId === card.agentId)
  if (fact.kind === 'refused') return rows.filter((r) => !isIt(r))
  return rows.map((r) => (isIt(r) ? applied(r, fact, t) : r))
}

/** The arrival number of the last early report a card applied, or -1 for none. Older cards lack the field. */
const appliedUpTo = (r: AgentRow): number => r.earlyApplied ?? -1

/**
 * The cards once an agent's early reports are applied, oldest first, each at the time it came. The card records the
 * last one it applied and skips any it already holds, so a report taken twice, as after a reload, applies once.
 */
export function withEarly(rows: readonly AgentRow[], agentId: string, reports: readonly EarlyReport[]): AgentRow[] {
  const card = rows.find((r) => r.agentId === agentId)
  if (card === undefined) return [...rows]
  const fresh = reports.filter((x) => x.n > appliedUpTo(card)).sort((a, b) => a.n - b.n)
  const last = fresh.at(-1)
  if (last === undefined) return [...rows]
  return fresh
    .reduce((list, x) => apply(list, { agentId }, x.report, x.t), [...rows])
    .map((r) => (r.agentId === agentId ? { ...r, earlyApplied: last.n } : r))
}

/** Folds the engine's agent list into the cards. A workflow's agents are never listed; their turn's end ends them. */
export function reconcile(rows: readonly AgentRow[], infos: readonly AgentInfo[], t: number): AgentRow[] {
  const byId = new Map(infos.map((i) => [i.id, i]))
  return rows.map((r) => {
    if (r.agentId === null || !isLive(r)) return r
    const info = byId.get(r.agentId)
    return applied(r, info === undefined ? { kind: 'missing' } : { kind: 'listed', status: info.status }, t)
  })
}

/** A card once its spawn answers. A hook that answers without starting an agent leaves nothing to report: the card
 *  would run forever, so it reads lost. */
function linkedTo(r: AgentRow, f: Extract<Fact, { kind: 'linked' }>, t: number): AgentRow {
  return f.agentId === null
    ? moveTo({ ...r, model: f.model }, 'lost', t)
    : revived({ ...r, agentId: f.agentId, model: f.model })
}

/** A card cut off by a reload, once its spawn answers after all: it runs again. A card lost for any other reason
 *  stays lost. */
function revived(r: AgentRow): AgentRow {
  if (r.isAbandoned !== true) return r
  const { isAbandoned: _cutOff, ...rest } = r
  return { ...rest, state: 'running', endedAt: null }
}

function applied(r: AgentRow, f: Exclude<Fact, { kind: 'refused' }>, t: number): AgentRow {
  switch (f.kind) {
    case 'linked':
      return linkedTo(r, f, t)
    case 'listed':
      return moveTo(r, stateOf(f.status, r.isTeammate), t)
    case 'missing':
      // Listed agents stay listed until well after they end, so a missing one ended without a report the board saw.
      // How it ended is unknown, so it reads lost rather than done.
      return r.isWorkflow ? r : moveTo(r, 'lost', t)
    case 'stopped':
      return moveTo(r, 'stopped', t)
    case 'abandoned':
      // A card that linked meanwhile has its agent; only one still waiting is cut off.
      return isPending(r) ? { ...moveTo(r, 'lost', t), isAbandoned: true } : r
    case 'resumed':
      return isLive(r) ? r : { ...r, state: 'running', endedAt: null, factAt: { ...r.factAt, wake: t } }
    default:
      return reported(r, f, t)
  }
}

/** A card once its agent's own report is applied. */
function reported(r: AgentRow, f: AgentReport, t: number): AgentRow {
  switch (f.kind) {
    case 'step':
      return newer(r, 'step', t, () =>
        f.effort === null ? { ...r, model: f.model } : { ...r, model: f.model, effort: f.effort },
      )
    case 'usage':
      return withUsage(r, f, t)
    case 'steps':
    case 'stepAdded':
    case 'stepChanged':
      return withSteps(r, f, t)
    case 'ended':
      // A report of an end that came before the user's wake describes the run the wake began again.
      return isOlder(r, 'wake', t) ? r : moveTo(r, endingOf(f.reason, r.isTeammate), t)
  }
}

/** How many counted requests a card remembers: the latest 50, which bounds the saved list at 50 keys. A request older
 *  than those, seen again, counts again. */
const REMEMBERED = 50

/** A card once one request's counts are applied. Every request's tokens count once, even when an older request
 *  comes again after a newer one, but only the newest request says how full the context is. */
function withUsage(r: AgentRow, f: Extract<AgentReport, { kind: 'usage' }>, t: number): AgentRow {
  if (r.counted?.includes(f.key) === true) return r
  const tokens = addTokens(r.tokens, f.usage, f.key)
  const shown = r.tokens !== undefined && isOlder(r, 'usage', t) ? { ...tokens, context: r.tokens.context } : tokens
  const counted = tokens === r.tokens ? r.counted : [...(r.counted ?? []), f.key].slice(-REMEMBERED)
  return newer(r, 'usage', t, () => ({ ...r, tokens: shown, ...(counted === undefined ? {} : { counted }) }), false)
}

/** A card once a change to its Steps is applied. A whole list older than the card's last change to its Steps is
 *  skipped, and so is a change to one step older than that step's last change; a change to another step still holds
 *  news, so it applies. A single step added or changed before the whole list was last set is skipped as well. */
function withSteps(r: AgentRow, f: Extract<AgentReport, { kind: 'steps' | 'stepAdded' | 'stepChanged' }>, t: number) {
  switch (f.kind) {
    case 'steps':
      return listed(
        r,
        newer(r, 'steps', t, () => ({ ...r, steps: f.steps })),
        t,
      )
    case 'stepAdded':
      return isOlder(r, 'list', t)
        ? r
        : newer(r, 'steps', t, () => ({ ...r, steps: addStep(r.steps, f.id, f.title) }), false)
    case 'stepChanged': {
      const steps = changeStep(r.steps, f.id, f)
      return steps === undefined || isOlder(r, 'list', t)
        ? r
        : stepNewer(
            r,
            f.id,
            t,
            newer(r, 'steps', t, () => ({ ...r, steps }), false),
          )
    }
  }
}

/** True when a fact of `kind` that came at `t` is older than the card's last change of that kind. A card with no
 *  time kept for the kind has nothing newer. A single step older than the whole Steps list (`list`) is one such: the
 *  list already holds its news. */
const isOlder = (r: AgentRow, kind: keyof FactTimes, t: number): boolean => t < (r.factAt?.[kind] ?? t)

/** `next`, the card once a whole list came at `t`, with the time of the list kept when it changed the card. */
function listed(r: AgentRow, next: AgentRow, t: number): AgentRow {
  if (next === r) return r
  return { ...next, factAt: { ...next.factAt, list: Math.max(t, r.factAt?.list ?? t) } }
}

/** `next`, a change to one step that came at `t`, unless that step changed later; the card keeps when it did. */
function stepNewer(r: AgentRow, id: string, t: number, next: AgentRow): AgentRow {
  const last = r.stepAt?.[id] ?? t
  if (t < last || next === r) return r
  return { ...next, stepAt: { ...r.stepAt, [id]: Math.max(t, last) } }
}

/**
 * The card with a new value of one kind, from a fact that came at `t`. A fact older than the card's last change of
 * that kind changes nothing, as a late report must not undo a newer one, unless `canSkip` is false. A fact that
 * changes nothing leaves the card, and the time of its last change, as they were.
 */
function newer(r: AgentRow, kind: keyof FactTimes, t: number, change: () => AgentRow, canSkip = true): AgentRow {
  const last = r.factAt?.[kind] ?? t
  if (canSkip && isOlder(r, kind, t)) return r
  const next = change()
  return JSON.stringify(next) === JSON.stringify(r)
    ? r
    : { ...next, factAt: { ...r.factAt, [kind]: Math.max(t, last) } }
}

/** Moves a live card to a new state; an ended card keeps its final state and time. */
const moveTo = (r: AgentRow, state: AgentState, t: number): AgentRow =>
  isLive(r) ? { ...r, state, endedAt: isLiveState(state) ? null : t } : r

/** How a subagent's finished turn ends its card; a teammate's turn only idles it. */
const endingOf = (reason: string, isTeammate: boolean): AgentState =>
  isTeammate ? 'idle' : reason === 'aborted' ? 'stopped' : reason === 'answer' ? 'done' : 'failed'

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

type Usage = Extract<AgentReport, { kind: 'usage' }>['usage']

/** One request's whole input plus its output. */
const allOf = (u: Usage) => u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens

/** Adds one request's counts. It guards only the last request counted, a fallback for cards saved before `counted`
 *  existed; `withUsage` guards the earlier ones. */
export function addTokens(t: AgentTokens | undefined, u: Usage, key: string): AgentTokens {
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

/** A TaskCreate call's new step, last in the list. */
const addStep = (steps: readonly Step[] | undefined, id: string, title: string): Step[] => [
  ...(steps ?? []).filter((s) => s.id !== id),
  { id, title, status: 'pending' },
]

/** A TaskUpdate call's change to one step; `deleted` drops it. A step this board never saw changes nothing. */
function changeStep(
  steps: readonly Step[] | undefined,
  id: string,
  change: Extract<AgentReport, { kind: 'stepChanged' }>,
): Step[] | undefined {
  if (steps === undefined) return undefined
  if (change.status === 'deleted') return steps.filter((s) => s.id !== id)
  const status = change.status
  return steps.map((s) => (s.id !== id ? s : { ...s, status: status ?? s.status, title: change.title ?? s.title }))
}

/** Where a report about `agentId` goes: onto its card, into the early store while some spawn has not answered,
 *  or nowhere, as no card can link to it any more. */
export function whereTo(rows: readonly AgentRow[], agentId: string): 'card' | 'early' | 'nowhere' {
  if (rows.some((r) => r.agentId === agentId)) return 'card'
  return rows.some(isPending) ? 'early' : 'nowhere'
}

const EMPTY: EarlyReports = { byAgent: {}, next: 0 }

/** The early store as saved, or an empty one where the saved value is damaged. */
const sound = (store: EarlyReports): EarlyReports =>
  typeof store === 'object' &&
  store !== null &&
  typeof store.byAgent === 'object' &&
  store.byAgent !== null &&
  typeof store.next === 'number'
    ? store
    : EMPTY

/** The store with one more report waiting for `agentId`'s card. */
export function noted(saved: EarlyReports, agentId: string, report: AgentReport, t: number): EarlyReports {
  const store = sound(saved)
  const waiting = store.byAgent[agentId] ?? []
  return {
    byAgent: { ...store.byAgent, [agentId]: [...waiting, { report, t, n: store.next }] },
    next: store.next + 1,
  }
}

/** The reports waiting for `agentId`'s card, left in the store until the card that applies them is saved. */
export const waitingFor = (saved: EarlyReports, agentId: string): EarlyReport[] => sound(saved).byAgent[agentId] ?? []

/** The store without the reports their cards have already applied. */
export function withoutApplied(saved: EarlyReports, rows: readonly AgentRow[]): EarlyReports {
  const store = sound(saved)
  const upTo = new Map(rows.flatMap((r) => (r.agentId === null ? [] : [[r.agentId, appliedUpTo(r)] as const])))
  const byAgent: Record<string, EarlyReport[]> = {}
  for (const [agentId, reports] of Object.entries(store.byAgent)) {
    const kept = reports.filter((x) => x.n > (upTo.get(agentId) ?? -1))
    if (kept.length > 0) byAgent[agentId] = kept
  }
  return { ...store, byAgent }
}

/**
 * The store without the reports that can never reach a card: once no spawn is waiting for its answer, a report for
 * an agent no card carries is dropped. Only reports numbered below `before` go, those that came before the cards
 * were read; one that came after may belong to a spawn begun since.
 */
export function pruned(saved: EarlyReports, rows: readonly AgentRow[], before: number): EarlyReports {
  const store = sound(saved)
  if (rows.some(isPending)) return store
  const carried = new Set(rows.map((r) => r.agentId))
  const byAgent: Record<string, EarlyReport[]> = {}
  for (const [agentId, reports] of Object.entries(store.byAgent)) {
    const kept = carried.has(agentId) ? reports : reports.filter((x) => x.n >= before)
    if (kept.length > 0) byAgent[agentId] = kept
  }
  return { ...store, byAgent }
}

/** The arrival number the next report gets: every report below it came before this read. */
export const nextNumber = (saved: EarlyReports): number => sound(saved).next
