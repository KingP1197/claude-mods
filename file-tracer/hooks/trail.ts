import type { LogEntry, RanEntry, TouchEntry } from '../types'
import type { Helper, Turn } from './log'
import { locationOf } from './paths'

/** The Trail pane's id: its own, so the app draws it as a tab beside Files. */
export const TRAIL_PANE = 'file-tracer-trail'

/** The Trail pane's title. */
export const TRAIL_TITLE = 'Trail'

/** What the header of a Turn with no prompt says: the Touches before the user's first prompt. */
const NO_PROMPT = 'Before the first prompt'

/** What the timeline's picture says of its cell: a branch with more below it, or the last one. */
export const TIMELINE_ALT = { tee: 'timeline branch', elbow: 'timeline end' } as const

/** A row inside a helper's box: a folder row, a Touch, or a command the helper ran. */
export type BoxRow =
  { kind: 'folder'; label: string } | { kind: 'touch'; entry: TouchEntry } | { kind: 'ran'; entry: RanEntry }

/** One helper's Touches within one Turn: its type, its description (empty when it has none), its Touch count in the Turn, and the rows that fit. */
export type HelperBox = { kind: 'helper'; id: string; type: string; description: string; count: number; rows: BoxRow[] }

/** One row of a Turn on the timeline: Claude's own rows stand in the open, each helper's Touches in one box. */
export type TrailRow = BoxRow | { kind: 'ran'; entry: RanEntry } | HelperBox

/** What the Trail draws beyond the log: the helpers' names, and whether the person chose `Show Claude only`. */
export type TrailView = { helpers: Helper[]; isClaudeOnly: boolean }

/** One Turn of the Trail as it draws: its header and, while it is open, its rows. */
export type TrailTurn = {
  n: number
  text: string
  count: number
  isOpen: boolean
  /** The Touches of an open Turn that are left out of its rows for want of room, the oldest. */
  earlier: number
  rows: TrailRow[]
}

/** Where the Trail is drawn: the session's folder, which folder names start from, and the home folder. */
export type TrailPlace = { cwd: string; home: string | null }

/** What the Trail draws with, beyond the log: where it is drawn, and the helpers' names and the choice of `Show Claude only`. */
type TrailContext = { place: TrailPlace; view: TrailView }

/** The name of the folder a file sits in, ending in a slash: from the session's folder inside the project, from `~` under the home folder, whole otherwise. */
function folderLabel(path: string, where: TrailPlace): string {
  const dir = path.slice(0, path.lastIndexOf('/'))
  if (dir === where.cwd) return './'
  if (dir.startsWith(`${where.cwd}/`)) return `${dir.slice(where.cwd.length + 1)}/`
  return `${locationOf(dir, where.home)}/`
}

/** The id of the helper that made an entry, or null for Claude's own Touches and commands and for the Touches of a command Claude ran. */
const helperOf = (e: LogEntry): string | null => {
  if (e.type === 'ran') return e.helperId ?? null
  return e.by.kind === 'helper' ? e.by.id : null
}

/** What the Trail calls a helper it has no stored name for. */
const UNKNOWN_HELPER = 'Helper'

/** The rows one entry draws: a command's Ran row, or a Touch's row with a folder row before it where its folder is not `at`, the folder of the Touch before. `at` is the folder the entry leaves the Trail in. */
function rowsFor(entry: LogEntry, at: string | null, where: TrailPlace): { rows: BoxRow[]; at: string | null } {
  if (entry.type === 'ran') return { rows: [{ kind: 'ran', entry }], at }
  const label = folderLabel(entry.path, where)
  const folder: BoxRow[] = label === at ? [] : [{ kind: 'folder', label }]
  return { rows: [...folder, { kind: 'touch', entry }], at: label }
}

/** The rows of a box's entries, a folder row before the first Touch and before each that sits in another folder than the Touch before. */
function foldered(entries: LogEntry[], where: TrailPlace): BoxRow[] {
  let at: string | null = null
  return entries.flatMap((entry) => {
    const step = rowsFor(entry, at, where)
    at = step.at
    return step.rows
  })
}

/**
 * The rows of a Turn's entries. Claude's own go in the open: a row for each command and each Touch, with a folder row
 * before the first Touch and before each that sits in another folder than the Touch before. Each helper's Touches go
 * in one box, where the first of them stands, with folder rows of its own. `totals` is each helper's Touch count in
 * the Turn, drawn in its box's header.
 */
function turnRows(entries: LogEntry[], ctx: TrailContext, totals: Map<string, number>): TrailRow[] {
  const boxes = new Map<string, LogEntry[]>()
  const order: Array<{ own: LogEntry } | { id: string }> = []
  for (const e of entries) {
    const id = helperOf(e)
    if (id === null) order.push({ own: e })
    else if (boxes.has(id)) boxes.get(id)?.push(e)
    else {
      boxes.set(id, [e])
      order.push({ id })
    }
  }
  let at: string | null = null
  return order.flatMap((item): TrailRow[] => {
    if ('id' in item) {
      const helper = ctx.view.helpers.find((h) => h.id === item.id)
      const rows = foldered(boxes.get(item.id) ?? [], ctx.place)
      const [type, description] = helper === undefined ? [UNKNOWN_HELPER, ''] : [helper.type, helper.description.trim()]
      return [{ kind: 'helper', id: item.id, type, description, count: totals.get(item.id) ?? 0, rows }]
    }
    const step = rowsFor(item.own, at, ctx.place)
    at = step.at
    return step.rows
  })
}

/** What is left of the drawing's room: rows and characters. */
type Room = { slots: number; chars: number }

/**
 * The room one drawing gives the Trail. The engine cuts a drawing off at 100,000 characters of text and refuses one of
 * more than 20,000 elements, and the log holds up to 2,000 Touches in as many Turns, so the Trail draws the newest.
 */
const FULL_ROOM: Room = { slots: 400, chars: 60_000 }

/** The room a Turn's header takes: one slot, the prompt, and a little for the chevron and the count. */
const headerCost = (text: string): Room => ({ slots: 1, chars: text.length + 20 })

/** The room a log entry takes: two slots, since a Touch may bring a folder row with it, and the characters it draws, a path's at most. */
const entryCost = (e: LogEntry): Room => ({
  slots: 2,
  chars: (e.type === 'ran' ? e.command.length : e.path.length) + 24,
})

const addCosts = (a: Room, b: Room): Room => ({ slots: a.slots + b.slots, chars: a.chars + b.chars })
const fits = (room: Room, cost: Room) => cost.slots <= room.slots && cost.chars <= room.chars
const spend = (room: Room, cost: Room): Room => ({ slots: room.slots - cost.slots, chars: room.chars - cost.chars })

/** The room a helper's box takes besides its Touches: the box, its header, the header's words and a little for the count. */
function boxCost(id: string, helpers: Helper[]): Room {
  const helper = helpers.find((h) => h.id === id)
  const words = helper === undefined ? UNKNOWN_HELPER.length : helper.type.length + helper.description.length
  return { slots: 2, chars: words + 24 }
}

/** The newest of a Turn's entries that fit in the room, oldest first, and the room left. A helper's box is paid for with its newest Touch that is kept. */
function newestFitting(entries: LogEntry[], room: Room, helpers: Helper[]) {
  let left = room
  const kept: LogEntry[] = []
  const boxed = new Set<string>()
  for (const e of entries.toReversed()) {
    const id = helperOf(e)
    const cost = id === null || boxed.has(id) ? entryCost(e) : addCosts(entryCost(e), boxCost(id, helpers))
    if (!fits(left, cost)) break
    left = spend(left, cost)
    if (id !== null) boxed.add(id)
    kept.unshift(e)
  }
  return { kept, left }
}

/** The entries of the log by Turn number. */
function byTurn(log: LogEntry[]): Map<number, LogEntry[]> {
  const found = new Map<number, LogEntry[]>()
  for (const e of log) {
    const entries = found.get(e.turn)
    if (entries === undefined) found.set(e.turn, [e])
    else entries.push(e)
  }
  return found
}

const touchesIn = (entries: LogEntry[]) => entries.filter((e) => e.type === 'touch').length

/** The Trail: the Turns that fit, newest first, and how many older Turns were left out. */
export type Trail = { turns: TrailTurn[]; older: number }

/** Each helper's Touch count among the entries of a Turn. */
function totalsOf(entries: LogEntry[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of entries.filter((x) => x.type === 'touch')) {
    const id = helperOf(e)
    if (id !== null) totals.set(id, (totals.get(id) ?? 0) + 1)
  }
  return totals
}

/** The Turn as it draws and the room left after it. An open Turn draws the newest of its entries that fit; with `Show Claude only`, the helpers' entries are not among them. */
function turnOf(n: number, entries: LogEntry[], text: string, isOpen: boolean, ctx: TrailContext, room: Room) {
  const visible = ctx.view.isClaudeOnly ? entries.filter((e) => helperOf(e) === null) : entries
  const { kept, left } = newestFitting(isOpen ? visible : [], room, ctx.view.helpers)
  const earlier = isOpen ? touchesIn(visible) - touchesIn(kept) : 0
  const rows = turnRows(kept, ctx, totalsOf(entries))
  return { turn: { n, text, count: touchesIn(entries), isOpen, earlier, rows }, left }
}

/**
 * The Turns that hold Touches, newest first, as many as fit in one drawing. A Turn the user closed keeps its header
 * and count and no rows; a Turn too long for the room draws its newest rows. A Turn without a saved prompt is the one
 * before the first prompt.
 */
export function trailOf(log: LogEntry[], turns: Turn[], closed: number[], place: TrailPlace, view: TrailView): Trail {
  const grouped = byTurn(log)
  const numbers = [...grouped.keys()].sort((a, b) => b - a)
  let room = FULL_ROOM
  const shown: TrailTurn[] = []
  for (const n of numbers) {
    const text = turns.find((t) => t.n === n)?.text || NO_PROMPT
    if (!fits(room, headerCost(text)) && shown.length > 0) break
    const done = turnOf(
      n,
      grouped.get(n) ?? [],
      text,
      !closed.includes(n),
      { place, view },
      spend(room, headerCost(text)),
    )
    room = done.left
    shown.push(done.turn)
  }
  return { turns: shown, older: numbers.length - shown.length }
}
