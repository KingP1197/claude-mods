import type { LogEntry, RanEntry, TouchBy, TouchEntry } from '../types'
import { endCut } from './paths'
import type { Touch } from './record'
import { countPair, diffCounts, type LineCounts } from './tree'

/** The longest text whose lines are counted: the same bound as the code view's, so a huge file costs no diff. */
const MAX_COUNTED_TEXT = 100_000

/** What the mod knows of a Touch's file besides the Touch: the text it has now where the mod read it, and the text the records held before the Touch. */
export type Known = { after: string | null; had: string | null }

/**
 * The lines a Touch added and removed: its text after against its text before. None for a Touch that changed nothing
 * (a Read) and for one whose before or after text the mod does not have. The text before is the Touch's own baseline,
 * else the text the records last held.
 */
export function countsOfTouch(touch: Touch, known: Known): LineCounts | null {
  if (touch.tag === 'Read') return null
  const [before, after] = [touch.baseline ?? known.had, touch.tag === 'Deleted' ? '' : (touch.seen ?? known.after)]
  if (before === null || after === null) return null
  return before.length > MAX_COUNTED_TEXT || after.length > MAX_COUNTED_TEXT ? null : diffCounts(before, after)
}

/** The most entries the log keeps, and the most Turns: the newest, so saved state stays far below the engine's size limit. */
const MAX_LOG = 2000

/**
 * The most entries the log's newest piece holds before they move into the older piece. Each write costs as much as
 * the piece it writes, so the newest piece stays small and the older one is written once for this many Touches.
 */
export const MAX_TAIL = 50

/** A Touch about to be logged: the entry without its number. */
export type NewTouch = Omit<TouchEntry, 'n' | 'type'>

/** The number of the last Touch among the entries, or null where there is none. */
export function lastNumber(entries: LogEntry[]): number | null {
  const last = entries.findLast((e): e is TouchEntry => e.type === 'touch')
  return last?.n ?? null
}

/** The entries with each Touch given the number after `base`, in session order; a Ran entry takes none. */
export function numbered(base: number, entries: Array<RanEntry | NewTouch>): LogEntry[] {
  let next = base
  return entries.map((e): LogEntry => {
    if ('type' in e) return e
    next += 1
    return { type: 'touch', n: next, ...e }
  })
}

/**
 * The older piece of the log with the newer piece after it. A write that stopped between the two pieces leaves the
 * newer piece's first entries in the older piece too; those are left out here, a Ran entry going with its Touches.
 */
function merged(older: LogEntry[], newer: LogEntry[]): LogEntry[] {
  const seen = lastNumber(older) ?? 0
  const first = newer.findIndex((e) => e.type === 'touch' && e.n > seen)
  if (first === -1) return older
  return [...older, ...newer.slice(newer[first - 1]?.type === 'ran' ? first - 1 : first)]
}

/** The log as the mod reads it: the older piece and the newer piece as one, the newest 2,000 entries. */
export const logOf = (older: LogEntry[], newer: LogEntry[]): LogEntry[] => merged(older, newer).slice(-MAX_LOG)

/** Runs the jobs it is given one after another, so two Touches raised together number and write the log one at a time. */
export function inOrder() {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(job: () => Promise<T>): Promise<T> => {
    const run = last.then(job)
    last = run.catch(() => undefined)
    return run
  }
}

/** The Touches of one file, oldest first. A moved file's Touches include those at the places it moved from, back to before the move, and none of a later file at such a place. */
export function touchesOf(log: LogEntry[], path: string): TouchEntry[] {
  const found: TouchEntry[] = []
  let at = path
  for (const e of log.toReversed()) {
    if (e.type !== 'touch' || e.path !== at) continue
    found.unshift(e)
    at = e.oldPath ?? at
  }
  return found
}

/** Where the file of a Touch is now: its path, followed through the moves logged after the Touch. */
export function currentPath(log: LogEntry[], touch: TouchEntry): string {
  return log.reduce((at, e) => (e.type === 'touch' && e.n > touch.n && e.oldPath === at ? e.path : at), touch.path)
}

/** The first line of a text, such as a shell command or a prompt: what the log keeps of it. */
export const commandLine = (command: string): string => command.split(/\r?\n/)[0] ?? ''

/** A helper Claude started: its agent id, the type it was started as, and the description Claude gave it (empty when none). */
export type Helper = { id: string; type: string; description: string }

/** The most characters the By column holds. */
const MAX_BY = 40

/** The text cut to the most the By column holds, with an ellipsis where it was cut. */
const cutBy = (text: string): string => endCut(text, MAX_BY)

/** The name the Touches table gives who made a Touch: a helper by its description, else its type; a command by its text; the user as You. */
export function byText(by: TouchBy, helpers: Helper[]): string {
  if (by.kind === 'command') return cutBy(by.text)
  if (by.kind === 'user') return 'You'
  if (by.kind !== 'helper') return 'Claude'
  const helper = helpers.find((h) => h.id === by.id)
  if (helper === undefined) return 'Helper'
  return cutBy(helper.description.trim() === '' ? helper.type : helper.description)
}

/** The most characters of a prompt's first line a Turn keeps. */
const MAX_TURN_TEXT = 80

/** One Turn: its number, and the first line of the prompt that started it. */
export type Turn = { n: number; text: string }

/** The saved Turns with the default for a state that saved none: one Turn, before any prompt. */
const withTurns = (saved: Turn[] | undefined): Turn[] =>
  saved === undefined || saved.length === 0 ? [{ n: 1, text: '' }] : saved

/** The number of the Turn the session is in. */
export const currentTurn = (turns: Turn[]): number => withTurns(turns).at(-1)?.n ?? 1

/**
 * The Turns with a new one started by a prompt. The session's opening Turn, which has no prompt, is the first
 * prompt's own while nothing has been logged in it.
 */
export function startTurn(turns: Turn[], log: LogEntry[], prompt: string): Turn[] {
  const all = withTurns(turns)
  const last = all.at(-1) ?? { n: 1, text: '' }
  const text = commandLine(prompt).slice(0, MAX_TURN_TEXT)
  if (last.text === '' && !log.some((e) => e.turn === last.n)) return [...all.slice(0, -1), { n: last.n, text }]
  return [...all, { n: last.n + 1, text }].slice(-MAX_LOG)
}

/** The most rows the Touches table draws, the newest: the engine refuses a drawing of more than 20,000 elements, and the log holds up to 2,000 Touches. */
const MAX_TOUCH_ROWS = 200

/** The Touches the table draws, and how many earlier ones it leaves out. */
export const touchRowsOf = (touches: TouchEntry[]) => ({
  shown: touches.slice(-MAX_TOUCH_ROWS),
  earlier: Math.max(touches.length - MAX_TOUCH_ROWS, 0),
})

/** The Lines column's text for a Touch's counts: `+3 -1`, either part left out when zero; empty when there are none. */
export const linesText = (counts: LineCounts | null): string =>
  countPair(counts)
    .filter((part) => part !== '')
    .join(' ')

/** The characters of text the Touches table draws for these Touches, which count against the drawing's limit; the headings, labels and the line counting earlier Touches are a fixed allowance. */
export function tableChars(touches: TouchEntry[], helpers: Helper[]): number {
  const { shown } = touchRowsOf(touches)
  const rows = shown.map(
    (t) =>
      String(t.n).length +
      t.kind.length +
      byText(t.by, helpers).length +
      String(t.turn).length +
      linesText(t.counts).length,
  )
  return TABLE_ALLOWANCE + rows.reduce((sum, n) => sum + n, 0)
}

/** The characters of the table's heading, column labels and earlier-Touches line, with room to spare. */
const TABLE_ALLOWANCE = 100
