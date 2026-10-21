// How a Card's header fits its box. The engine lays a row out by shrinking what may shrink, and a Text that may not
// shrink (the state word, the stats line) runs past the box when the row is too wide. So the header counts its own
// cells from the pane's columns and cuts or shortens its text before the engine is asked to draw it.
// Nothing here calls the engine.
import { MARK, PART_SEP, type StatParts } from './agents'
import { CRITTER_W } from './critter'
import { ICON_SIZE } from './transcript'
import { BUTTON_PAD } from '../surface'

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

/** The cells the terminal's hat mark and its gap take before the name. */
const HAT_CELLS = 2

/**
 * The cells a name takes beyond its letters: the terminal's hat mark and its gap (HAT_CELLS), the desktop's pad around
 * a plain Button (BUTTON_PAD, approximate: see surface.ts). One figure serves both surfaces, the larger, so the mark never
 * leaves the Card.
 */
const NAME_EXTRA = Math.max(HAT_CELLS, BUTTON_PAD)

/** The cells the name takes in the title row. */
const nameCells = (description: string): number => description.length + NAME_EXTRA

/**
 * The word beside the state's dot. The full word where the row fits the name, one cell of air and the whole mark
 * (the dot, its gap and the word); where it does not, the word's short form: Waiting reads `idle`, Failed `fail`,
 * Stopped `stop`. Running is `Live` at every width; Done and Lost are short already.
 */
const stateWord = (state: keyof typeof MARK, name: number, cells: number): string => {
  const mark = MARK[state]
  return name + 1 + 2 + mark.word.length <= cells ? mark.word : mark.short
}

/** The title row's two texts: the name as it draws, and the word beside the state's dot. */
export type TitleParts = { name: string; word: string }

/**
 * The title row's two texts: the name, and the word beside the state's dot. The name draws whole where it, a cell of
 * air and the mark fit the header's cells; else the word takes its short form and the name is cut with `…` to the
 * cells that leaves, so the mark never leaves the Card, and reads `…` where no cell is left. The engine cannot be trusted
 * to shrink the name.
 */
export function titleParts(description: string, state: keyof typeof MARK, cells: number): TitleParts {
  const word = stateWord(state, nameCells(description), cells)
  const room = cells - 1 - 2 - word.length - NAME_EXTRA
  const name = description.length <= room ? description : cutTo(description, room)
  // A Button with an empty label draws nothing to press, so a name with no cell left reads `…`.
  return { name: name === '' ? '…' : name, word }
}

/** The meta row's three texts: the agent's type (empty where it is left out), its effort and its model. */
export type MetaParts = { type: string; effort: string; model: string }

/** The fewest cells a cut type keeps (`gen…`); below them it leaves the row with its separator. */
const TYPE_MIN = 4

/** The fewest cells a cut model keeps (`O…5`); past them the effort is cut instead. */
const MODEL_MIN = 3

/**
 * The meta row in a header `cells` wide. The type gives way first: cut with `…` while TYPE_MIN of its cells are left,
 * gone below that. After it the order depends on the hat. Where the Critter's hat already shows the effort
 * (`isEffortOnHat`, the desktop), the effort word is next: dropped whole, and only then is the model cut in the middle.
 * Where it does not (the terminal, whose hat mark is colour alone), the model is cut in the middle first, down to
 * MODEL_MIN cells, and then the effort is cut to what is left, to nothing where no cell remains.
 */
export function metaParts(parts: MetaParts, cells: number, isEffortOnHat: boolean): MetaParts {
  const { type, effort, model } = parts
  const tail = effort.length + PART_SEP.length + model.length
  const typeRoom = cells - tail - PART_SEP.length
  if (type !== '' && typeRoom >= TYPE_MIN) return { type: cutTo(type, typeRoom), effort, model }
  if (isEffortOnHat) {
    return tail <= cells ? { type: '', effort, model } : { type: '', effort: '', model: cutMiddle(model, cells) }
  }
  const cut = cutMiddle(model, Math.max(MODEL_MIN, cells - effort.length - PART_SEP.length))
  return { type: '', effort: cutTo(effort, cells - PART_SEP.length - cut.length), model: cut }
}

/** The cells between the Steps line and the stats beside it. */
const STATS_GAP = 1

/**
 * The stats line in the forms it may take. `whole` keeps every figure: the full line, then the one without the word
 * `tok` (`992k` for `992k tok`, ruled by the user on 2026-10-15; the parts arrive in both). `all` goes on from there,
 * longest first, dropping the time and then the tokens.
 */
const statsForms = ({ full, bare }: StatParts): { whole: string[]; all: string[] } => {
  const whole = [full.join(PART_SEP), bare.join(PART_SEP)]
  const dropped = bare.map((_, i) => bare.slice(0, bare.length - i).join(PART_SEP)).slice(1)
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

/**
 * Parts of a line in rows of at most `cells`, joined by PART_SEP where they share one, each part whole: a row breaks
 * between parts, never inside one before its separator. A part longer than the row takes a row of its own, to wrap there.
 */
export function partRows(parts: readonly string[], cells: number): string[] {
  const rows: string[] = []
  for (const part of parts) {
    const last = rows.at(-1)
    if (last !== undefined && last.length + PART_SEP.length + part.length <= cells)
      rows[rows.length - 1] = `${last}${PART_SEP}${part}`
    else rows.push(part)
  }
  return rows
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
  const chevron = hasChevron ? 1 + 1 + (isTerminal ? 0 : BUTTON_PAD) : 0
  return inside - lead - after - chevron
}
