// How a Card's header fits its box. The engine lays a row out by shrinking what may shrink, and a Text that may not
// shrink (the state word, the stats line) runs past the box when the row is too wide. So the header counts its own
// cells from the pane's columns and cuts or shortens its text before the engine is asked to draw it.
// Nothing here calls the engine.
import { MARK, type StatParts } from './agents'
import { CRITTER_W } from './critter'
import { ICON_SIZE } from './transcript'

/**
 * CSS pixels in one cell, for the pictures only (an Svg takes pixels, text takes cells). The engine gives no pixel
 * figure: a pane's `bodyColumns` is its width over the advance of the app's code font, and no field carries that
 * advance. 8 stands in for it and rounds the Critter up: 36px is 5 cells for any advance from 7.2px (a 12px code font)
 * up to (not including) 9px, where it would be 4, and the cell after it is the gap. Text is not counted in pixels at all, only in cells.
 */
const CELL_PX = 8

/** The cells the Critter and the gap after it take beside the header's body, off the terminal. */
const CRITTER_CELLS = Math.ceil(CRITTER_W / CELL_PX) + 1

/** The cells a Card's header has to draw in: the Card's inside, less the Critter and its gap on desktop. */
export const headerCells = (isTerminal: boolean, inside: number): number =>
  isTerminal ? inside : inside - CRITTER_CELLS

/** The cells a name takes beyond its letters: the terminal's hat mark and its gap, the desktop's chrome around a plain Button (the tracer measured two). */
const NAME_EXTRA = 2

/** The cells the name takes in the title row. */
const nameCells = (description: string): number => description.length + NAME_EXTRA

/**
 * The word beside the state's dot. The full word where the row fits the name, one cell of air and the whole mark
 * (the dot, its gap and the word); where it does not, the word's short form: Running reads `live`, Waiting `idle`,
 * Failed `fail`, Stopped `stop`. Done and Lost are short already.
 */
const stateWord = (state: keyof typeof MARK, name: number, cells: number): string => {
  const mark = MARK[state]
  return name + 1 + 2 + mark.word.length <= cells ? mark.word : mark.short
}

/**
 * The title row's two texts: the name, and the word beside the state's dot. The name draws whole where it, a cell of
 * air and the mark fit the header's cells; else the word takes its short form and the name is cut with `…` to the
 * cells that leaves, so the mark never leaves the Card. The engine cannot be trusted to shrink the name.
 */
export function titleParts(
  description: string,
  state: keyof typeof MARK,
  cells: number,
): { name: string; word: string } {
  const word = stateWord(state, nameCells(description), cells)
  const room = cells - 1 - 2 - word.length - NAME_EXTRA
  return { name: description.length <= room ? description : cutTo(description, room), word }
}

/** The cells between the Steps line and the stats beside it. */
const STATS_GAP = 1

/**
 * The stats line in the forms it may take. `whole` keeps every figure: the full line, then the one without the word
 * `tok` (`992k` for `992k tok`, ruled by the user on 2026-10-15; the parts arrive in both). `all` goes on from there,
 * longest first, dropping the time and then the tokens.
 */
const statsForms = ({ full, bare }: StatParts): { whole: string[]; all: string[] } => {
  const whole = [full.join(' | '), bare.join(' | ')]
  const dropped = bare.map((_, i) => bare.slice(0, bare.length - i).join(' | ')).slice(1)
  return { whole, all: [...whole, ...dropped] }
}

/** What a Card's number row draws: the Steps line, the stats, and whether the stats sit on a row under the line. */
export type NumsRow = { steps: string; stats: string; isStacked: boolean }

/**
 * The Card's Steps line and stats in a header `cells` wide, given the stats parts (`ctx 9%`, `992k tok`, `1:43`; `992k` in the bare ones).
 * The stats sit beside the line while it keeps half the cells (or all its text, if shorter), without the word `tok`
 * where the full line would leave it less. Where neither form leaves it that, the stats move under it, in the longest
 * form that fits the row, and the line has the whole row: the design foundations stack items before cutting them.
 */
export function numsRow(line: string | null, parts: StatParts, cells: number): NumsRow {
  const forms = statsForms(parts)
  const alone = forms.all.find((f) => f.length <= cells) ?? ''
  if (line === null) return { steps: '', stats: alone, isStacked: false }
  const need = Math.min(Math.ceil(cells / 2), line.length)
  const beside = forms.whole.find((f) => cells - f.length - STATS_GAP >= need)
  if (beside !== undefined)
    return { steps: cutTo(line, cells - beside.length - STATS_GAP), stats: beside, isStacked: false }
  return { steps: cutTo(line, cells), stats: alone, isStacked: alone !== '' }
}

/** The text cut to `cells` with `…` at the end where it is longer; empty where no cell is left. */
const cutTo = (text: string, cells: number): string =>
  cells <= 0 ? '' : text.length <= cells ? text : `${text.slice(0, cells - 1)}…`

/** The text cut to `cells` with `…` in the middle, so a path keeps its first folder and its file name; an end cut below three cells. */
export function cutMiddle(text: string, cells: number): string {
  if (text.length <= cells) return text
  if (cells < 3) return cutTo(text, cells)
  const head = Math.ceil((cells - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - (cells - 1 - head))}`
}

/** The cells the desktop app draws around a plain Button's label (the tracer measured two); the terminal draws none. */
const BUTTON_CHROME = 2

/** The cells a hung row's elbow takes: `├─` in the terminal, the gutter's Svg off it. */
const ELBOW_CELLS = { terminal: 2, desktop: 3 } as const

/** The cells a tool's icon takes off the terminal. */
const ICON_CELLS = Math.ceil(ICON_SIZE / CELL_PX)

/**
 * The cells a Tool call's target has in its row: the Card's inside less the row's lead (the elbow, the icon off the
 * terminal, the tool's name), its tail (`✗ Failed`, a state mark or what came back) and its chevron, with the one-cell
 * gap between parts. The engine cannot be trusted to shrink the target, so the row cuts it to this before drawing.
 */
export function targetRoom(
  inside: number,
  isTerminal: boolean,
  name: string,
  tail: string | null,
  hasChevron: boolean,
): number {
  const lead = (isTerminal ? ELBOW_CELLS.terminal : ELBOW_CELLS.desktop + 1 + ICON_CELLS) + 1 + name.length + 1
  const after = tail === null ? 0 : 1 + tail.length
  const chevron = hasChevron ? 1 + 1 + (isTerminal ? 0 : BUTTON_CHROME) : 0
  return inside - lead - after - chevron
}
