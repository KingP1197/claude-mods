// The acting form: the whole-file text as one pressable row per line. Plain logic; the drawing is in register.tsx.
import { endCut } from './paths'
import type { FileView } from './view'

/** The whole-file text a File view can act on: a Read file's text, or the whole text beside a changed file's diff; null where there is none. */
export function textOf(view: FileView, whole: FileView | null): string | null {
  const own = 'text' in view ? view : whole
  return own !== null && 'text' in own ? own.text : null
}

/** The lines of a text, without the empty piece after a final line break. */
export function linesOf(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/** The label of one line's button: its number, padded to `width`, then its text with tabs made two spaces, cut to `room` characters. */
export const lineLabel = (n: number, width: number, text: string, room: number): string =>
  `${String(n).padStart(width)}  ${endCut(text.replaceAll('\t', '  '), room)}`

/** The lines of the new text where each hunk of a unified diff first changes something, in order; a hunk that only removes lines names the line that now sits where they were. */
function hunkStarts(diff: string): number[] {
  const starts: number[] = []
  let line = 0
  let isFirst = false
  for (const row of diff.split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(row)
    if (header !== null) {
      line = Number(header[1])
      isFirst = true
    } else if (row.startsWith(' ')) line += 1
    else if ((row.startsWith('+') || row.startsWith('-')) && isFirst) {
      starts.push(line)
      isFirst = false
    }
  }
  return starts
}

/** The most `Line N` buttons the Changes section draws, so that the small pane stays calm. */
const MAX_JUMPS = 5

/** The lines the `Line N` buttons under Changes name: where the first few hunks of the diff begin, kept to the `total` lines the file has. */
export const jumpsOf = (diff: string, total: number): number[] =>
  total < 1
    ? []
    : hunkStarts(diff)
        .slice(0, MAX_JUMPS)
        .map((n) => Math.min(Math.max(n, 1), total))

/** The most line rows the acting form draws at once, so that a long file stays far below the engine's limit on one drawing. */
const WINDOW = 200

/** The lines the acting form draws, counted from 1 and both ends included: up to WINDOW of the `total` lines, around the selected one. */
export function windowOf(total: number, picked: number | null): { from: number; to: number } {
  const from = picked === null ? 1 : Math.max(1, Math.min(picked - WINDOW / 2, total - WINDOW + 1))
  return { from, to: Math.min(total, from + WINDOW - 1) }
}

/** The characters of the drawing's limit kept back for what the acting form draws besides its line rows: the two count rows and the buttons under the selected line. */
export const ACTING_SLACK = 1000

/**
 * The window cut down until its rows fit `room` characters: `costs[i]` is what line `range.from + i` takes. The end
 * farther from the selected line goes first, and the end of the window where no line is selected. A window of one line stays.
 */
export function fitWindow(
  range: { from: number; to: number },
  picked: number | null,
  costs: number[],
  room: number,
): { from: number; to: number } {
  let { from, to } = range
  let total = costs.reduce((sum, cost) => sum + cost, 0)
  while (total > room && from < to) {
    const isEndFarther = picked === null || to - picked >= picked - from
    total -= costs[(isEndFarther ? to : from) - range.from] ?? 0
    if (isEndFarther) to -= 1
    else from += 1
  }
  return { from, to }
}

/** The selected line as saved state holds it: a whole number from 1 up, else null. Saved state can hold anything, and a bad value means no selection. */
export const pickedLine = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null

/** What a line button's address names: a line row (`line:7`) or a `Line N` button under Changes (`jump:7`); null for any other address. */
export function lineKeyOf(key: string | undefined): { kind: 'line' | 'jump'; n: number } | null {
  const found = /^(line|jump):(\d+)$/.exec(key ?? '')
  return found === null ? null : { kind: found[1] === 'jump' ? 'jump' : 'line', n: Number(found[2]) }
}

/** The open Edit box as saved state holds it: the line it belongs to and the text it was opened with; null for any other value. Saved state can hold anything, and a bad value means no box. */
export function editOf(value: unknown): { line: number; original: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const { line, original } = value as Record<string, unknown>
  const n = pickedLine(line)
  return n === null || typeof original !== 'string' ? null : { line: n, original }
}
