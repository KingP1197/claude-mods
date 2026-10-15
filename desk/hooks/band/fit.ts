// The stats row of the band (its second line) and the button row: which figures fit the width; and how the Side question rows are cut to the rows the Band has.
// Nothing here calls the engine.

/** The drawn width, in cells, of each figure on the stats row. `cache` is null when there is no cache item yet, and `agents` when the Agent counter is not drawn. */
export type Widths = {
  branch: number
  rate5: number
  rate7: number
  ctx: number
  ctxShort: number
  cache: number | null
  agents: number | null
}

/** Which figures the stats row draws. The 5h figure and the context figure always stay. */
export type Shown = { isBranch: boolean; isRate7: boolean; isCache: boolean; isAgents: boolean; isCtxShort: boolean }

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

function widthOf(s: Shown, w: Widths): number {
  const cells = [
    s.isBranch ? w.branch : null,
    w.rate5,
    s.isRate7 ? w.rate7 : null,
    s.isCtxShort ? w.ctxShort : w.ctx,
    s.isCache ? w.cache : null,
    s.isAgents ? w.agents : null,
  ].filter((c): c is number => c !== null)
  return cells.reduce((sum, c) => sum + c, 0) + SEP * (cells.length - 1)
}

/** The column the Cache item starts at on the stats row: the figures before it, and the separator. */
export const cacheStart = (s: Shown, w: Widths): number => widthOf({ ...s, isCache: false, isAgents: false }, w) + SEP

/** The column the Agent counter starts at on the stats row: the figures before it, and the separator. */
export const agentsStart = (s: Shown, w: Widths): number => widthOf({ ...s, isAgents: false }, w) + SEP

/** Whether a terminal card of `length` cells, drawn `left` cells past an item that starts at `start`, ends inside `columns`. The engine clips what runs past the edge, so a card that does not fit is not drawn. An unknown width (0) draws it. */
export const cardFits = (columns: number, start: number, left: number, length: number): boolean =>
  columns <= 0 || start + left + length <= columns

/** The fullest set of figures that fits `columns`. The buttons sit on a row of their own, so the stats row has the whole width. */
export function fit(columns: number, w: Widths): Shown {
  const step = STEPS.map((s) => ({
    ...s,
    isCache: s.isCache && w.cache !== null,
    isAgents: s.isAgents && w.agents !== null,
  })).find((s) => widthOf(s, w) <= columns)
  return step ?? NARROWEST
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
