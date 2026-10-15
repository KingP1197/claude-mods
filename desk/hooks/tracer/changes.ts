import type { StatusEntry } from './status'
import type { Touch } from './record'

/** One changed file at one moment: git's line for it, and a hash of its content now (null for a deleted file). */
type Entry = StatusEntry & { hash: string | null }

/** The changed files git listed at one moment, by path in the repository, and the repository's directory. */
export type GitSnapshot = { kind: 'git'; root: string; entries: Map<string, Entry> }

/** Every file under the session folder at one moment, as absolute paths: what stands in for git where there is none. */
export type FileSnapshot = { kind: 'files'; paths: ReadonlySet<string> }

export type Snapshot = GitSnapshot | FileSnapshot

/** A file the command changed: path in the repository, git's line for it after, and its line before (undefined if git listed none). */
type Change = { path: string; entry: Entry; had: Entry | undefined }

const isDeletedCode = (e: StatusEntry) => e.code.includes('D')
const isDeleted = (c: Change) => isDeletedCode(c.entry)
/** A file that did not exist before the command, as git sees it: untracked or newly staged, and unlisted before. */
const isNew = (c: Change) => (c.entry.code === '??' || c.entry.code.startsWith('A')) && c.had === undefined

/** A file git listed before and after: changed when its content hash differs, or it became deleted or came back; with a hash unknown on either side, only the second tells. */
const isChanged = (had: Entry, entry: Entry) =>
  had.hash !== null && entry.hash !== null ? had.hash !== entry.hash : isDeletedCode(had) !== isDeletedCode(entry)

/**
 * The files git lists after the command that it did not list before, or listed with another content hash: a file
 * changed before the command and changed again keeps its code, so only its hash tells; and `git add` changes the
 * code and not the content, so it is no change. A file deleted after, not before, is a change: it has no hash.
 * A file git listed as untracked before and lists no more is `vanished` when it is no longer on disk: deleted.
 */
function changedBetween(before: GitSnapshot, after: GitSnapshot, vanished: ReadonlySet<string>): Change[] {
  const listed = [...after.entries]
    .map(([path, entry]) => ({ path, entry, had: before.entries.get(path) }))
    .filter(({ entry, had }) => had === undefined || isChanged(had, entry))
  const deleted = [...vanished].flatMap((path) => {
    const had = before.entries.get(path)
    return had === undefined ? [] : [{ path, entry: { ...had, code: ' D', hash: null }, had }]
  })
  return [...listed, ...deleted]
}

/** The untracked files git listed before the command and does not list after it: deleted, or added to git. */
export const maybeVanished = (before: GitSnapshot, after: GitSnapshot): string[] =>
  [...before.entries].filter(([path, e]) => e.code === '??' && !after.entries.has(path)).map(([path]) => path)

/**
 * The deleted files whose content hash at HEAD the pairing needs: only when the command also made a new file,
 * and only for a file the mod saw no hash of before the command.
 */
export function headHashesNeeded(before: GitSnapshot, after: GitSnapshot, vanished: ReadonlySet<string>): string[] {
  const changed = changedBetween(before, after, vanished)
  if (!changed.some(isNew)) return []
  return changed.filter((c) => isDeleted(c) && c.had?.hash == null).map((c) => c.path)
}

/** For each new file whose content matches a deleted file's, that deleted file: git cannot tell a plain `mv` from the two. */
function pairMoves(changed: Change[], headHashes: ReadonlyMap<string, string>) {
  const gone = changed
    .filter(isDeleted)
    .map((c) => ({ path: c.path, hash: c.had?.hash ?? headHashes.get(c.path) ?? null }))
  const pairs = new Map<string, string>()
  for (const c of changed.filter(isNew)) {
    const at = gone.findIndex((d) => d.hash !== null && d.hash === c.entry.hash)
    const [match] = at < 0 ? [] : gone.splice(at, 1)
    if (match !== undefined) pairs.set(c.path, match.path)
  }
  return pairs
}

/** A Touch, and the path in the repository whose text at HEAD is the file's text from before the command; null when HEAD cannot tell. */
export type Found = { touch: Touch; headPath: string | null }

/** The Touches a command made where there is no git: a file in the second list and not the first is Created, the reverse Deleted. */
export function fileTouchesBetween(before: FileSnapshot, after: FileSnapshot): Touch[] {
  const created = [...after.paths].filter((path) => !before.paths.has(path))
  const deleted = [...before.paths].filter((path) => !after.paths.has(path))
  return [
    ...created.map((path): Touch => ({ path, tag: 'Created', baseline: '' })),
    ...deleted.map((path): Touch => ({ path, tag: 'Deleted', baseline: null })),
  ]
}

/** Where a changed file came from, if it was moved: git's own old path for a staged rename, else the deleted file it pairs with. */
const movedFrom = (c: Change, pairs: ReadonlyMap<string, string>): string | null =>
  c.had === undefined && c.entry.code.includes('R') ? c.entry.oldPath : (pairs.get(c.path) ?? null)

/** The Touch for one changed file; `oldPath` is where it moved from, in the repository, or null. */
function foundFor(c: Change, before: GitSnapshot, root: string, oldPath: string | null): Found {
  const path = `${root}/${c.path}`
  if (oldPath !== null) {
    const touch: Touch = { path, tag: 'Moved', baseline: null, oldPath: `${root}/${oldPath}` }
    return { touch, headPath: before.entries.has(oldPath) ? null : oldPath }
  }
  if (isNew(c)) return { touch: { path, tag: 'Created', baseline: '' }, headPath: null }
  return {
    touch: { path, tag: isDeleted(c) ? 'Deleted' : 'Edited', baseline: null },
    headPath: c.had === undefined ? c.path : null,
  }
}

/** The Touches a shell command made, from git's list of changed files before and after it. */
export function touchesBetween(
  before: GitSnapshot,
  after: GitSnapshot,
  vanished: ReadonlySet<string>,
  headHashes: ReadonlyMap<string, string>,
): Found[] {
  const changed = changedBetween(before, after, vanished)
  const pairs = pairMoves(changed, headHashes)
  const gone = new Set(pairs.values())
  return changed.filter((c) => !gone.has(c.path)).map((c) => foundFor(c, before, after.root, movedFrom(c, pairs)))
}
