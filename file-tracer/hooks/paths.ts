/** A path as the pane shows it outside the project: from `~/` where it sits under the home folder, whole otherwise. */
export function shortPath(path: string, home: string | null): string {
  const base = home?.replace(/\/$/, '') ?? null
  return base !== null && path.startsWith(`${base}/`) ? `~/${path.slice(base.length + 1)}` : path
}

/** The folder a file sits in, as the File view names it: from `~` where it is under the home folder, whole otherwise. The home folder itself is `~`. */
export const locationOf = (dir: string, home: string | null): string =>
  home !== null && dir === home.replace(/\/$/, '') ? '~' : shortPath(dir, home)

/** The characters of a cut path's start kept at least when its file name is cut too. */
const MIN_START = 8

/** The fewest letters of a cut folder's name worth showing before its …. */
const MIN_PARTIAL = 2

/** A path split for cutting: the folders before its file name (the first is '' on an absolute path), and the file name with its slash. */
type Split = { folders: string[]; file: string }

/** The path with `head` folders from its start, `tail` from its end, and `cutFolder` standing for the ones between. */
const joined = ({ folders, file }: Split, head: number, tail: number, cutFolder = '…'): string =>
  `${[...folders.slice(0, head), cutFolder, ...folders.slice(folders.length - tail)].join('/')}${file}`

/** How many folders to keep at the start and at the end: the end's nearest the file first, then the start's, as long as the room holds. */
function foldersKept(path: Split, room: number): [number, number] {
  let head = 1
  let tail = 0
  for (let isGrowing = true; isGrowing;) {
    isGrowing = false
    for (const isTail of [true, false]) {
      const [nextHead, nextTail] = isTail ? [head, tail + 1] : [head + 1, tail]
      if (nextHead + nextTail < path.folders.length && joined(path, nextHead, nextTail).length <= room) {
        ;[head, tail] = [nextHead, nextTail]
        isGrowing = true
      }
    }
  }
  return [head, tail]
}

/**
 * The path with the folders in its middle swapped for `…`, its first folder and its whole file name kept, and as many
 * whole folders either side as fit: `/private/tmp/…/notes/ab-03.md`. Room left over shows the start of the first folder
 * cut, `/private/tmp/cl…/notes/ab-03.md`. Where even `/…/ab-03.md` does not fit it is `…/ab-03.md`; null where that
 * does not fit either, or the path has no folder to cut.
 */
function cutFolders(text: string, room: number): string | null {
  const slash = text.lastIndexOf('/')
  if (slash < 0) return null
  const path = { folders: text.slice(0, slash).split('/'), file: text.slice(slash) }
  if (path.folders.length < 2 || joined(path, 1, 0).length > room)
    return `…${path.file}`.length <= room ? `…${path.file}` : null
  const [head, tail] = foldersKept(path, room)
  const spare = room - joined(path, head, tail).length
  if (spare < MIN_PARTIAL) return joined(path, head, tail)
  return joined(path, head, tail, `${path.folders[head]?.slice(0, spare) ?? ''}…`)
}

/** The text cut to `room` characters with a … at its end; whole where it fits. */
export function endCut(text: string, room: number): string {
  if (text.length <= room) return text
  if (room < 2) return room < 1 ? '' : '…'
  return `${text.slice(0, room - 1)}…`
}

/**
 * The text cut to `room` characters with a … in the middle. A path keeps its first folder and its whole file name and
 * loses the folders between, cut at a slash. Where even that does not fit, or the text has no folders, start and end
 * share the room, the start at least MIN_START characters where the room allows.
 */
export function middleCut(text: string, room: number): string {
  if (text.length <= room) return text
  if (room < 2) return room < 1 ? '' : '…'
  const folders = cutFolders(text, room)
  if (folders !== null) return folders
  const keep = room - 1
  const name = text.length - text.lastIndexOf('/')
  const end = Math.max(Math.ceil(keep / 2), Math.min(name, keep - MIN_START))
  return `${text.slice(0, keep - end)}…${text.slice(text.length - end)}`
}

/**
 * The cells the desktop app draws around a Button's label beyond the label itself. The strip's Restore button
 * (RESTORE_CELLS in register.tsx) is a 7-letter label plus a 1-cell gap plus this.
 */
const BUTTON_CHROME = 2

/** The fewest characters a cut name gets, however narrow the pane. A name given more than the row has left spills out of its column, so this is small. */
const LEAST_ROOM = 4

/** What sits in a file row beside its name button. */
type RowShape = { depth: number; tag: string | null; isRecent: boolean; countCells: readonly [number, number] }

/** The cells before the name: the marker, the chevron cell and the icon cell, one cell apart. */
const BEFORE_NAME = 1 + 1 + 2 + 1 + 2 + 1

/** The cells after the Tag and dot besides the two count columns: a gap, the spacer, and the gap between the columns. */
const COUNTS_GAPS = 1 + 1 + 1

/**
 * How many characters a file row's name button may hold in a pane `columns` cells wide. A row draws, one cell apart:
 * the indent (2 per level), the marker, the chevron cell, the icon cell, the button, the Tag, the dot and the counts (`countCells`, the width of each of the two columns as the row draws them).
 * The desktop app draws the button wider than its label (BUTTON_CHROME) and cuts a label that does not fit at its end,
 * so the mod cuts it first.
 */
export function nameRoom(columns: number, row: RowShape): number {
  if (columns <= 0) return Infinity
  const tag = row.tag === null ? 0 : 1 + row.tag.length
  const dot = row.isRecent ? 2 : 0
  const counts = COUNTS_GAPS + row.countCells[0] + row.countCells[1]
  return Math.max(columns - row.depth * 2 - BEFORE_NAME - tag - dot - counts - BUTTON_CHROME, LEAST_ROOM)
}

/** The cells a Group heading draws beside its place: the marker, the chevron cell, the name, the count and the five gaps between its six parts. The name is a Button on the desktop, which draws it wider than its label. */
const GROUP_CELLS = 1 + 2 + BUTTON_CHROME + 5

/** How many characters a Group heading's place may hold in a pane `columns` cells wide, after its name and its count; unlimited where the pane reports no width. */
export function placeRoom(columns: number, name: string, count: number): number {
  return columns <= 0 ? Infinity : columns - GROUP_CELLS - name.length - String(count).length
}

/**
 * How many characters a folder row's label may hold in a pane `columns` cells wide, `levels` tree levels down. The
 * desktop row draws, one cell apart: the marker, the chevron cell, the folder icon and the name button, which the app
 * draws wider than its label (BUTTON_CHROME). The terminal's has no icon and a one-cell chevron, and its label ends in a slash.
 */
export function folderRoom(columns: number, levels: number, isDesktop: boolean): number {
  if (columns <= 0) return Infinity
  const before = isDesktop ? 1 + 1 + 2 + 1 + 2 + 1 + BUTTON_CHROME : 1 + 1 + 1 + 1
  return Math.max(columns - levels * 2 - before, LEAST_ROOM)
}

/**
 * How many characters of a line the acting form's row may hold in a pane `columns` cells wide, after its number (`numberWidth`
 * digits) and the two spaces behind it. The desktop app draws a Button wider than its label (BUTTON_CHROME) and cuts
 * a label that does not fit at its end, so the mod cuts it first.
 */
export function lineRoom(columns: number, numberWidth: number, isDesktop: boolean): number {
  if (columns <= 0) return Infinity
  return Math.max(columns - numberWidth - 2 - (isDesktop ? BUTTON_CHROME : 0), LEAST_ROOM)
}
