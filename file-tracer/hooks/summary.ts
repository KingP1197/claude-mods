import type { RecordEntry } from '../types'
import { countsOf } from './tree'

/** How many files the records hold, how many of them were changed, and the lines the changed ones gained and lost in all. */
export type Summary = { files: number; changed: number; added: number; removed: number }

/** The counts the pane's toolbar shows: every touched file, those whose Tag is not a plain Read, and the lines gained and lost over the session. A file whose lines the record cannot tell adds none. */
export function summaryOf(records: Record<string, RecordEntry>): Summary {
  const entries = Object.entries(records)
  const lines = entries.map(([path, e]) => countsOf(path, e))
  return {
    files: entries.length,
    changed: entries.filter(([, e]) => e.tag !== 'Read').length,
    added: lines.reduce((sum, c) => sum + (c?.added ?? 0), 0),
    removed: lines.reduce((sum, c) => sum + (c?.removed ?? 0), 0),
  }
}

/** The records whose Tag is not a plain Read: the files `Show changed only` leaves in the tree. */
export const changedOf = (records: Record<string, RecordEntry>): Record<string, RecordEntry> =>
  Object.fromEntries(Object.entries(records).filter(([, e]) => e.tag !== 'Read'))
