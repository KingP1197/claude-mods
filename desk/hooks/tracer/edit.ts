// Editing one line of a file: plain logic; the drawing and the writing are in register.tsx.
import { because } from '../failures'

/**
 * The file split at its line breaks, and line `n`'s own ending (`\r` in a CRLF file), where the file has line `n`
 * (counted from 1) and it still reads `original`. Null where it has no such line or the line changed since the box opened.
 */
function lineOf(file: string, n: number, original: string): { pieces: string[]; ending: string } | null {
  const pieces = file.split('\n')
  const old = pieces[n - 1]
  if (old === undefined) return null
  const ending = old.endsWith('\r') ? '\r' : ''
  return old.slice(0, old.length - ending.length) === original ? { pieces, ending } : null
}

/** The file's text with line `n` given the words, its line ending and the file's final line break left as they were. Null where the file has no such line or the line is no longer `original`. */
export function replaceLine(file: string, n: number, original: string, words: string): string | null {
  const found = lineOf(file, n, original)
  if (found === null) return null
  found.pieces[n - 1] = words + found.ending
  return found.pieces.join('\n')
}

/** The file's text with a blank line after line `n`, in the file's line ending. Null where the file has no such line or the line is no longer `original`. */
export function insertAfter(file: string, n: number, original: string): string | null {
  const found = lineOf(file, n, original)
  if (found === null) return null
  // A last line with no break after it gets one, and the blank line a break of its own.
  found.pieces.splice(n, 0, found.ending, ...(n === found.pieces.length ? [''] : []))
  return found.pieces.join('\n')
}

/** The file's text without line `n`. Null where the file has no such line or the line is no longer `original`. */
export function removeLine(file: string, n: number, original: string): string | null {
  const found = lineOf(file, n, original)
  if (found === null) return null
  found.pieces.splice(n - 1, 1)
  return found.pieces.join('\n')
}

/** The notice for a Save that found the line changed. */
export const staleNotice = (n: number): string => `Line ${n} changed since you opened it. Open it again.`

/** The notice for a Save the file refused: a file the user may not write, say. `reason` is why. */
export const failedNotice = (n: number, reason: string): string =>
  `Could not save line ${n} ${because(reason)}. The file was not changed.`

/** The notice as saved state holds it: some text, else none. Saved state can hold anything, and a bad value means no notice. */
export const noticeOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
