// The note to Claude after the user edits a line from the pane. Plain logic; the storing and the sending are in register.tsx.
import type { EditNote } from '../../types'
import { pickedLine } from './acting'
import { fenced } from './comments'

/** The note as Claude reads it: where the line is, the line, and what the user did to it. */
export function noteText(note: EditNote): string {
  if (note.kind === 'deleted')
    return `In \`${note.path}\` at line ${note.line}:\nI deleted this line myself:\n${fenced(note.path, note.was)}`
  const where = `In \`${note.path}\` at line ${note.line}:\n${fenced(note.path, note.now)}\n`
  if (note.kind === 'added') return `${where}I added this line myself.`
  return `${where}I changed this line myself. It was:\n${fenced(note.path, note.was)}`
}

/**
 * The notes of a path after a line was added or deleted: each note on a line after the change moves with its line, so
 * it still points at the line it was made on. An added note's own line is already taken by a line that moved down, so
 * a note on it moves too. A deleted line has no line left to follow: its changed or added note goes, and the note of
 * the deletion carries the line's words.
 */
function movedWith(notes: EditNote[], note: EditNote): EditNote[] {
  if (note.kind === 'changed') return notes
  if (note.kind === 'added')
    return notes.map((own) => (own.path === note.path && own.line >= note.line ? { ...own, line: own.line + 1 } : own))
  return notes
    .filter((own) => !(own.path === note.path && own.line === note.line && own.kind !== 'deleted'))
    .map((own) => (own.path === note.path && own.line > note.line ? { ...own, line: own.line - 1 } : own))
}

/**
 * The notes with a new one after them. A line changed again is one note: the earlier note on the same line keeps what
 * the line was at first and takes what it is now, and an added line changed again is still an added line. A line
 * added or deleted moves the notes below it, so the line a note names stays the line it was made on.
 */
export function withNote(notes: EditNote[], note: EditNote): EditNote[] {
  const moved = movedWith(notes, note)
  const at = moved.findIndex(
    (own) => own.path === note.path && own.line === note.line && own.kind !== 'deleted' && note.kind === 'changed',
  )
  if (at < 0) return [...moved, note]
  return moved.map((own, i) => (i === at ? { ...own, now: note.now } : own))
}

/** Whether a saved value is a note: a path, a line from 1 up, a kind the note knows, and the line before and after as text. */
function isNote(value: unknown): value is EditNote {
  if (typeof value !== 'object' || value === null) return false
  const { path, line, kind, was, now } = value as Record<string, unknown>
  const isKind = kind === 'changed' || kind === 'added' || kind === 'deleted'
  return (
    typeof path === 'string' &&
    path !== '' &&
    pickedLine(line) !== null &&
    isKind &&
    typeof was === 'string' &&
    typeof now === 'string'
  )
}

/** The notes as saved state holds them: a list of notes. Saved state can hold anything, and a bad value means none; entries of any other shape are left out. */
export const notesOf = (value: unknown): EditNote[] => (Array.isArray(value) ? value.filter(isNote) : [])
