import type { RecordEntry } from '../../types'
import { unifiedDiff } from './diff'

/** What the view area shows for a file: its text, the diff of a change to it, or a line saying why not; lines in `leads`, where there are any, go above it. */
export type FileView = ({ text: string } | { diff: string } | { note: string }) & { leads?: string[] }

/** A text with its line endings made plain line breaks: the code view refuses a carriage return, and a Windows file has them. */
const plain = (text: string) => text.replace(/\r\n?/g, '\n')

/** Whether the text holds a control character other than a tab or a newline: the code view refuses such text, and a program or an image holds them. */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) return true
  }
  return false
}

/** The line for a file that holds a program or an image. */
const NOT_TEXT = 'This file is not text, so it cannot be shown here.'

/** The line for a file whose read failed. */
const GONE = 'This file is gone or cannot be read.'

/** The view for what a read of the file gave: its text, or null where the read failed. */
export function viewOfRead(read: string | null): FileView {
  if (read === null) return { note: GONE }
  // A carriage return is a control character too; a line ending of Windows' is a plain line break here.
  const text = plain(read)
  if (hasControlCharacter(text)) return { note: NOT_TEXT }
  return text === '' ? { note: 'This file is empty.' } : { text }
}

/** How many changes a view shows: the hunks of its diff; none for a text or a note. */
export const hunksOf = (view: FileView): number =>
  'diff' in view ? view.diff.split('\n').filter((line) => line.startsWith('@@ ')).length : 0

/** A path as the view names it: relative to the project where it is inside it, else whole. */
export const named = (cwd: string, path: string) => {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(root) ? path.slice(root.length) : path
}

/** The line saying why a changed file has no baseline: it was too big to keep, or it is not known. */
const lackOf = (entry: Pick<RecordEntry, 'isBaselineTooBig'>) =>
  entry.isBaselineTooBig ? 'The text before the change was too big to keep.' : 'The text before the change is unknown.'

/** The view of a diff under the lines leading it; a line saying so where the diff holds no change, and a different one where the file has no text at all. */
const diffView = (leads: string[], diff: string, isEmpty: boolean): FileView => {
  if (diff !== '') return { leads, diff }
  return { leads, note: isEmpty ? 'This file is empty.' : 'Nothing changed.' }
}

/** The view for a changed file: the diff from its baseline to what a read of it gave, under a line naming where a moved file came from. */
export function viewOfChange(
  entry: Pick<RecordEntry, 'tag' | 'baseline' | 'isBaselineTooBig' | 'oldPath'>,
  read: string | null,
  where: { cwd: string; path: string },
): FileView {
  const moved =
    entry.oldPath === undefined
      ? []
      : [`Moved from ${named(where.cwd, entry.oldPath)} to ${named(where.cwd, where.path)}`]
  if (read === null) return { leads: moved, note: GONE }
  const [before, after] = [plain(entry.baseline ?? ''), plain(read)]
  if (entry.baseline !== null && (hasControlCharacter(before) || hasControlCharacter(after))) {
    return { leads: moved, note: NOT_TEXT }
  }
  if (entry.baseline !== null) return diffView(moved, unifiedDiff(before, after), after === '')
  // A deleted file has no text now to show beside the line.
  if (entry.tag === 'Deleted') return { note: lackOf(entry) }
  return { leads: [...moved, lackOf(entry)], ...viewOfRead(read) }
}

/** How many characters the engine counts for a string: its UTF-8 bytes, so the `─` of a terminal divider counts three. */
const countedChars = (text: string): number => {
  let n = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    n += code < 0x80 ? 1 : code < 0x800 ? 2 : 3
  }
  return n
}

/** The prop of each kind of element that holds words the engine counts: the label of a Button, the words of a picture, the source of code. A picture's own source is markup, not words, and does not count. A Box's `key` counts too (measured: a Box keyed with 1,000 characters adds 1,000; a Button, Svg or Text key adds none). */
const WORDS_PROP: Record<string, string> = { Button: 'label', Svg: 'alt', Code: 'source' }

/** The characters of a string, or none for any other value. */
const wordsIn = (value: unknown): number => (typeof value === 'string' ? countedChars(value) : 0)

/** The characters one element's own props take: its words prop, and for a Box its key. */
function ownChars(type: string | undefined, props: Record<string, unknown> | null | undefined): number {
  const words = type === undefined ? undefined : WORDS_PROP[type]
  return (words === undefined ? 0 : wordsIn(props?.[words])) + (type === 'Box' ? wordsIn(props?.key) : 0)
}

/** How many characters of the one drawing's limit a built tree of elements takes: the words in its Text and in the props above. Counted by walking the elements, since the drawing is cut off past the limit and nothing says how near it is. */
export function drawnChars(node: unknown): number {
  if (typeof node === 'string') return countedChars(node)
  if (typeof node === 'number') return String(node).length
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + drawnChars(child), 0)
  if (typeof node !== 'object' || node === null) return 0
  const { type, props, children } = node as {
    type?: string
    props?: Record<string, unknown> | null
    children?: unknown
  }
  return ownChars(type, props) + drawnChars(children)
}
