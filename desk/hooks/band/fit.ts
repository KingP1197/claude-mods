// The stats row of the band (its second line) and the button row: which figures fit the width; and how the Side question rows are cut to the rows the Band has.
// Nothing here calls the engine.

// Which figures the stats row draws. The 5h figure and the context figure always stay.
type Shown = { isBranch: boolean; isRate7: boolean; isCache: boolean; isAgents: boolean; isCtxShort: boolean }

/** The text between the stats row's figures. */
export const SEP_TEXT = ' | '
const SEP = SEP_TEXT.length

// Fuller first. Each step drops what the one before it kept, in the order the design rules give.
// The Agent counter outlasts the cache item: it is the one fact worth the band's width.
const STEPS: Shown[] = [
  { isBranch: true, isRate7: true, isCache: true, isAgents: true, isCtxShort: false },
  { isBranch: false, isRate7: true, isCache: true, isAgents: true, isCtxShort: false },
  { isBranch: false, isRate7: false, isCache: true, isAgents: true, isCtxShort: false },
  { isBranch: false, isRate7: false, isCache: false, isAgents: true, isCtxShort: false },
  { isBranch: false, isRate7: false, isCache: false, isAgents: false, isCtxShort: false },
]
// What stays when even that does not fit.
const NARROWEST: Shown = { isBranch: false, isRate7: false, isCache: false, isAgents: false, isCtxShort: true }

/** The text of each figure on the stats row, as drawn. `cache` is null when there is no Cache item yet. */
export type Figures<C = unknown> = {
  branch: string
  rate5: string
  rate7: string
  ctx: string
  ctxShort: string
  /** The Cache item's text, and `seen`: what the drawing builds the item from, carried to its row item so the drawing need not ask again whether there is one. */
  cache: { text: string; seen: C } | null
  agents: string
  /** The cells a surface draws around the Agent counter's text. */
  agentsPad: number
}

/** Which figure an item of the stats row is. */
export type RowKey = 'br' | 'r5' | 'r7' | 'ctx' | 'cache' | 'agents'

// Which figure an item is; the Cache item also carries its `seen`.
type Tag<C> = { key: Exclude<RowKey, 'cache'> } | { key: 'cache'; seen: C }

/** A figure on the stats row: which it is, its text, the cells it takes, and the column it starts at. */
export type RowItem<C = unknown> = Tag<C> & { text: string; width: number; start: number }

/** The figures of the stats row, left to right, the row's width in cells, and the cells the band gives it. */
export type StatsItems<C = unknown> = { items: RowItem<C>[]; width: number; room: number }

// The stats row's order, left to right. It is written here alone: what fits, what is drawn and where each card sits all read it.
function laidOut<C>(s: Shown, f: Figures<C>, room: number): StatsItems<C> {
  // Each figure drawn: which it is, its text, and the cells a surface draws around it. Null: not drawn.
  const figures: ([Tag<C>, string, number] | null)[] = [
    s.isBranch ? [{ key: 'br' }, f.branch, 0] : null,
    [{ key: 'r5' }, f.rate5, 0],
    s.isRate7 ? [{ key: 'r7' }, f.rate7, 0] : null,
    [{ key: 'ctx' }, s.isCtxShort ? f.ctxShort : f.ctx, 0],
    s.isCache && f.cache !== null ? [{ key: 'cache', seen: f.cache.seen }, f.cache.text, 0] : null,
    s.isAgents ? [{ key: 'agents' }, f.agents, f.agentsPad] : null,
  ]
  const items: RowItem<C>[] = []
  let start = 0
  for (const figure of figures) {
    if (figure === null) continue
    const [tag, text, pad] = figure
    items.push({ ...tag, text, width: text.length + pad, start })
    start += text.length + pad + SEP
  }
  // 5h and context are always drawn, so the row is never empty.
  return { items, width: start - SEP, room }
}

/**
 * The fullest stats row that fits `columns`. The buttons sit on a row of their own, so the stats row has the whole width.
 * An unknown width (0 or less) has room for everything: the full row and every card.
 */
export function statsItems<C>(columns: number, f: Figures<C>): StatsItems<C> {
  const room = columns > 0 ? columns : Infinity
  return STEPS.map((s) => laidOut(s, f, room)).find((row) => row.width <= room) ?? laidOut(NARROWEST, f, room)
}

/**
 * Where a terminal card of `length` cells sits under the item `key`: its left edge, counted from the item's start, a cell past the row's end.
 * The terminal paints later siblings over an earlier absolute Box, so a card that began just right of its item would lose its first cells to whatever the row draws after it.
 * The engine clips what runs past the band's edge, so a card that does not fit is not drawn: null.
 */
export function cardLeft(row: StatsItems, key: RowKey, length: number): number | null {
  const item = row.items.find((i) => i.key === key)
  if (item === undefined || row.width + 1 + length > row.room) return null
  return row.width - item.start + 1
}

/** The most rows the latest answer takes in the Band. */
const ANSWER_ROWS = 8

// A Markdown bullet (`- `, `* `, `+ `, `1. `) or plain indent at the start of a line: the cells the wrapped rows hang under.
const PREFIX = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?/

/** The rows a line takes once its words wrap at `columns` cells; an empty line still takes one, and a width under one cell counts as one. A bullet's or indent's prefix keeps its cells on every row, so the words wrap in what is left. */
function rowsOf(line: string, columns: number): number {
  const prefix = PREFIX.exec(line)?.[0].length ?? 0
  // Always at least one cell, so a word that is wider than the row still ends.
  const width = Math.max(1, columns - prefix)
  let rows = 1
  // The cells the current row holds so far.
  let used = 0
  for (const word of line
    .slice(prefix)
    .split(/\s+/)
    .filter((w) => w !== '')) {
    // A word wider than the row fills whole rows, then starts the next one.
    if (word.length > width) {
      rows += used === 0 ? Math.ceil(word.length / width) - 1 : Math.ceil(word.length / width)
      used = word.length % width === 0 ? width : word.length % width
    } else if (used === 0) {
      used = word.length
    } else if (used + 1 + word.length <= width) {
      used += 1 + word.length
    } else {
      rows += 1
      used = word.length
    }
  }
  return rows
}

/** The rows `text` takes in `columns` cells, every line wrapped. */
export const textRows = (text: string, columns: number) =>
  text.split('\n').reduce((n, line) => n + rowsOf(line, columns), 0)

/** The leading lines that fit whole in `rows` rows. */
function wholeLines(lines: string[], rows: number, columns: number): string[] {
  const kept: string[] = []
  let taken = 0
  for (const line of lines) {
    taken += rowsOf(line, columns)
    if (taken > rows) break
    kept.push(line)
  }
  return kept
}

/** `text` cut at a line end to at most `rows` rows of `columns` cells, with `…` on the last line it keeps. */
export function cutAnswer(text: string, rows: number, columns: number): string {
  if (textRows(text, columns) <= rows) return text
  const lines = text.split('\n')
  const kept = wholeLines(lines, rows, columns)
  // Not even the first line fits: cut inside it.
  if (kept.length === 0) kept.push(lines[0]?.slice(0, rows * columns) ?? '')
  let last = kept.pop() ?? ''
  const before = kept.length === 0 ? 0 : textRows(kept.join('\n'), columns)
  // Room for the `…` too.
  while (before + rowsOf(`${last}…`, columns) > rows && last.length > 0) last = last.slice(0, -1)
  return `${[...kept, last].join('\n')}…`
}

/** The rows the answer may take: at most `ANSWER_ROWS`, fewer when `maxRows` less the Band's `otherRows` leaves less, never under one. */
export function answerRows(maxRows: number, otherRows: number): number {
  return Math.max(1, Math.min(ANSWER_ROWS, maxRows - otherRows))
}

/** The question on one row of `columns` cells: its first line, with `…` when more was cut. */
export function cutQuestion(text: string, columns: number): string {
  const [first = '', ...more] = text.split('\n')
  if (more.length === 0 && first.length <= columns) return first
  return `${first.slice(0, columns - 1)}…`
}
