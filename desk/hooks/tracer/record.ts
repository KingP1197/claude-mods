import type { Tag, RecordEntry } from '../../types'

/** The longest baseline kept: the engine's code view draws no more characters than this. */
const MAX_BASELINE = 100_000

export const PANE = 'file-tracer'
export const TITLE = 'Files'
export const COMMAND = 'file-tracer'

/** One thing Claude did to one file. The path is absolute; `baseline` is the file's content before this change, and `seen` its content after, where the mod saw it. */
export type Touch = {
  path: string
  tag: Tag
  baseline: string | null
  oldPath?: string
  seen?: string
  /** True for the user's own edit saved from the pane, which is not a Touch of Claude's. */
  isByUser?: true
}

/** Tags from smallest to biggest. */
const RANK: readonly Tag[] = ['Read', 'Edited', 'Moved', 'Created', 'Deleted']

/** The baseline a record keeps for a text: the text, or none and a note when it runs over the most kept. */
function baselineOf(text: string | null): Pick<RecordEntry, 'baseline' | 'isBaselineTooBig'> {
  const isTooBig = (text?.length ?? 0) > MAX_BASELINE
  return { baseline: isTooBig ? null : text, isBaselineTooBig: isTooBig }
}

/** Whether a record's text before the session's first change is unknown: none kept, and not for being too big. */
const isUnknown = (e: RecordEntry) => e.baseline === null && !e.isBaselineTooBig

/** A record of the new path with the baseline, and the last-seen content it lacks, from the old path's record. */
const withBaselineOf = (own: RecordEntry, old: RecordEntry): RecordEntry => {
  if (!isUnknown(own) || isUnknown(old)) return own
  const lastSeen = own.lastSeen ?? old.lastSeen
  return {
    ...own,
    baseline: old.baseline,
    isBaselineTooBig: old.isBaselineTooBig,
    ...(lastSeen === undefined ? {} : { lastSeen }),
  }
}

/**
 * The records without the old path of a moved file, and the record that goes on at the touch's path: the path's own
 * (with the old path's baseline if it has none), else the old path's. A deleted file cannot be what moved, so a Deleted record stays where it is.
 */
function takeMoved(records: Record<string, RecordEntry>, touch: Touch) {
  const old = touch.oldPath === undefined ? undefined : records[touch.oldPath]
  if (touch.oldPath === undefined || old === undefined || old.tag === 'Deleted')
    return { rest: records, had: records[touch.path] }
  const rest = Object.fromEntries(Object.entries(records).filter(([path]) => path !== touch.oldPath))
  const own = rest[touch.path]
  return { rest, had: own === undefined ? old : withBaselineOf(own, old) }
}

/**
 * The last-seen content a record keeps after a touch: the touch's, if it saw the file, else the one it had. None
 * when the text is too big, or is the baseline, which stands for it.
 */
function lastSeenAfter(had: string | undefined, seen: string | undefined, baseline: string | null) {
  const text = seen ?? had
  return text === undefined || text.length > MAX_BASELINE || text === baseline ? {} : { lastSeen: text }
}

/**
 * Who owns a record's Tag and whether its dot shows after a touch. Whoever edited last owns the Tag: a Read leaves it
 * be, and anything else of Claude's takes it. The user's edit is not a Touch, so it leaves the dot as it was.
 */
function ownerOf(had: RecordEntry | undefined, touch: Touch) {
  const isByUser = touch.isByUser === true || (touch.tag === 'Read' && had?.isByUser === true)
  return {
    isRecent: touch.isByUser === true ? (had?.isRecent ?? false) : true,
    ...(isByUser ? { isByUser } : {}),
  }
}

/** The record of a file after a touch: its biggest Tag, its baseline (a later Touch fills it only while it is unknown), and the touch's number. */
function entryAfter(had: RecordEntry | undefined, touch: Touch, order: number): RecordEntry {
  const base = had === undefined || isUnknown(had) ? baselineOf(touch.baseline) : had
  const oldPath = touch.oldPath ?? had?.oldPath
  const tag = had !== undefined && RANK.indexOf(had.tag) >= RANK.indexOf(touch.tag) ? had.tag : touch.tag
  return {
    tag,
    ...ownerOf(had, touch),
    order,
    baseline: base.baseline,
    isBaselineTooBig: base.isBaselineTooBig,
    ...lastSeenAfter(had?.lastSeen, touch.seen, base.baseline),
    ...(oldPath === undefined ? {} : { oldPath }),
  }
}

/** The records with the touch folded in. A moved file's old path leaves the records and its record goes on at the new path, unless the new path has a record of its own. */
export function fold(records: Record<string, RecordEntry>, touch: Touch): Record<string, RecordEntry> {
  const { rest, had } = takeMoved(records, touch)
  const order = Object.values(records).reduce((top, e) => Math.max(top, e.order), 0) + 1
  return { ...rest, [touch.path]: entryAfter(had, touch, order) }
}

/** The records with every dot cleared; Tags and baselines stay. */
export const clearRecent = (records: Record<string, RecordEntry>): Record<string, RecordEntry> =>
  Object.fromEntries(Object.entries(records).map(([path, e]) => [path, { ...e, isRecent: false }]))

/** Whether a close is the person closing this mod's pane. */
export const isUserClose = (e: { id: string; origin: { kind: string } }): boolean =>
  e.id === PANE && e.origin.kind === 'person'

/** The words a file's Tag is drawn with: `Edited by you` where the user made the latest edit, whatever the Tag was before, else the Tag. */
export const tagWords = (e: Pick<RecordEntry, 'tag' | 'isByUser'>): string =>
  e.isByUser === true ? 'Edited by you' : e.tag
