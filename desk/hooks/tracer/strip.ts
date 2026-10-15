import type { Tag, RecordEntry } from '../../types'
import { tagWords } from './record'

/** One file on the strip: its name, its Tag, whether a dot marks it, and whether the Tag is the user's (`Edited by you`; absent otherwise). */
type StripEntry = { name: string; tag: Tag; isRecent: boolean; isByUser?: true }

/** What the strip draws: the files it lists, then how many touched files it leaves out. */
export type Strip = { entries: StripEntry[]; more: number }

/** The most files the strip lists, and the fewest it lists when that many are touched. */
const MOST = 5
const FEWEST = 3

/** The cells between two entries, " | ". */
const SEPARATOR = 3

/** The last folder-free part of a path. */
const nameOf = (path: string) => path.split('/').at(-1) ?? path

/** The cells an entry takes, one per character: the name, a space, the Tag, and a space and the dot when it has one. */
const cellsOf = (e: StripEntry) => e.name.length + 1 + tagWords(e).length + (e.isRecent ? 2 : 0)

/** The cells a strip of these entries takes, with "+N more" after them when `more` is above 0. */
function widthOf(entries: StripEntry[], more: number): number {
  const listed = entries.reduce((sum, e) => sum + cellsOf(e), 0) + SEPARATOR * Math.max(entries.length - 1, 0)
  return more === 0 ? listed : listed + SEPARATOR + `+${more} more`.length
}

/**
 * The files the strip lists, from the records: files with dots first, then the rest, the latest touch first in each.
 * It lists as many as fit in `width` cells (a cell is one character), at least 3 and at most 5, then "+N more" for
 * every other touched file.
 */
export function stripOf(records: Record<string, RecordEntry>, width: number): Strip {
  const ranked = Object.entries(records)
    .sort(([, a], [, b]) => Number(b.isRecent) - Number(a.isRecent) || b.order - a.order)
    .map(([path, e]): StripEntry => ({
      name: nameOf(path),
      tag: e.tag,
      isRecent: e.isRecent,
      ...(e.isByUser === true ? { isByUser: true as const } : {}),
    }))
  const fewest = Math.min(FEWEST, ranked.length)
  let count = Math.min(MOST, ranked.length)
  while (count > fewest && widthOf(ranked.slice(0, count), ranked.length - count) > width) count -= 1
  return { entries: ranked.slice(0, count), more: ranked.length - count }
}
