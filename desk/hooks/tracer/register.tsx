// The file tracer: a pane with the folder tree of the files Claude touched.
// It opens by itself on the first Touch. Every hook lives in this file: the validator follows `$` only within one file.
import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, On } from 'claude-code'

import type { EventIn, EventOut, PlainNext } from '../handler'
import type { EditNote, LogEntry, RanEntry, SavedEntry, Tag, RecordEntry, TouchBy, TouchEntry } from '../../types'
import {
  fileTouchesBetween,
  headHashesNeeded,
  maybeVanished,
  touchesBetween,
  type FileSnapshot,
  type GitSnapshot,
  type Snapshot,
} from './changes'
import {
  ACTING_SLACK,
  editOf,
  fitWindow,
  jumpsOf,
  lineKeyOf,
  lineLabel,
  linesOf,
  pickedLine,
  textOf,
  windowOf,
} from './acting'
import { classify } from './classify'
import { attachedOf, attachedWords, commentText, isUsersPrompt, withComments } from './comments'
import { noteText, notesOf, withNote } from './notes'
import { RAISED_FILL, SELECTED_FILL } from './colours'
import { describe, inputFor, keptOf, keyOf, withKept, type DescribeInput, type DescriptionRequest } from './description'
import { failedNotice, insertAfter, noticeOf, removeLine, replaceLine, staleNotice } from './edit'
import { goneNotice, openingOf } from './openrule'
import { endCut, folderRoom, lineRoom, locationOf, middleCut, nameRoom, placeRoom, shortPath } from './paths'
import { parentOf, reveal, systemOf } from './reveal'
import { parseStatus } from './status'
import { drawnChars, hunksOf, named, viewOfChange, viewOfRead, type FileView } from './view'
import { mayBeInUnlistedWorktree, parseWorktrees } from './worktrees'
import { changedOf, summaryOf, type Summary } from './summary'
import { COMMAND, PANE, TITLE, clearRecent, fold, isUserClose, tagWords, withDefaults, type Touch } from './record'
import {
  MAX_TAIL,
  byText,
  commandLine,
  countsOfTouch,
  currentPath,
  currentTurn,
  inOrder,
  lastNumber,
  logOf,
  numbered,
  linesText,
  touchRowsOf,
  startTurn,
  tableChars,
  touchesOf,
  type Helper,
  type NewTouch,
  type Turn,
} from './log'
import {
  TIMELINE_ALT,
  TRAIL_PANE,
  TRAIL_TITLE,
  trailOf,
  type BoxRow,
  type HelperBox,
  type TrailRow,
  type TrailTurn,
} from './trail'
import { chevronSvg, folderSvg, iconSvg, typeIconOf } from './icons'
import { LINE_ALT, LINE_HEIGHT, LINE_LETTERS, dividerSvg, lineSvg, type LineCell } from './lines'
import {
  absoluteOf,
  buttonKey,
  COUNT_CELLS,
  countCellsOf,
  countPair,
  countsOf,
  diffCounts,
  dividerChars,
  MAX_FILES,
  rowOfKey,
  treeRowsOf,
  type Row,
} from './tree'

// The validator reads state only through atoms declared in this file.
const records = atom({ plugin: 'desk', key: 'records' } as const, {} as Record<string, SavedEntry>)
// The key an older version saved the records under. It is read, never written, and only while `records` is empty.
const olderRecords = atom({ plugin: 'desk', key: 'trail' } as const, {} as Record<string, SavedEntry>)

/** The records an older version saved stand in for the saved ones until the first write puts them under the new key. */
const orOlder = (own: Record<string, SavedEntry>, older: Record<string, SavedEntry>) =>
  Object.keys(own).length > 0 ? own : older

/** The saved records, from the older key while the new one holds none. */
async function savedRecords($: EngineInterface) {
  return orOlder(await read($, records), await read($, olderRecords))
}
// Every Touch in session order, but the newest few, which wait in `logTail`: a write costs as much as the value it writes.
const log = atom({ plugin: 'desk', key: 'log' } as const, [] as LogEntry[])
// The newest entries of the Touch log, until there are enough to move into `log`.
const logTail = atom({ plugin: 'desk', key: 'logTail' } as const, [] as LogEntry[])
// The Turns so far: each prompt the person submitted starts one.
const turns = atom({ plugin: 'desk', key: 'turns' } as const, [] as Turn[])
// The Turns the person closed in the Trail, by number. Turns start open.
const closedTurns = atom({ plugin: 'desk', key: 'closedTurns' } as const, [] as number[])
// Whether the person chose `Show Claude only` in the Trail: the helpers' boxes are left out.
const isClaudeOnly = atom({ plugin: 'desk', key: 'isClaudeOnly' } as const, false)
// The Touch the person pressed last in the Trail, by its number; null before any press.
const trailSelected = atom({ plugin: 'desk', key: 'trailSelected' } as const, null as number | null)
// The helpers Claude started, each by agent id.
const helpers = atom({ plugin: 'desk', key: 'helpers' } as const, [] as Helper[])
// Set when the person closes the pane; only `/file-tracer` clears it.
const closed = atom({ plugin: 'desk', key: 'closed' } as const, false)
// The folders the person closed in the tree, by path in the project.
const closedFolders = atom({ plugin: 'desk', key: 'closedFolders' } as const, [] as string[])

// The groups the person closed: 'worktrees' and 'outside'.
const closedGroups = atom({ plugin: 'desk', key: 'closedGroups' } as const, [] as string[])

// The row the person clicked last, by path in the project.
const selected = atom({ plugin: 'desk', key: 'selected' } as const, null as string | null)

// Whether the person chose `Changed only`.
const isChangedOnly = atom({ plugin: 'desk', key: 'isChangedOnly' } as const, false)

// Whether the person has opened the selected file's File view; `‹ All files` closes it.
const isFileOpen = atom({ plugin: 'desk', key: 'isFileOpen' } as const, false)

// Whether the open file's Changes section shows the whole file in place of its diff.
const isWholeFile = atom({ plugin: 'desk', key: 'isWholeFile' } as const, false)

// Whether the open file's whole-file text is drawn one pressable row per line (the acting form) in place of the code view.
const isActing = atom({ plugin: 'desk', key: 'isActing' } as const, false)

// The line of the acting form the person pressed last, counted from 1; null before any press.
const selectedLine = atom({ plugin: 'desk', key: 'selectedLine' } as const, null as number | null)

// The line the open Comment box belongs to; null while no box is open.
const commentLine = atom({ plugin: 'desk', key: 'commentLine' } as const, null as number | null)

// The line the open Edit box belongs to and the text it was opened with; null while no Edit box is open.
const editBox = atom({ plugin: 'desk', key: 'editBox' } as const, null as { line: number; original: string } | null)

// The notice a refused Save left under the selected line; null while there is none.
const notice = atom({ plugin: 'desk', key: 'notice' } as const, null as string | null)

// The notice a failed Open in Files left under the buttons of the File view; null while there is none.
const filesNotice = atom({ plugin: 'desk', key: 'filesNotice' } as const, null as string | null)

// The comments the person attached to their next message, each already in the shape Claude reads, oldest first.
const attached = atom({ plugin: 'desk', key: 'attached' } as const, [] as string[])

// What the person changed in files from the pane since their last message, oldest first.
const notes = atom({ plugin: 'desk', key: 'notes' } as const, [] as EditNote[])

// The Descriptions written so far, each by the key of the file and content it describes.
const descriptions = atom({ plugin: 'desk', key: 'descriptions' } as const, [] as Array<{ key: string; text: string }>)

/** The file the view area shows, what it was when it was last touched, what was made of its text when the person selected it, and what to ask the model about it; one read per selection, none per drawing. */
let shown: {
  path: string
  order: number | null
  view: FileView | null
  whole: FileView | null
  ask: DescribeInput | null
} | null = null

/** The most characters of text one drawing holds, the code view's source and the tree together; the engine cuts the drawing off past it. */
const MAX_DRAWN = 100_000

/** Room kept for the text of the drawing that is neither a row nor the file: the toolbar's counts and buttons, the "+N more files" row and the lines leading the view. */
const SLACK = 300

/** The view area's file for a selected path: a Read file's text, a changed file's diff, no view for a folder or a path the records lack. */
async function showFile($: EngineInterface, path: string, touched: Record<string, RecordEntry>) {
  const cwd = await $.session.cwd()
  const entry = touched[path]
  if (entry === undefined) return { path, order: null, view: null, whole: null, ask: null }
  // A deleted file is not on the disk: its view is its baseline, all of it removed.
  const read = entry.tag === 'Deleted' ? '' : await $.fs.read(path).catch(() => null)
  // What a deleted file lost is the last text the mod saw of it, else its text before the session's first change.
  const changed = entry.tag === 'Deleted' ? { ...entry, baseline: entry.lastSeen ?? entry.baseline } : entry
  const view = entry.tag === 'Read' ? viewOfRead(read) : viewOfChange(changed, read, { cwd, path })
  // The whole file is on offer beside a diff, as the text a read of the file gave.
  const text = 'diff' in view ? viewOfRead(read) : null
  const whole = text !== null && 'text' in text ? { ...text, leads: view.leads } : null
  return { path, order: entry.order, view, whole, ask: inputFor(changed, view, read, { cwd, path }) }
}

/** The keys of the Descriptions whose request is out. */
const pending = new Set<string>()

/** Asks the small model for the shown file's Description and keeps the reply; a reply that does not come changes nothing. */
async function describeShown($: EngineInterface) {
  const ask = shown?.ask
  if (ask == null) return
  const key = keyOf(ask)
  if (pending.has(key) || keptOf(await read($, descriptions)).some((d) => d.key === key)) return
  pending.add(key)
  $.ui.invalidate('ui.render')
  // The engine rejects only a request it refuses to send; that, too, leaves no Description.
  const askModel = async (request: DescriptionRequest) => {
    const r = await $.model.complete(request).catch(() => null)
    return r?.isAnswered === true ? r.text : null
  }
  const text = await describe(ask, askModel)
  pending.delete(key)
  if (text !== null) await update($, descriptions, (c) => withKept(c, { key, text }))
  // A failed request writes nothing, so the line standing in for the Description goes by a redraw of its own.
  $.ui.invalidate('ui.render')
}

/** A press on a file row in the App form, which has no File view: the row is selected and nothing else changes. `path` is absolute. */
const selectFile = ($: EngineInterface, path: string) => update($, selected, () => path)

/** A click on a file row: reads the file for the view area, then selects it. `path` is absolute. */
async function clickFile($: EngineInterface, path: string) {
  shown = await showFile($, path, withDefaults(await savedRecords($)))
  // Together, not one after another: the Description's request waits behind these, and a test counts the engine's turns until it is out.
  await Promise.all([
    update($, isWholeFile, () => false),
    update($, isActing, () => false),
    update($, selectedLine, () => null),
    update($, filesNotice, () => null),
    closeBox($),
  ])
  await update($, isFileOpen, () => true)
  await update($, selected, () => path)
  await describeShown($)
}

// Whether the pane had the keyboard at its last drawing. The desktop app spends a first click on an unfocused
// pane on focusing it and sends the button no press, so the focus hook runs the click's action instead.
let isPaneFocused = false

/** The git program with its arguments for one directory; it takes no repository lock a command of Claude's might want. */
const gitIn = (dir: string, ...args: string[]) => ['git', '-C', dir, '--no-optional-locks', ...args]

/** The folders of the project's worktrees as git last listed them; null while git has not answered since the mod loaded. */
let worktreeRoots: string[] | null = null

/** Asks git for the project's worktrees again; where git cannot answer, the list stays as it was. */
async function listWorktrees($: EngineInterface) {
  const cwd = await $.session.cwd()
  const r = await $.process.run(gitIn(cwd, 'worktree', 'list', '--porcelain'), { timeoutMs: 3000 }).catch(() => null)
  if (r !== null && r.exitCode === 0) worktreeRoots = parseWorktrees(r.stdout)
}

/** The one request for the list that a load of the mod makes when a Touch or a drawing finds it not yet answered. */
let firstListing: Promise<void> | null = null

/** The worktrees git lists. A list git has not answered since the mod loaded (a reload wipes it, and a session start that failed leaves it) is asked for once, whether or not that answers. */
async function knownWorktrees($: EngineInterface): Promise<string[]> {
  if (worktreeRoots === null) {
    firstListing ??= listWorktrees($)
    await firstListing
  }
  return worktreeRoots ?? []
}

/** A click on a folder row: closes the folder if it is open, opens it if closed, and selects it. */
async function clickFolder($: EngineInterface, path: string, abs: string) {
  await update($, closedFolders, (c) => (c.includes(path) ? c.filter((p) => p !== path) : [...c, path]))
  await update($, selected, () => abs)
}

/** Asks git for the worktrees again when a Touch lands in a path new to the records that may sit in one it has not listed. */
async function relistWorktreesFor($: EngineInterface, touches: Touch[]) {
  const [saved, cwd] = [await savedRecords($), await $.session.cwd()]
  const roots = await knownWorktrees($)
  const isNew = touches.some((t) => saved[t.path] === undefined && mayBeInUnlistedWorktree(t.path, cwd, roots))
  if (isNew) await listWorktrees($)
}

/** A click on a group header: hides the group's files if they show, shows them if hidden. */
const clickGroup = ($: EngineInterface, name: string) =>
  update($, closedGroups, (c) => (c.includes(name) ? c.filter((g) => g !== name) : [...c, name]))

/** The address of the toggle that shows every touched file or only the changed ones. */
const CHANGED_ONLY_KEY = 'changed-only'

/** The address of the `Trail` button. */
const TRAIL_KEY = 'show-trail'

/** Closes the Turn if it is open in the Trail, opens it if closed. */
const toggleTurn = ($: EngineInterface, n: number) =>
  update($, closedTurns, (c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]))

/** The address of the Trail's `Show Claude only` toggle. */
const CLAUDE_ONLY_KEY = 'claude-only'

/** Flips the Trail between `Show Claude only` and `Show all`. */
const toggleClaudeOnly = ($: EngineInterface) => update($, isClaudeOnly, (c) => c !== true)

/** A press on a Touch in the Trail: its file is selected in the Files pane, the Files pane is opened with the keyboard if it was closed, and the Touch is the Trail's selected one. The terminal opens the File view on the file; the App form runs the Open rule on its current path instead. */
async function pressTouch($: EngineInterface, t: TouchEntry, isApp: boolean) {
  const path = currentPath(await readLog($), t)
  if (isApp) await Promise.all([selectFile($, path), update($, filesNotice, () => null)])
  else await clickFile($, path)
  await update($, trailSelected, () => t.n)
  await update($, closed, () => false)
  await $.ui.open({ id: PANE, title: TITLE, focus: true }).catch(() => null)
  if (isApp) await openRule($, path)
}

/** Opens the Trail pane, beside Files. */
const openTrail = ($: EngineInterface) => $.ui.open({ id: TRAIL_PANE, title: TRAIL_TITLE })

/** Flips the toggle between `Changed only` and `All touched`. */
const toggleChangedOnly = ($: EngineInterface) => update($, isChangedOnly, (c) => c !== true)

/** The address of the `‹ All files` button. */
const BACK_KEY = 'back'

/** Closes the File view: the tree comes back with the same row selected. */
const closeFile = ($: EngineInterface) => update($, isFileOpen, () => false)

/** The address of the button that switches the Changes section between the diff and the whole file. */
const WHOLE_KEY = 'whole'

/** Flips the Changes section between the diff and the whole file. */
const toggleWholeFile = ($: EngineInterface) => update($, isWholeFile, (c) => c !== true)

/** The address of the button that switches the whole-file text between the code view and the acting form. */
const ACTING_KEY = 'acting'

/** Flips the whole-file text between the code view and the acting form. */
const toggleActing = ($: EngineInterface) => update($, isActing, (c) => c !== true)

/** The address of the `Discard` button beside the line counting the attached comments. */
const DISCARD_KEY = 'discard'

/** The line counting the comments attached to the next message, with the button that drops them; null while none are attached. */
function attachedRow($: EngineInterface, els: ElementTable, count: number) {
  const { Box, Text, Button } = els
  if (count === 0) return null
  return (
    <Box key="attached" flexDirection="row" gap={1}>
      <Text color={GREY}>{attachedWords(count)}</Text>
      <Button key={DISCARD_KEY} onPress={() => discardComments($)}>
        Discard
      </Button>
    </Box>
  )
}

/** The address of the `Comment` button, and of the box and buttons that replace it. */
const COMMENT_KEY = 'comment'
const COMMENT_INPUT_KEY = 'comment-input'
const SEND_KEY = 'send'
const ATTACH_KEY = 'attach'
const CANCEL_KEY = 'cancel'

/** What the person has typed in the Comment box so far. It is kept here, not in saved state: the field holds it, and a reload of the mod starts a blank box. */
let draft = ''

/** What the person has typed in the Edit box so far; null before any typing, when the box shows the line it was opened with. A reload of the mod starts it null, so a box kept in saved state holds its line again and not an empty field. */
let typed: string | null = null

/** Opens the Comment box under the selected line. */
async function openComment($: EngineInterface) {
  const n = pickedLine(await read($, selectedLine))
  draft = ''
  if (n !== null) await update($, commentLine, () => n)
}

/** Opens the Edit box under the selected line, holding the line's text as the pane shows it. */
async function openEdit($: EngineInterface) {
  const n = pickedLine(await read($, selectedLine))
  const text = shown === null ? null : textOf(shown.view ?? { note: '' }, shown.whole)
  const original = n === null || text === null ? undefined : linesOf(text)[n - 1]
  if (n === null || original === undefined) return
  await update($, commentLine, () => null)
  typed = null
  await update($, editBox, () => ({ line: n, original }))
}

/** The new text of a file, made from the text the file has now; null where the box's line is no longer what it was opened with. */
type Change = (file: string) => string | null

/**
 * Writes the file the change makes, unless the file's line is no longer the one the box was opened with: then it
 * writes nothing, reads the file again for the pane and says so. A write the file refuses says so too. The text it wrote; null where it wrote nothing.
 */
async function changeFile(
  $: EngineInterface,
  line: number,
  change: Change,
  note?: Omit<EditNote, 'path'>,
): Promise<string | null> {
  const path = await read($, selected)
  if (path === null) return null
  const file = await $.fs.read(path).catch(() => null)
  const next = file === null ? null : change(file)
  await closeBox($)
  const isWritten =
    next !== null &&
    (await $.fs.write(path, next).then(
      () => true,
      () => false,
    ))
  if (isWritten) {
    await recordUserEdit($, path, { before: file ?? '', after: next })
    const cwd = await $.session.cwd()
    if (note !== undefined)
      await update($, notes, (own) => withNote(notesOf(own), { ...note, path: named(cwd, absoluteOf(cwd, path)) }))
  }
  shown = await showFile($, path, withDefaults(await savedRecords($)))
  if (isWritten) await describeShown($)
  else await update($, notice, () => (file !== null && next === null ? staleNotice(line) : failedNotice(line)))
  return isWritten ? next : null
}

/** Writes the typed line over the line the Edit box was opened on. */
async function saveEdit($: EngineInterface, typedWords: string | null) {
  const box = editOf(await read($, editBox))
  if (box === null) return
  const words = typedWords ?? box.original
  if (words === box.original) return closeBox($)
  const note = { line: box.line, kind: 'changed', was: box.original, now: words } as const
  await changeFile($, box.line, (file) => replaceLine(file, box.line, box.original, words), note)
}

/** Writes the file without the line the Edit box was opened on. */
async function deleteLine($: EngineInterface) {
  const box = editOf(await read($, editBox))
  if (box === null) return
  const note = { line: box.line, kind: 'deleted', was: box.original, now: '' } as const
  const next = await changeFile($, box.line, (file) => removeLine(file, box.line, box.original), note)
  if (next === null) return
  // With the last line gone, the one above it is selected, so Comment and Edit keep a line to draw under.
  const last = linesOf(next).length
  if (box.line > last) await update($, selectedLine, () => (last < 1 ? null : last))
}

/** Writes a blank line after the line the Edit box was opened on, and opens the box on it. */
async function addLine($: EngineInterface) {
  const box = editOf(await read($, editBox))
  if (box === null) return
  const note = { line: box.line + 1, kind: 'added', was: '', now: '' } as const
  if ((await changeFile($, box.line, (file) => insertAfter(file, box.line, box.original), note)) === null) return
  await update($, selectedLine, () => box.line + 1)
  await update($, editBox, () => ({ line: box.line + 1, original: '' }))
}

/** Closes the Comment box and the Edit box, and forgets what was typed in them. */
async function closeBox($: EngineInterface) {
  draft = ''
  typed = null
  // Only a box that is open is written to, and both together: a click on a file waits on this before it asks for the Description, and every write costs turns.
  const [comment, edit, said] = await Promise.all([read($, commentLine), read($, editBox), read($, notice)])
  await Promise.all([
    comment === null ? null : update($, commentLine, () => null),
    edit === null ? null : update($, editBox, () => null),
    said === null ? null : update($, notice, () => null),
  ])
}

/** The comment on the selected line, as Claude reads it; null where no line of a shown file is selected. */
async function commentOnSelected($: EngineInterface, words: string): Promise<string | null> {
  const [path, n] = [await read($, selected), pickedLine(await read($, selectedLine))]
  const text = shown === null ? null : textOf(shown.view ?? { note: '' }, shown.whole)
  if (path === null || n === null || text === null) return null
  const line = linesOf(text)[n - 1]
  if (line === undefined) return null
  return commentText(
    { path: named(await $.session.cwd(), absoluteOf(await $.session.cwd(), path)), line: n, text: line },
    words,
  )
}

/** Holds the comment until the person's next message, and closes the box. */
async function attachComment($: EngineInterface, words: string) {
  if (words.trim() === '') return
  const text = await commentOnSelected($, words)
  await closeBox($)
  if (text !== null) await update($, attached, (own) => [...attachedOf(own), text])
}

/** Drops the comments attached to the next message. */
const discardComments = ($: EngineInterface) => update($, attached, () => [])

/** Gives Claude the comment at once, as a message of its own, and closes the box. A message the engine refuses or cannot send leaves the box open with what was typed, and says so. */
async function sendComment($: EngineInterface, words: string) {
  if (words.trim() === '') return
  const text = await commentOnSelected($, words)
  if (text === null) return closeBox($)
  const failure = await $.prompt.submit({ text, asUser: true }).then(
    (r) => (r.drop === undefined ? null : 'was refused'),
    () => 'could not be sent',
  )
  if (failure === null) await closeBox($)
  else $.ui.toast(`The comment ${failure}.`)
}

/** Selects a line of the acting form: `Comment` and `Edit` are drawn under it. A Comment or Edit box open on another line closes. */
async function pickLine($: EngineInterface, n: number) {
  const open = (await read($, commentLine)) ?? editOf(await read($, editBox))?.line ?? null
  if (open !== n) await closeBox($)
  await update($, selectedLine, () => n)
}

/** Switches the whole-file text to the acting form with a line selected: what a press on a `Line N` button under Changes does. */
async function jumpToLine($: EngineInterface, n: number) {
  await pickLine($, n)
  await update($, isActing, () => true)
}

/** Opens the pane at the default size; the engine keeps a size the person dragged. */
const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE })

/** The text a record last held of its file, or null where it holds none. */
const textBefore = (e: RecordEntry | undefined): string | null => e?.lastSeen ?? e?.baseline ?? null

/** The Touch log whole: its older piece and its newer one. */
async function readLog($: EngineInterface) {
  return logOf(await read($, log), await read($, logTail))
}

const inLogOrder = inOrder()

/** Adds the entries to the Touch log. They wait in the small newer piece; once it is full, both move into the older piece. */
const appendToLog = ($: EngineInterface, entries: Array<RanEntry | NewTouch>) =>
  inLogOrder(async () => {
    const tail = await read($, logTail)
    const base = lastNumber(tail) ?? lastNumber(await read($, log)) ?? 0
    const next = [...tail, ...numbered(base, entries)]
    if (next.length <= MAX_TAIL) {
      await update($, logTail, () => next)
      return
    }
    await update($, log, (own) => logOf(own, next))
    await update($, logTail, () => [])
  })

/** Adds the Touches to the records in one write; the first one of the session opens the pane. */
async function recordAll(
  $: EngineInterface,
  touches: Touch[],
  by: TouchBy,
  afters: Map<string, string> = new Map(),
  command?: string,
) {
  if (touches.length === 0) return
  await relistWorktreesFor($, touches)
  let isFirst = false
  let prior: Record<string, RecordEntry> = {}
  const older = await read($, olderRecords)
  await update($, records, (own) => {
    const t = orOlder(own, older)
    isFirst = Object.keys(t).length === 0
    prior = withDefaults(t)
    return touches.reduce(fold, withDefaults(t))
  })
  const turn = currentTurn(await read($, turns))
  const ran =
    command === undefined
      ? []
      : [
          {
            type: 'ran' as const,
            turn,
            command,
            files: touches.length,
            ...(by.kind === 'helper' ? { helperId: by.id } : {}),
          },
        ]
  const made = touches.map((t) => ({
    kind: t.tag,
    path: t.path,
    turn,
    by,
    counts: countsOfTouch(t, { after: afters.get(t.path) ?? null, had: textBefore(prior[t.oldPath ?? t.path]) }),
    ...(t.oldPath === undefined ? {} : { oldPath: t.oldPath }),
  }))
  await appendToLog($, [...ran, ...made])
  if (isFirst && !(await read($, closed))) await openPane($)
}

/** Records the user's saved edit of a file: the file's record takes the Tag `Edited by you` and the new text, and the log gains a Touch made by the user with the lines it added and removed. */
async function recordUserEdit($: EngineInterface, path: string, text: { before: string; after: string }) {
  const older = await read($, olderRecords)
  await update($, records, (own) =>
    fold(withDefaults(orOlder(own, older)), { path, tag: 'Edited', baseline: null, seen: text.after, isByUser: true }),
  )
  const turn = currentTurn(await read($, turns))
  await appendToLog($, [
    { kind: 'Edited', path, turn, by: { kind: 'user' }, counts: diffCounts(text.before, text.after) },
  ])
}

/** The address of the Reveal button, which a press or a focus names back. */
const REVEAL_KEY = 'reveal'

/** The address of the Open in Files button. */
const OPEN_FILES_KEY = 'openFiles'

/** The actions of the pane's buttons that are not rows, by address. */
const buttonActions = ($: EngineInterface): Record<string, () => Promise<unknown>> => ({
  [REVEAL_KEY]: () => revealSelected($),
  [OPEN_FILES_KEY]: () => openInFiles($),
  [CHANGED_ONLY_KEY]: () => toggleChangedOnly($),
  [TRAIL_KEY]: () => openTrail($),
  [WHOLE_KEY]: () => toggleWholeFile($),
  [ACTING_KEY]: () => toggleActing($),
  [COMMENT_KEY]: () => openComment($),
  [SEND_KEY]: () => sendComment($, draft),
  [ATTACH_KEY]: () => attachComment($, draft),
  [EDIT_KEY]: () => openEdit($),
  [SAVE_KEY]: () => saveEdit($, typed),
  [ADD_KEY]: () => addLine($),
  [DELETE_KEY]: () => deleteLine($),
  [CANCEL_KEY]: () => closeBox($),
  [DISCARD_KEY]: () => discardComments($),
  [BACK_KEY]: () => closeFile($),
})

/** Runs the action of the row button a first click on the unfocused pane landed on, as its onPress would. */
async function pressByKey($: EngineInterface, key: string | undefined) {
  const actions = buttonActions($)
  if (key !== undefined && Object.hasOwn(actions, key)) return actions[key]?.()
  const at = lineKeyOf(key)
  if (at !== null) return at.kind === 'jump' ? jumpToLine($, at.n) : pickLine($, at.n)
  const row = rowOfKey(key)
  if (row === null) return
  if (row.kind === 'group') return clickGroup($, row.path)
  const abs = absoluteOf(await $.session.cwd(), row.path)
  if (row.kind === 'dir') return clickFolder($, row.path, abs)
  return (await isInApp($)) ? pressAppFile($, abs) : clickFile($, abs)
}

/** Who made a Touch: Claude's own loop (no agent id) or the helper whose loop raised the call. */
const madeBy = (agentId: string | undefined): TouchBy =>
  agentId === undefined ? { kind: 'claude' } : { kind: 'helper', id: agentId }

/**
 * Whether the desktop app draws this session, where the mod takes its App form: it records, runs git and opens the
 * pane as in the terminal, and draws the tree and the Trail without the File view. The roster is read per event,
 * not once at start, because the app attaches after the session starts.
 */
const isInApp = async ($: EngineInterface) => (await $.session.surfaces()).includes('desktop')

function toolHooks(on: On) {
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const touch = r.deny === undefined && r.isError !== true ? classify(e, r.result) : null
    if (touch !== null) await recordAll($, [touch], madeBy(e.agentId))
    return r
  }).catch(($, e, next) => next(e))
}

/** The most runs of git's hashing one command makes: the first, and a new one each time git stopped at a path it cannot hash. */
const MAX_HASH_RUNS = 10

/**
 * One content hash per path (relative to `root`) that git could hash. Git hashes the paths in turn and stops at the
 * first it cannot hash (a link to a folder, a submodule), having printed the hashes before it: skip that path and go
 * on with the ones after it, up to MAX_HASH_RUNS runs in all.
 */
async function hashesOf($: EngineInterface, root: string, paths: string[]): Promise<Map<string, string>> {
  const hashes = new Map<string, string>()
  let rest = paths
  for (let runs = 0; rest.length > 0 && runs < MAX_HASH_RUNS; runs += 1) {
    // Each run needs the one before it: it starts where that one stopped.
    const r = await $.process.run(gitIn(root, 'hash-object', '--stdin-paths'), {
      stdin: `${rest.join('\n')}\n`,
      timeoutMs: 3000,
    })
    const lines = r.stdout.split('\n').filter((line) => line !== '')
    const done = r.exitCode === 0 ? rest.length : Math.min(lines.length, rest.length)
    rest.slice(0, done).forEach((path, i) => hashes.set(path, lines[i] ?? ''))
    rest = rest.slice(done + 1)
  }
  return hashes
}

/** The content hash at HEAD of each path (relative to `root`) that HEAD has. */
async function headHashesOf($: EngineInterface, root: string, paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const r = await $.process.run(gitIn(root, 'cat-file', '--batch-check'), {
    stdin: paths.map((path) => `HEAD:${path}\n`).join(''),
    timeoutMs: 3000,
  })
  const lines = r.stdout.split('\n')
  const answers = paths.map((path, i) => [path, (lines[i] ?? '').split(' ')] as const)
  return new Map(
    answers.flatMap(([path, [hash, kind]]) => (kind === 'blob' && hash !== undefined ? [[path, hash]] : [])),
  )
}

/** The text of a path (relative to `root`) at HEAD; null when HEAD has none. */
async function headTextOf($: EngineInterface, root: string, path: string | null): Promise<string | null> {
  if (path === null) return null
  const r = await $.process.run(gitIn(root, 'show', `HEAD:${path}`), { timeoutMs: 3000 })
  return r.exitCode === 0 ? r.stdout : null
}

/** The repository's top folder, from the session folder and where the session folder sits in the repository. */
function rootOf(cwd: string, prefix: string): string | null {
  const inside = prefix.trim().replace(/\/$/, '')
  if (inside === '') return cwd
  return cwd.endsWith(`/${inside}`) ? cwd.slice(0, cwd.length - inside.length - 1) : null
}

/** The most files a list of changed files, or of all files, holds. A longer list is given up: a part of one would show files as created or deleted that were not. */
const MAX_LISTED = 20_000

/**
 * The files git lists as changed right now, with a hash of each one's content; null where git says it is no
 * repository, 'too-many' past MAX_LISTED files or when the engine cut the list short, and a rejection where git cannot run.
 */
async function gitSnapshotOf($: EngineInterface, cwd: string): Promise<GitSnapshot | null | 'too-many'> {
  const [listing, where] = await Promise.all([
    $.process.run(gitIn(cwd, 'status', '--porcelain=v1', '-z', '--untracked-files=all'), { timeoutMs: 3000 }),
    $.process.run(gitIn(cwd, 'rev-parse', '--show-prefix'), { timeoutMs: 3000 }),
  ])
  const root = rootOf(cwd, where.stdout)
  if (listing.exitCode !== 0 || where.exitCode !== 0 || root === null) return null
  const listed = parseStatus(listing.stdout)
  if (listing.isStdoutTruncated || listed.length > MAX_LISTED) return 'too-many'
  const hashes = await hashesOf(
    $,
    root,
    listed.filter((entry) => !entry.code.includes('D')).map((entry) => entry.path),
  )
  return {
    kind: 'git',
    root,
    entries: new Map(listed.map((entry) => [entry.path, { ...entry, hash: hashes.get(entry.path) ?? null }])),
  }
}

/** The most files whose text at HEAD one command asks git for. */
const MAX_BASELINES = 100

/** Every file under the session folder, except under `.git` and `node_modules`, found with `find`; null when there are too many or the engine cut the list short. */
async function fileSnapshotOf($: EngineInterface, cwd: string): Promise<FileSnapshot | null> {
  const r = await $.process.run(
    [
      'find',
      cwd,
      '-type',
      'd',
      '(',
      '-name',
      '.git',
      '-o',
      '-name',
      'node_modules',
      ')',
      '-prune',
      '-o',
      '-type',
      'f',
      '-print0',
    ],
    { timeoutMs: 3000 },
  )
  const paths = r.stdout.split('\0').filter((path) => path !== '')
  return r.isStdoutTruncated || paths.length > MAX_LISTED ? null : { kind: 'files', paths: new Set(paths) }
}

/**
 * Whether git cannot start at all. A program that cannot start rejects, and so does one that outruns its time, in
 * words the engine does not document; so ask git its version, which it answers at once wherever it is installed.
 */
const isGitMissing = ($: EngineInterface) =>
  $.process.run(['git', '--version'], { timeoutMs: 3000 }).then(
    () => false,
    () => true,
  )

/**
 * Where Claude's command can be watched: git's list of changed files, else a list of every file; null when neither
 * answers, and when git outruns its time (then nothing is watched, whatever else could answer).
 */
async function snapshotOf($: EngineInterface): Promise<Snapshot | null> {
  const cwd = await $.session.cwd()
  let git: GitSnapshot | null | 'too-many' = null
  try {
    git = await gitSnapshotOf($, cwd)
  } catch {
    if (!(await isGitMissing($))) return null
  }
  if (git === 'too-many') return null
  if (git !== null) return git
  return fileSnapshotOf($, cwd).catch(() => null)
}

/** The untracked files git listed before the command and no more after it, that are no longer on disk: the command deleted them. */
async function vanishedSince($: EngineInterface, before: GitSnapshot, after: GitSnapshot): Promise<Set<string>> {
  const checked = await Promise.all(
    maybeVanished(before, after).map(async (path) => [path, await $.fs.exists(`${after.root}/${path}`)] as const),
  )
  return new Set(checked.filter(([, isThere]) => !isThere).map(([path]) => path))
}

/** The Touches of a command that ran between `before` and now, each with the text it had before when HEAD can say. */
async function touchesSince($: EngineInterface, before: Snapshot): Promise<Touch[]> {
  const after = await snapshotOf($)
  if (before.kind === 'files') return after?.kind === 'files' ? fileTouchesBetween(before, after) : []
  if (after?.kind !== 'git') return []
  const vanished = await vanishedSince($, before, after)
  const heads = await headHashesOf($, after.root, headHashesNeeded(before, after, vanished))
  const saved = withDefaults(await savedRecords($))
  const found = touchesBetween(before, after, vanished, heads)
  // A file the records hold no baseline for, clean before the command: HEAD holds the text it had at the session's start.
  // A moved file whose old place the records hold a baseline for needs none: the records carry that one over.
  // Only the first MAX_BASELINES are asked for, so a command that changes thousands of files starts few programs.
  const hasBaseline = (path: string | undefined) => {
    const e = path === undefined ? undefined : saved[path]
    return e !== undefined && (e.baseline !== null || e.isBaselineTooBig)
  }
  const isKnown = (t: Touch) => hasBaseline(t.path) || hasBaseline(t.oldPath)
  const unseen = found.filter((f) => f.headPath !== null && !isKnown(f.touch))
  const asked = new Set(unseen.slice(0, MAX_BASELINES))
  return Promise.all(
    found.map(async (f) =>
      asked.has(f) ? { ...f.touch, baseline: await headTextOf($, after.root, f.headPath) } : f.touch,
    ),
  )
}

/** A helper Claude starts is kept by its agent id with its type and description, so its Touches can be named. */
export async function agentSpawn(
  $: EngineInterface,
  e: EventIn<'agent.spawn'>,
  next: PlainNext<'agent.spawn'>,
): Promise<EventOut<'agent.spawn'>> {
  const r = await next(e)
  const id = r.agentId
  if (r.deny === undefined && id !== undefined) {
    const helper = { id, type: e.subagentType, description: e.description }
    await update($, helpers, (own) => [...own.filter((h) => h.id !== id), helper])
  }
  return r
}

/** The most files whose text after a command is read to count the lines it changed. */
const MAX_COUNT_READS = 100

/** The text each file a command changed has now, for the first MAX_COUNT_READS files that are still there; a file that cannot be read has none. */
async function textsAfter($: EngineInterface, touches: Touch[]): Promise<Map<string, string>> {
  const asked = touches.filter((t) => t.tag !== 'Deleted' && t.tag !== 'Read').slice(0, MAX_COUNT_READS)
  const read = await Promise.all(asked.map(async (t) => [t.path, await $.fs.read(t.path).catch(() => null)] as const))
  return new Map(read.flatMap(([path, text]) => (text === null ? [] : [[path, text] as const])))
}

function commandHooks(on: On) {
  // A shell command Claude runs touches the files it changes: git's list of changed files, before and after.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const before = await snapshotOf($)
    const r = await next(e)
    // A command that failed or was refused changes nothing here, whatever it left on disk.
    if (before !== null && r.deny === undefined && r.isError !== true) {
      // A command whose Touches could not all be found makes none: git ran out of time, or answered half.
      const touches = await touchesSince($, before).catch(() => [])
      const command = commandLine(e.command)
      const by = e.agentId === undefined ? { kind: 'command' as const, text: command } : madeBy(e.agentId)
      await recordAll($, touches, by, await textsAfter($, touches), command)
    }
    return r
  }).catch(($, e, next) => next(e))
}

export async function sessionStart(
  $: EngineInterface,
  e: EventIn<'session.start'>,
  next: PlainNext<'session.start'>,
): Promise<EventOut<'session.start'>> {
  const out = await next(e)
  await listWorktrees($)
  await $.command.register({ name: COMMAND, description: 'Show the file tracer: the files Claude touched' })
  return out
}

function sessionHooks(on: On) {
  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() === 'trail') {
      await openTrail($)
      return { text: 'Trail opened.' }
    }
    await update($, closed, () => false)
    await openPane($)
    return { text: 'File tracer opened.' }
  })
}

/** The person's next message ends the stretch the dots mark. The prompt itself goes on untouched. */
export async function promptSubmit(
  $: EngineInterface,
  e: EventIn<'prompt.submit'>,
  next: PlainNext<'prompt.submit'>,
): Promise<EventOut<'prompt.submit'>> {
  const older = await read($, olderRecords)
  await update($, records, (own) => clearRecent(withDefaults(orOlder(own, older))))
  const logged = await readLog($)
  await update($, turns, (own) => startTurn(own, logged, e.text))
  // The comments the person attached ride on their next prompt, then none is left.
  const isUsers = isUsersPrompt(e.origin)
  const taken = isUsers ? attachedOf(await read($, attached)) : []
  const told = isUsers ? notesOf(await read($, notes)).map(noteText) : []
  const out = await next(
    taken.length + told.length === 0 ? e : { ...e, text: withComments(e.text, [...taken, ...told]) },
  )
  if (taken.length > 0) await update($, attached, (own) => attachedOf(own).slice(taken.length))
  if (told.length > 0) await update($, notes, (own) => notesOf(own).slice(told.length))
  return out
}

function closeHooks(on: On) {
  on('ui.close', async ($, e, next) => {
    if (isUserClose(e)) await update($, closed, () => true)
    return next(e)
  })
}

const GREY = 'inactive'

/** The counts at the near end of the top row, `24 files | 6 changed | +120 -14`, a count of zero left out; a blank cell while nothing is touched, so the buttons stay at the far end. */
function summaryText(els: ElementTable, { files, changed, added, removed }: Summary) {
  const { Text } = els
  if (files === 0) return <Text> </Text>
  const separator = <Text color="subtle">{' | '}</Text>
  return (
    <Text color={GREY}>
      {files === 1 ? '1 file' : `${files} files`}
      {separator}
      {`${changed} changed`}
      {added === 0 && removed === 0 ? null : separator}
      {added === 0 ? null : <Text color="success">{`+${added}`}</Text>}
      {added === 0 || removed === 0 ? null : ' '}
      {removed === 0 ? null : <Text color="error">{`-${removed}`}</Text>}
    </Text>
  )
}

/** The line the pane draws while no file has been touched. */
const EMPTY = 'No files yet. A file appears here when Claude touches one.'

/** The line the pane draws while `Changed only` is on and no touched file has changed. */
const NONE_CHANGED = 'No changed files yet. A file appears here when Claude changes one.'

/** The line that says why the tree is empty, or nothing while the tree has rows: no file touched yet, or `Changed only` with none changed. */
function emptyLine(els: ElementTable, touchedFiles: number, rows: Row[]) {
  const { Box, Text } = els
  if (rows.length > 0) return null
  return (
    <Box key="empty">
      <Text color={GREY}>{touchedFiles === 0 ? EMPTY : NONE_CHANGED}</Text>
    </Box>
  )
}

/** The line standing in the Description's place while its request is out. */
const WRITING = 'Writing a description…'
// Theme colours by Tag: grey for a Read, yellow for an Edit, green for a new file, red for a deletion.
// A move takes the theme's `merged` key.
const COLOR: Partial<Record<Tag, string>> = {
  Read: GREY,
  Edited: 'warning',
  Created: 'success',
  Deleted: 'error',
  Moved: 'merged',
}

/**
 * The heading of a Group: a chevron to open or close it, its name in bold, its count, and its place on disk at the
 * trailing edge. In the terminal only the chevron is a Button, since a Button's label takes no colour. On the desktop
 * the chevron is a picture, as in the tree's folder rows, and the name is the Button.
 */
function groupRow($: EngineInterface, els: ElementTable, look: Look, r: Row) {
  const { Box, Text, Button } = els
  const Svg = svgOf(els, look)
  return (
    <Box key={`section:${r.path}`} flexDirection="row" gap={1}>
      <Text> </Text>
      {Svg === null ? (
        <Button key={buttonKey(r)} plain onPress={() => clickGroup($, r.path)}>
          {r.isOpen ? '▾' : '▸'}
        </Button>
      ) : (
        <Box key={`chevron:${r.path}`} width={2} flexShrink={0}>
          <Svg source={chevronSvg(r.isOpen)} alt={r.isOpen ? 'chevron down' : 'chevron right'} width={14} height={14} />
        </Box>
      )}
      <Box key={`name:${r.path}`} flexShrink={0}>
        {Svg === null ? (
          <Text color="text" bold>
            {r.name}
          </Text>
        ) : (
          <Button key={buttonKey(r)} plain onPress={() => clickGroup($, r.path)}>
            <Text bold>{r.name}</Text>
          </Button>
        )}
      </Box>
      <Text color={GREY}>{String(r.count)}</Text>
      <Box flexGrow={1} />
      <Box key={`place:${r.path}`} flexShrink={1}>
        <Text color={GREY} wrap="truncate-middle">
          {middleCut(r.place, placeRoom(look.columns, r.name, r.count))}
        </Text>
      </Box>
    </Box>
  )
}

/** The props that fill the selected row across its width on the desktop; none for any other row, and none in the terminal, which marks the row with `›` and bold. A prop left undefined makes the engine refuse the drawing, so an unselected row gets no key at all. */
const fillOf = (isSelected: boolean, look: Look) =>
  isSelected && look.isDesktop ? { backgroundColor: SELECTED_FILL } : {}

/** The marker column of a row: `›` in the focus colour on the selected row, a blank cell otherwise. */
function marker(els: ElementTable, isSelected: boolean) {
  const { Text } = els
  return isSelected ? <Text color="suggestion">›</Text> : <Text> </Text>
}

/** The cells a row's tree lines take: two per level. */
const lineWidth = (r: Row) => r.lines.length * 2

/** The tree lines of a row, one two-cell box per level: a picture on the desktop, `├─`, `│` or `└─` in the terminal; none for a row at the top. They sit inside the chevron's cell, so the last of them falls in the column of its folder's chevron. */
function lineCells(els: ElementTable, look: Look, r: Row) {
  const { Box, Text } = els
  const Svg = svgOf(els, look)
  if (r.lines.length === 0) return null
  const cellView = (cell: LineCell) => {
    if (Svg === null) return <Text color="subtle">{LINE_LETTERS[cell]}</Text>
    if (cell === 'blank') return null
    return <Svg source={lineSvg(cell)} alt={LINE_ALT[cell]} width={14} height={LINE_HEIGHT} />
  }
  return (
    <Box flexShrink={0}>
      {r.lines.map((cell) => (
        <Box width={2} flexShrink={0}>
          {cellView(cell)}
        </Box>
      ))}
    </Box>
  )
}

/** A folder row: the marker, the chevron, on the desktop the folder icon, then the name as the only clickable part; in the terminal the chevron is `▸` or `▾` and the name ends in a slash. */
function dirRow($: EngineInterface, els: ElementTable, selectedPath: string | null, look: Look, r: Row) {
  const { Box, Text, Button } = els
  const Svg = svgOf(els, look)
  const isSelected = r.abs === selectedPath
  const label = endCut(Svg === null ? `${r.name}/` : r.name, folderRoom(look.columns, r.lines.length, Svg !== null))
  return (
    <Box key={`row:${r.path}`} flexDirection="row" gap={1} {...fillOf(isSelected, look)}>
      {marker(els, isSelected && !look.isDesktop)}
      <Box key={`chevron:${r.path}`} flexDirection="row" width={lineWidth(r) + (Svg === null ? 1 : 2)} flexShrink={0}>
        {lineCells(els, look, r)}
        {Svg === null ? (
          <Text color={GREY}>{r.isOpen ? '▾' : '▸'}</Text>
        ) : (
          <Svg source={chevronSvg(r.isOpen)} alt={r.isOpen ? 'chevron down' : 'chevron right'} width={14} height={14} />
        )}
      </Box>
      {Svg === null ? null : (
        <Box key={`icon:${r.path}`} width={2} flexShrink={0}>
          <Svg source={folderSvg(r.isOpen)} alt="folder" width={14} height={14} />
        </Box>
      )}
      <Box key={`name:${r.path}`} flexShrink={1}>
        <Button key={buttonKey(r)} plain onPress={() => clickFolder($, r.path, r.abs)}>
          {isSelected ? <Text bold>{label}</Text> : label}
        </Button>
      </Box>
    </Box>
  )
}

/** The text in a file row's name button, cut by the mod to the room its row leaves: at its end, or, for a whole path, in the middle. The desktop app does not cut a row to its column, and its own cut would fall on the button's chrome. */
function nameText(els: ElementTable, look: Look, r: Row, isSelected: boolean) {
  const { Text } = els
  const bold = isSelected ? { bold: true } : {}
  if (r.isPath)
    return (
      <Text wrap="truncate-middle" {...bold}>
        {middleCut(r.name, nameRoom(look.columns, { ...r, tag: r.tagWords, countCells: countCellsOf(r.counts) }))}
      </Text>
    )
  return (
    <Text wrap="truncate-end" {...bold}>
      {endCut(r.name, nameRoom(look.columns, { ...r, tag: r.tagWords, countCells: countCellsOf(r.counts) }))}
    </Text>
  )
}

/** The Tag and the dot after a file's name: coloured Text beside the button, since a button's label takes no colour. A deleted file's Tag is struck, since the app drops a line through the name inside a button. */
function tagCells(els: ElementTable, r: Row) {
  const { Box, Text } = els
  const color = r.tag === null ? 'text' : (COLOR[r.tag] ?? GREY)
  return (
    <Box key={`tail:${r.path}`} flexShrink={0} gap={1}>
      {r.tag === null ? null : (
        <Text color={color} strikethrough={r.tag === 'Deleted'}>
          {r.tagWords}
        </Text>
      )}
      {r.isRecent ? <Text color={color}>●</Text> : null}
    </Box>
  )
}

/** The lines added and removed, in two four-cell columns at the row's trailing edge; a column is blank where its figure is zero or unknown. */
function countCells(els: ElementTable, r: Row) {
  const { Box, Text } = els
  const [added, removed] = countPair(r.counts)
  return (
    <Box key={`counts:${r.path}`} flexShrink={0} gap={1}>
      <Box width={Math.max(COUNT_CELLS, added.length)} flexShrink={0} justifyContent="flex-end">
        {added === '' ? null : <Text color="success">{added}</Text>}
      </Box>
      <Box width={Math.max(COUNT_CELLS, removed.length)} flexShrink={0} justifyContent="flex-end">
        {removed === '' ? null : <Text color="error">{removed}</Text>}
      </Box>
    </Box>
  )
}

/**
 * A file row: the marker, the name as the only clickable part, the Tag, the dot. The desktop app drops colour on
 * anything inside a Button, so the Tag and the dot sit beside it as coloured Text. A Button's label can only be dimmed.
 */
function fileRow($: EngineInterface, els: ElementTable, selectedPath: string | null, look: Look, r: Row) {
  const { Box, Button } = els
  const icon = typeIconOf(r.name)
  const Svg = svgOf(els, look)
  const isSelected = r.abs === selectedPath
  return (
    <Box key={`row:${r.path}`} flexDirection="row" gap={1} {...fillOf(isSelected, look)}>
      {marker(els, isSelected && !look.isDesktop)}
      <Box key={`chevron:${r.path}`} flexDirection="row" width={lineWidth(r) + 2} flexShrink={0}>
        {lineCells(els, look, r)}
      </Box>
      <Box key={`icon:${r.path}`} width={2} flexShrink={0}>
        {Svg !== null ? (
          <Svg source={iconSvg(icon)} alt={icon.alt} width={14} height={14} />
        ) : (
          <els.Text color={icon.color}>{icon.letters}</els.Text>
        )}
      </Box>
      <Box key={`name:${r.path}`} flexShrink={1}>
        <Button
          key={buttonKey(r)}
          plain
          dimColor={r.tag === 'Read'}
          onPress={() => (look.isApp ? pressAppFile($, r.abs) : clickFile($, r.abs))}
        >
          {nameText(els, look, r, isSelected)}
        </Button>
      </Box>
      {tagCells(els, r)}
      <Box flexGrow={1} />
      {countCells(els, r)}
    </Box>
  )
}

/** The Svg element, or null where this surface draws no pictures: the terminal's table offers one that draws nothing. */
const svgOf = (els: ElementTable, look: Look) =>
  look.isDesktop && 'Svg' in els && els.Svg !== undefined ? els.Svg : null

/** What a row's drawing depends on beyond the row: the pane's width in cells, whether the surface draws pictures, and whether the Files pane is in its App form (set by that pane's render only; a press there selects the row, with no File view). */
type Look = { columns: number; isDesktop: boolean; isMobile: boolean; isApp: boolean }

/** How a pane is drawn, for the Files pane and the Trail alike: its width, the surface it is on and whether that is the desktop app's App form. */
const lookOf = async ($: EngineInterface, surface: string, columns: number): Promise<Look> => ({
  columns,
  isDesktop: surface !== 'terminal',
  isMobile: surface === 'mobile',
  isApp: await isInApp($),
})

/**
 * The letters that press the panes' buttons in the terminal, each its own so that no two buttons drawn at once share
 * one.
 */
const HOTKEY = {
  changedOnly: 'c',
  trail: 't',
  back: 'b',
  whole: 'w',
  acting: 'a',
  reveal: 'r',
  claudeOnly: 'o',
} as const

/** The hotkey props of a button: its letter in the terminal; none on the desktop, which clicks, and where a prop left undefined makes the engine refuse the drawing. */
const hotkeyOf = (look: Look, button: keyof typeof HOTKEY) => (look.isDesktop ? {} : { hotkey: HOTKEY[button] })

/** The drawing of one row, by what it is. */
function rowView($: EngineInterface, els: ElementTable, selectedPath: string | null, look: Look, r: Row) {
  if (r.kind === 'group') return groupRow($, els, look, r)
  if (r.kind === 'dir') return dirRow($, els, selectedPath, look, r)
  return fileRow($, els, selectedPath, look, r)
}

/** What the view area holds for the shown file: its code, or a line saying why not. `room` is how many characters the file may take. */
function bodyOf(els: ElementTable, path: string, view: FileView, room: number) {
  const { Text, Code } = els
  if ('note' in view) return <Text color={GREY}>{view.note}</Text>
  if ('diff' in view && view.diff.length > room) return <Text color={GREY}>This change is too big to show here.</Text>
  if ('diff' in view) return <Code source={view.diff} path={path} format="diff" />
  if (view.text.length > room) return <Text color={GREY}>This file is too big to show here.</Text>
  return <Code source={view.text} path={path} startLine={1} />
}

/** The view area's box: the lines leading the view, where there are any, then its body. */
function viewBox(els: ElementTable, path: string, view: FileView, room: number) {
  const { Box, Text } = els
  return (
    <Box key="view" flexDirection="column">
      {(view.leads ?? []).map((lead) => (
        <Text key={lead} color={GREY}>
          {lead}
        </Text>
      ))}
      {bodyOf(els, path, view, room)}
    </Box>
  )
}

/** Whether the file shown is not the selected one as the records have it: a selection kept from before a reload of the mod has no file read for it yet, and a file touched again since has changed. */
const isShownStale = (path: string, touched: Record<string, RecordEntry>) =>
  shown?.path !== path || shown.order !== (touched[path]?.order ?? null)

/** The line for the Description of what the model was asked about: the sentence, the line standing in for it while its request is out, or null. */
async function descriptionOf($: EngineInterface, ask: DescribeInput | null): Promise<string | null> {
  if (ask === null) return null
  const key = keyOf(ask)
  const written = keptOf(await read($, descriptions)).find((d) => d.key === key)?.text
  return written ?? (pending.has(key) ? WRITING : null)
}

/** The Description already written for a file, for the App form's selected row; null where none is. It asks the model for none, and reads the file once per selection (the view area's own cache). */
async function writtenDescription($: EngineInterface, touched: Record<string, RecordEntry>, path: string) {
  if (isShownStale(path, touched)) shown = await showFile($, path, touched)
  const ask = shown?.ask
  if (ask == null) return null
  const key = keyOf(ask)
  return keptOf(await read($, descriptions)).find((d) => d.key === key)?.text ?? null
}

/** The view the Changes section draws: the whole file where it is on offer and switched on, else the changes. */
const sectionView = (changes: FileView, whole: FileView | null, isWhole: boolean): FileView =>
  isWhole && whole !== null ? whole : changes

/** Where to type a comment on a surface that draws no typing field. */
const NO_FIELD_NOTICE = 'Type comments in the desktop app or the terminal.'

/** The Comment box under the selected line: the one-line field, then `Send`, `Attach` and `Cancel`. The phone draws no field, so there it says where to type, beside `Cancel`. */
function commentBox($: EngineInterface, els: ElementTable, look: Look) {
  const { Box, Text, Button } = els
  const cancel = (
    <Button key={CANCEL_KEY} dimColor onPress={() => closeBox($)}>
      Cancel
    </Button>
  )
  if (look.isMobile || !('Input' in els) || els.Input === undefined) {
    return (
      <Box key="commentBox" flexDirection="column">
        <Text color={GREY}>{NO_FIELD_NOTICE}</Text>
        {cancel}
      </Box>
    )
  }
  return (
    <Box key="commentBox" flexDirection="column">
      <els.Input
        key={COMMENT_INPUT_KEY}
        placeholder="Comment on this line"
        onInput={(value) => {
          draft = value
        }}
        submitLabel="send"
        onSubmit={(value) => sendComment($, value)}
      />
      <Box key="commentButtons" flexDirection="row" gap={1}>
        <Button key={SEND_KEY} onPress={() => sendComment($, draft)}>
          Send
        </Button>
        <Button key={ATTACH_KEY} onPress={() => attachComment($, draft)}>
          Attach
        </Button>
        {cancel}
      </Box>
    </Box>
  )
}

/** The address of the Edit box's field and of its buttons. */
const EDIT_KEY = 'edit'
const EDIT_INPUT_KEY = 'edit-input'
const SAVE_KEY = 'save'
const ADD_KEY = 'add'
const DELETE_KEY = 'delete'

/** The Edit box under the selected line: the one-line field holding the line, then `Save`, `+`, `×` and `Cancel`. */
function editBoxView($: EngineInterface, els: ElementTable, original: string) {
  const { Box, Button } = els
  if (!('Input' in els) || els.Input === undefined) return null
  return (
    <Box key="editBox" flexDirection="column">
      <els.Input
        key={EDIT_INPUT_KEY}
        value={typed ?? original}
        onInput={(value) => {
          typed = value
        }}
        onSubmit={(value) => saveEdit($, value)}
      />
      <Box key="editButtons" flexDirection="row" gap={1}>
        <Button key={SAVE_KEY} onPress={() => saveEdit($, typed)}>
          Save
        </Button>
        <Button key={ADD_KEY} onPress={() => addLine($)}>
          +
        </Button>
        <Button key={DELETE_KEY} onPress={() => deleteLine($)}>
          ×
        </Button>
        <Button key={CANCEL_KEY} dimColor onPress={() => closeBox($)}>
          Cancel
        </Button>
      </Box>
    </Box>
  )
}

/** What is drawn under the selected line: its two buttons, or the box once `Comment` or `Edit` is pressed. */
function lineActions(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  under: { box: 'comment' | 'edit' | null; said: string | null; original: string },
) {
  const { Box, Text, Button } = els
  if (under.box === 'comment') return commentBox($, els, look)
  // The phone edits nothing, so an Edit box left in saved state draws as the line's own buttons.
  if (under.box === 'edit' && !look.isMobile) return editBoxView($, els, under.original)
  return (
    <Box key="lineActions" flexDirection="column">
      {under.said === null ? null : <Text color="error">{under.said}</Text>}
      <Box key="lineButtons" flexDirection="row" gap={1}>
        <Button key={COMMENT_KEY} onPress={() => openComment($)}>
          Comment
        </Button>
        {look.isMobile ? null : (
          <Button key={EDIT_KEY} onPress={() => openEdit($)}>
            Edit
          </Button>
        )}
      </Box>
    </Box>
  )
}

/** A grey row counting the lines the acting form leaves out above or below its window. */
function countRow(els: ElementTable, key: string, words: string) {
  const { Box, Text } = els
  return (
    <Box key={key}>
      <Text color={GREY}>{words}</Text>
    </Box>
  )
}

/** The acting form: the lines leading the view, then one plain button per line of the text, with the buttons for the selected line under it. `room` is how many characters the rows may take; the window gives up lines to fit it. */
function actingBox(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  form: {
    leads: string[]
    lines: string[]
    picked: number | null
    room: number
    box: 'comment' | 'edit' | null
    said: string | null
    original: string
  },
) {
  const { Box, Text, Button } = els
  const { leads, lines, picked } = form
  const width = String(lines.length).length
  const room = lineRoom(look.columns, width, look.isDesktop)
  const ideal = windowOf(lines.length, picked)
  const labels = lines.slice(ideal.from - 1, ideal.to).map((text, i) => lineLabel(ideal.from + i, width, text, room))
  const costs = labels.map((label) => drawnChars(label))
  const { from, to } = fitWindow(ideal, picked, costs, form.room - ACTING_SLACK)
  return (
    <Box key="view" flexDirection="column">
      {leads.map((lead) => (
        <Text key={lead} color={GREY}>
          {lead}
        </Text>
      ))}
      {from > 1 ? countRow(els, 'earlier', `+${from - 1} earlier lines`) : null}
      {labels.slice(from - ideal.from, to - ideal.from + 1).flatMap((label, i) => [
        <Button key={`line:${from + i}`} plain onPress={() => pickLine($, from + i)}>
          {label}
        </Button>,
        picked === from + i ? lineActions($, els, look, form) : null,
      ])}
      {to < lines.length ? countRow(els, 'more', `+${lines.length - to} more lines`) : null}
    </Box>
  )
}

/** The file the Changes section shows: its path, its view, and the whole-file text beside a diff. */
type SectionFile = { path: string; view: FileView; whole: FileView | null }

/** The box open under the selected line: a box belongs to its line alone, so one kept for another line reads as none. */
async function boxOf($: EngineInterface, picked: number | null): Promise<'comment' | 'edit' | null> {
  if (picked === null) return null
  if ((await read($, commentLine)) === picked) return 'comment'
  return editOf(await read($, editBox))?.line === picked ? 'edit' : null
}

/** The view area's box for a file, with what the acting form adds to the Changes section: whether it is on (null where the file has no text to act on) and the lines the `Line N` buttons name. */
async function sectionParts(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  file: SectionFile,
  isWhole: boolean,
  room: number,
) {
  const text = textOf(file.view, file.whole)
  const shownView = sectionView(file.view, file.whole, isWhole)
  const reading = viewBox(els, file.path, shownView, room)
  if (text === null) return { view: reading, acting: null, jumps: [] }
  if ((await read($, isActing)) !== true) {
    const jumps = 'diff' in shownView ? jumpsOf(shownView.diff, linesOf(text).length) : []
    return { view: reading, acting: false, jumps }
  }
  const picked = pickedLine(await read($, selectedLine))
  const box = await boxOf($, picked)
  const said = picked === null ? null : noticeOf(await read($, notice))
  const original = editOf(await read($, editBox))?.original ?? ''
  const form = { leads: file.view.leads ?? [], lines: linesOf(text), picked, room, box, said, original }
  return { view: actingBox($, els, look, form), acting: true, jumps: [] }
}

/** The selected file as the File view draws it: the view area's box, and the line for its Description. */
async function viewArea(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  touched: Record<string, RecordEntry>,
  selectedPath: string | null,
  reserved: number,
) {
  if (selectedPath !== null && isShownStale(selectedPath, touched)) shown = await showFile($, selectedPath, touched)
  const file = shown
  if (file?.view == null || file.path !== selectedPath) return null
  const description = await descriptionOf($, file.ask)
  const isWhole = (await read($, isWholeFile)) === true
  const room = MAX_DRAWN - SLACK - reserved - (description?.length ?? 0)
  const parts = await sectionParts($, els, look, { path: file.path, view: file.view, whole: file.whole }, isWhole, room)
  return { description, changes: hunksOf(file.view), whole: file.whole === null ? null : isWhole, ...parts }
}

/** The system the session runs on, found by running `uname -s` once per load of the mod; a run that fails or throws reads as Windows. */
let systemRun: ReturnType<typeof findSystem> | null = null

const findSystem = ($: EngineInterface) =>
  $.process.run(['uname', '-s'], { timeoutMs: 3000 }).then(systemOf, () => systemOf(null))

const systemOfSession = ($: EngineInterface) => (systemRun ??= findSystem($))

/** Whether the selected path is a folder: every file in the pane is in the records, and no folder is. */
const isFolderPath = (touched: Record<string, RecordEntry>, path: string) => touched[path] === undefined

/** The nearest folder above the path that is on disk; the top of the disk where none is. */
async function nearestFolder($: EngineInterface, path: string): Promise<string> {
  const parent = parentOf(path)
  return parent === path || (await $.fs.exists(parent)) ? parent : nearestFolder($, parent)
}

/** Opens the computer's file manager at the selected file or folder. */
async function revealSelected($: EngineInterface) {
  const saved = await read($, selected)
  if (saved === null) return
  const path = absoluteOf(await $.session.cwd(), saved)
  const system = await systemOfSession($)
  const isFolder = isFolderPath(withDefaults(await savedRecords($)), path)
  const stillExists = await $.fs.exists(path)
  const nearest = stillExists ? path : await nearestFolder($, path)
  const { argv } = reveal({ system, path, isFolder, stillExists, nearestFolder: nearest })
  // A program that cannot start rejects, and so does one that outruns its time: both read as a failure.
  const r = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => null)
  if (r?.exitCode !== 0) $.ui.toast(`Could not reveal ${path}`)
}

/** The notice for an Open in Files the app could not do. */
const OPEN_FILES_FAILED = 'Could not open this file in Files.'

/** Shows the selected file, at the selected line, in the desktop app's own Files pane. */
async function openInFiles($: EngineInterface) {
  const saved = await read($, selected)
  if (saved === null) return
  const path = absoluteOf(await $.session.cwd(), saved)
  // The line belongs to the acting form: one picked there stays in saved state when the form goes off, and is not sent.
  // The App form has no acting form, and one a terminal left behind sends no line from it.
  const isFormOn = !(await isInApp($)) && (await read($, isActing)) === true
  const line = isFormOn ? pickedLine(await read($, selectedLine)) : null
  // No selected line sends no line: the pane then opens where it opens, and a line of 1 would scroll it to the top.
  const args = line === null ? { pane: 'file', path } : { pane: 'file', path, line }
  // A server that is not connected rejects, and the app can answer that the call failed: both read as a failure.
  const r = await $.mcp.call('ccd_view', 'show_pane', args).catch(() => null)
  await update($, filesNotice, () => (r === null || r.isError ? OPEN_FILES_FAILED : null))
}

/** The Open rule for a file in the App form: git's status for the file alone decides between the App diff and the App file pane; a file that is gone with no record opens nothing and says so. `path` is absolute. */
async function openRule($: EngineInterface, path: string) {
  const cwd = await $.session.cwd()
  const r = await $.process.run(gitIn(cwd, 'status', '--porcelain', '--', path), { timeoutMs: 3000 }).catch(() => null)
  const answer = r !== null && r.exitCode === 0 ? r.stdout : null
  // A disk that cannot be asked reads as "the file is there": the git route then runs, and git alone can say it is gone.
  const exists = await $.fs.exists(path).catch(() => true)
  const opening = openingOf(answer, exists)
  if (opening === 'gone') return update($, filesNotice, () => goneNotice(path))
  const args = opening === 'diff' ? { pane: 'diff', path, diff_scope: 'uncommitted' } : { pane: 'file', path }
  const opened = await $.mcp.call('ccd_view', 'show_pane', args).catch(() => null)
  await update($, filesNotice, () => (opened === null || opened.isError ? OPEN_FILES_FAILED : null))
}

/** A press on a file row in the App form: the row is selected, its last notice goes, then the Open rule runs. `path` is absolute. */
async function pressAppFile($: EngineInterface, path: string) {
  await Promise.all([selectFile($, path), update($, filesNotice, () => null)])
  await openRule($, path)
}

/** The Reveal button for the selected file or folder, named for the system's file manager. */
async function revealRow($: EngineInterface, els: ElementTable, look: Look, selectedPath: string, isFolder: boolean) {
  const { Box, Text, Button } = els
  const system = await systemOfSession($)
  const { label } = reveal({ system, path: selectedPath, isFolder, stillExists: true, nearestFolder: selectedPath })
  // The terminal draws no pictures of the app; the phone never reaches this row, since it has no Reveal.
  const canOpenFiles = !isFolder && look.isDesktop
  const said = canOpenFiles ? noticeOf(await read($, filesNotice)) : null
  return (
    <Box key="revealRow" flexDirection="column">
      <Box key="revealButtons" flexDirection="row" gap={1}>
        <Button key={REVEAL_KEY} {...hotkeyOf(look, 'reveal')} onPress={() => revealSelected($)}>
          {label}
        </Button>
        {canOpenFiles ? (
          <Button key={OPEN_FILES_KEY} onPress={() => openInFiles($)}>
            Open in Files
          </Button>
        ) : null}
      </Box>
      {said === null ? null : (
        <Box key="filesNotice">
          <Text color={GREY}>{said}</Text>
        </Box>
      )}
    </Box>
  )
}

/** What the File view's header block shows of the open file. */
type OpenFile = {
  path: string
  entry: RecordEntry
  /** The folder the file sits in, as the pane names it: from `~` where it is under the home folder. */
  location: string
  description: string | null
}

/** The Type icon, then the name in bold, the Tag and the line counts. */
function fileTitle(els: ElementTable, look: Look, f: OpenFile) {
  const { Box, Text } = els
  const Svg = svgOf(els, look)
  const name = f.path.slice(f.path.lastIndexOf('/') + 1)
  const icon = typeIconOf(name)
  const counts = countsOf(f.path, f.entry)
  const [added, removed] = countPair(counts)
  return (
    <Box key="fileTitle" flexDirection="row" gap={1}>
      {Svg !== null ? (
        <Svg source={iconSvg(icon)} alt={icon.alt} width={14} height={14} />
      ) : (
        <Text color={icon.color}>{icon.letters}</Text>
      )}
      <Text bold>{name}</Text>
      <Text color={COLOR[f.entry.tag] ?? GREY} strikethrough={f.entry.tag === 'Deleted'}>
        {tagWords(f.entry)}
      </Text>
      {added === '' ? null : <Text color="success">{added}</Text>}
      {removed === '' ? null : <Text color="error">{removed}</Text>}
    </Box>
  )
}

/** The File view's header block, on the raised fill on the desktop: the title, the folder the file sits in, its Description and the Reveal button. */
function fileHeader(els: ElementTable, look: Look, f: OpenFile, reveal: JSX.Element | null) {
  const { Box, Text } = els
  const fill = look.isDesktop ? { backgroundColor: RAISED_FILL, padding: 1 } : {}
  return (
    <Box key="fileHeader" flexDirection="column" {...fill}>
      {fileTitle(els, look, f)}
      <Box key="fileLocation">
        <Text color={GREY} wrap="truncate-middle">
          {f.location}
        </Text>
      </Box>
      {f.description === null ? null : (
        <Box key="description">
          <Text color={f.description === WRITING ? GREY : 'text'}>{f.description}</Text>
        </Box>
      )}
      {reveal}
    </Box>
  )
}

/** The widths of the Touches table's fixed columns, in cells: `#`, `Action`, `Turn` and `Lines`. `By` takes the rest. */
const TOUCH_WIDTHS = { n: 5, action: 8, turn: 5, lines: 11 }

/** One cell of a Touches table row: a fixed width, or the rest of the row when `width` is null. */
function touchCell(els: ElementTable, width: number | null, cell: JSX.Element | null) {
  const { Box } = els
  return width === null ? (
    <Box flexGrow={1} flexShrink={1}>
      {cell}
    </Box>
  ) : (
    <Box width={width} flexShrink={0}>
      {cell}
    </Box>
  )
}

/** The lines a Touch added and removed as the Lines cell draws them: the figures in green and red; nothing where there are none or the mod could not tell. */
function linesCell(els: ElementTable, counts: TouchEntry['counts']) {
  const { Text } = els
  if (linesText(counts) === '') return null
  const [added, removed] = countPair(counts)
  return (
    <Text>
      {added === '' ? null : <Text color="success">{added}</Text>}
      {added !== '' && removed !== '' ? ' ' : null}
      {removed === '' ? null : <Text color="error">{removed}</Text>}
    </Text>
  )
}

/** The Touches table: a divider, the bold heading with its count, the column labels over a line, then a row for each Touch of the file. */
function touchesSection(els: ElementTable, look: Look, touches: TouchEntry[], helperNames: Helper[]) {
  const { Box, Text } = els
  const { shown, earlier } = touchRowsOf(touches)
  const w = TOUCH_WIDTHS
  const widths = [w.n, w.action, null, w.turn, w.lines]
  const labels = ['#', 'Action', 'By', 'Turn', 'Lines']
  return [
    divider(els, look, 'touches'),
    <Box key="touchesHeading" flexDirection="row" gap={1}>
      <Text bold>Touches</Text>
      <Text color={GREY}>{String(touches.length)}</Text>
    </Box>,
    <Box key="touchesColumns" flexDirection="row">
      {labels.map((label, i) => touchCell(els, widths[i] ?? null, <Text color={GREY}>{label}</Text>))}
    </Box>,
    divider(els, look, 'touchesColumns'),
    earlier === 0 ? null : (
      <Box key="touchesEarlier">
        <Text color={GREY}>{`+${earlier} earlier touches`}</Text>
      </Box>
    ),
    <Box key="touchRows" flexDirection="column">
      {shown.map((t) => (
        <Box key={`touch:${t.n}`} flexDirection="row">
          {touchCell(els, w.n, <Text color={GREY}>{String(t.n)}</Text>)}
          {touchCell(els, w.action, <Text color={COLOR[t.kind] ?? GREY}>{t.kind}</Text>)}
          {touchCell(els, null, <Text wrap="truncate-end">{byText(t.by, helperNames)}</Text>)}
          {touchCell(els, w.turn, <Text color={GREY}>{String(t.turn)}</Text>)}
          {touchCell(els, w.lines, linesCell(els, t.counts))}
        </Box>
      ))}
    </Box>,
  ]
}

/** The Changes section: a divider, the bold heading with its count, and the view of the changes. */
function changesSection(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  area: { changes: number; whole: boolean | null; acting: boolean | null; jumps: number[]; view: JSX.Element },
) {
  const { Box, Text, Button } = els
  return [
    divider(els, look, 'changes'),
    <Box key="changesHeading" flexDirection="row" gap={1}>
      <Text bold>Changes</Text>
      <Text color={GREY}>{String(area.changes)}</Text>
      {area.whole === null ? null : (
        <Button key={WHOLE_KEY} {...hotkeyOf(look, 'whole')} onPress={() => toggleWholeFile($)}>
          {area.whole ? 'Show changes' : 'Show whole file'}
        </Button>
      )}
      {area.acting === null ? null : (
        <Button key={ACTING_KEY} {...hotkeyOf(look, 'acting')} onPress={() => toggleActing($)}>
          {area.acting ? 'Read only' : 'Comment or edit'}
        </Button>
      )}
    </Box>,
    area.jumps.length === 0 ? null : (
      <Box key="jumps" flexDirection="row" gap={1}>
        <Text color={GREY}>Jump to</Text>
        {area.jumps.map((n) => (
          <Button key={`jump:${n}`} onPress={() => jumpToLine($, n)}>
            {`Line ${n}`}
          </Button>
        ))}
      </Box>
    ),
    area.view,
  ]
}

/** The top row: the counts at the near end, the toggle and the Trail button at the far end; where they do not fit side by side the buttons drop to a row of their own, whole, instead of the terminal breaking them letter by letter. The toggle names what it will do next, and waits for the first file. */
function barBox(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  touched: Record<string, RecordEntry>,
  isOnlyChanged: boolean,
) {
  const { Box, Button } = els
  return (
    <Box key="bar" justifyContent="space-between" flexWrap="wrap">
      {summaryText(els, summaryOf(touched))}
      <Box key="actions" gap={1} flexWrap="wrap">
        {Object.keys(touched).length === 0 ? null : (
          <Button key={CHANGED_ONLY_KEY} {...hotkeyOf(look, 'changedOnly')} onPress={() => toggleChangedOnly($)}>
            {isOnlyChanged ? 'All touched' : 'Changed only'}
          </Button>
        )}
        <Button key={TRAIL_KEY} {...hotkeyOf(look, 'trail')} onPress={() => openTrail($)}>
          Trail
        </Button>
      </Box>
    </Box>
  )
}

/** The line that ends the Group headed by `heading`: a picture one pixel tall on the desktop, a row of `─` in the terminal. */
function divider(els: ElementTable, look: Look, name: string) {
  const { Box, Text } = els
  const Svg = svgOf(els, look)
  if (Svg === null)
    return (
      <Box key={`divider:${name}`}>
        <Text color="subtle">{'─'.repeat(Math.max(look.columns, 1))}</Text>
      </Box>
    )
  return (
    <Box key={`divider:${name}`} flexDirection="column" alignItems="stretch" width="100%">
      <Svg source={dividerSvg()} alt="divider" height={1} />
    </Box>
  )
}

/** The tree of rows, then the "+N more files" row where the cap left files out. */
function treeBox(
  $: EngineInterface,
  els: ElementTable,
  selectedPath: string | null,
  look: Look,
  rows: Row[],
  hidden: number,
) {
  const { Box, Text } = els
  // Each Group ends on a divider: before the next Group's heading, and after the last row.
  let heading: Row | undefined
  const drawn = rows.flatMap((r) => {
    const ends = r.kind === 'group' && heading !== undefined ? [divider(els, look, heading.path)] : []
    if (r.kind === 'group') heading = r
    return [...ends, rowView($, els, selectedPath, look, r)]
  })
  return (
    <Box key="tree" flexDirection="column">
      {drawn}
      {heading === undefined ? null : divider(els, look, heading.path)}
      {hidden === 0 ? null : (
        <Box key="more">
          <Text color={GREY}>+{hidden} more files</Text>
        </Box>
      )}
    </Box>
  )
}

/** The rows of the touched files, with the folders and groups the person closed left out. */
async function treeOf(
  $: EngineInterface,
  touched: Record<string, RecordEntry>,
  cwd: string,
  home: string | null,
  maxFiles?: number,
) {
  return treeRowsOf(touched, {
    cwd,
    closed: await read($, closedFolders),
    closedGroups: await read($, closedGroups),
    worktrees: await knownWorktrees($),
    home,
    maxFiles,
  })
}

/** What the pane's body is drawn from. */
type Body = {
  els: ElementTable
  look: Look
  touched: Record<string, RecordEntry>
  selectedPath: string | null
  cwd: string
  home: string | null
  /** False on the phone: the file manager would open on the computer. */
  canReveal: boolean
  /** True where the tree stands beside the File view: the way back to the tree is not drawn. */
  isSplit: boolean
}

/** The body columns from which the pane draws the tree beside the File view; below it, one at a time. It follows the pane's width, never the surface. */
const WIDE_COLUMNS = 90

/** The width of the tree beside the File view, in columns. */
const TREE_COLUMNS = 40

/** The gap between the tree and the File view beside it, in columns. */
const SPLIT_GAP = 1

/** The characters kept back for the File view's header block besides the file's name, its location and its Description: the Tag, the counts, the buttons' labels and the Changes heading. */
const HEADER_SLACK = 200

/** The File view that takes the tree's place: `‹ All files`, the header block, then the Changes section; null where the selected file has nothing to show. */
async function fileBody(
  $: EngineInterface,
  { els, look, touched, selectedPath, home, canReveal, isSplit }: Body,
  beside = 0,
) {
  const { Box, Button } = els
  const entry = selectedPath === null ? undefined : touched[selectedPath]
  if (selectedPath === null || entry === undefined) return null
  const location = locationOf(parentOf(selectedPath), home)
  const touches = touchesOf(await readLog($), selectedPath)
  const helperNames = await read($, helpers)
  // The toolbar's divider, the Touches table's two and the Changes section's.
  const dividers = 4 * dividerChars(look.isDesktop, look.columns)
  const reserved = HEADER_SLACK + selectedPath.length + dividers + tableChars(touches, helperNames) + beside
  const area = await viewArea($, els, look, touched, selectedPath, reserved)
  if (area === null) return null
  const reveal = canReveal ? await revealRow($, els, look, selectedPath, false) : null
  const file = {
    path: selectedPath,
    entry,
    location,
    description: area.description,
  }
  return [
    isSplit ? null : (
      <Box key="backRow">
        <Button key={BACK_KEY} {...hotkeyOf(look, 'back')} onPress={() => closeFile($)}>
          ‹ All files
        </Button>
      </Box>
    ),
    fileHeader(els, look, file, reveal),
    ...touchesSection(els, look, touches, helperNames),
    ...changesSection($, els, look, area),
  ]
}

/** Whether the selection is a file the App form draws the buttons for: there, no File view holds them. */
const isAppFile = (look: Look, touched: Record<string, RecordEntry>, path: string | null): path is string =>
  look.isApp && path !== null && touched[path] !== undefined

/** The App form's selected file: the Reveal and Open in Files buttons, and the Description under them where one exists. */
async function appFileDetail(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  touched: Record<string, RecordEntry>,
  path: string,
  canReveal: boolean,
) {
  const { Box, Text } = els
  const reveal = canReveal ? await revealRow($, els, look, path, false) : null
  const description = await writtenDescription($, touched, path)
  return [
    reveal,
    description === null ? null : (
      <Box key="description">
        <Text color={GREY}>{description}</Text>
      </Box>
    ),
  ]
}

/** The tree of touched files, with the Reveal button and the path of a selected folder above it; in the App form, a selected file's buttons and Description too. */
async function treeBody(
  $: EngineInterface,
  { els, look, touched, selectedPath, cwd, home, canReveal }: Body,
  isOnlyChanged: boolean,
  maxFiles?: number,
) {
  const { Box, Text } = els
  const { rows, hidden } = await treeOf($, isOnlyChanged ? changedOf(touched) : touched, cwd, home, maxFiles)
  const isFolderShown = selectedPath !== null && isFolderPath(touched, selectedPath)
  const reveal = !canReveal || !isFolderShown ? null : await revealRow($, els, look, selectedPath, true)
  const detail = isAppFile(look, touched, selectedPath)
    ? await appFileDetail($, els, look, touched, selectedPath, canReveal)
    : []
  return [
    isFolderShown ? (
      <Box key="folderPath">
        <Text wrap="truncate-middle">
          {middleCut(shortPath(named(cwd, selectedPath), home), look.columns > 0 ? look.columns : Infinity)}
        </Text>
      </Box>
    ) : null,
    reveal,
    ...detail,
    emptyLine(els, Object.keys(touched).length, rows),
    treeBox($, els, selectedPath, look, rows, hidden),
  ]
}

/** The most characters of the drawing's limit the tree beside the File view may take: half, so that the File view keeps the other half. */
const TREE_BUDGET = MAX_DRAWN / 2

/** The tree for beside the File view: drawn whole, or, where it would pass TREE_BUDGET, with fewer files and a "+N more files" row. */
async function treeWithinBudget($: EngineInterface, body: Body, isOnlyChanged: boolean) {
  const look = { ...body.look, columns: TREE_COLUMNS }
  const touched = isOnlyChanged ? changedOf(body.touched) : body.touched
  let files = Math.min(MAX_FILES, Object.keys(touched).length)
  let tree = await treeBody($, { ...body, look }, isOnlyChanged)
  // The tree costs about the same per file, so the share of the files that fits is found by proportion; each round draws fewer.
  while (drawnChars(tree) > TREE_BUDGET && files > 0) {
    files = Math.min(files - 1, Math.floor((files * TREE_BUDGET) / drawnChars(tree)))
    tree = await treeBody($, { ...body, look }, isOnlyChanged, files)
  }
  return tree
}

/** The tree beside the File view, the tree 40 columns wide; null where the selected file has nothing to show. `barChars` is what the toolbar above already takes from the drawing's limit. */
async function splitView($: EngineInterface, body: Body, isOnlyChanged: boolean, barChars: number) {
  const { Box } = body.els
  const { look } = body
  const tree = await treeWithinBudget($, body, isOnlyChanged)
  // The tree draws beside the file, so what it takes from the drawing's limit the file may not.
  const fileLook = { ...look, columns: look.columns - TREE_COLUMNS - SPLIT_GAP }
  const file = await fileBody($, { ...body, look: fileLook }, drawnChars(tree) + barChars)
  if (file === null) return null
  return (
    <Box key="split" flexDirection="row" gap={SPLIT_GAP}>
      <Box key="treeColumn" flexDirection="column" width={TREE_COLUMNS} flexShrink={0} overflow="hidden">
        {tree}
      </Box>
      <Box key="fileColumn" flexDirection="column" flexGrow={1} flexShrink={1}>
        {file}
      </Box>
    </Box>
  )
}

/** What the pane draws under the toolbar: the tree and the File view side by side in a wide pane, else the File view where a file is open, else the tree. */
async function paneBody($: EngineInterface, body: Body, isOpened: boolean, isOnlyChanged: boolean, barChars: number) {
  const split = body.isSplit ? await splitView($, body, isOnlyChanged, barChars) : null
  if (split !== null) return split
  const opened = isOpened ? await fileBody($, { ...body, isSplit: false }) : null
  return opened ?? (await treeBody($, body, isOnlyChanged))
}

function paneHooks(on: On) {
  // A click while the pane had the keyboard sends its own press; Tab and the arrows move the ring only
  // inside a focused pane. So focus from the person onto a button of an unfocused pane is a click.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    const isClick = !isPaneFocused && e.origin.kind === 'person'
    const out = await next(e)
    // The ring moving off every element of the pane (Esc, or a click outside) closes the Comment box, which cannot keep the keys.
    if (e.element === undefined) await closeBox($)
    if (isClick) await pressByKey($, e.element)
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isPaneFocused = e.props.isFocused
    const els = $.ui.resolve(e)
    const { Box } = els
    const cwd = await $.session.cwd()
    const saved = await read($, selected)
    // A selection saved before groups existed is relative to the session's directory.
    const selectedPath = saved === null ? null : absoluteOf(cwd, saved)
    const touched = withDefaults(await savedRecords($))
    const home = (await $.env.get('HOME')) ?? null
    const look = await lookOf($, e.surface, e.props.bodyColumns)
    const { isApp } = look
    const isOnlyChanged = (await read($, isChangedOnly)) === true
    const canReveal = e.surface !== 'mobile'
    const isOpened =
      !isApp && selectedPath !== null && touched[selectedPath] !== undefined && (await read($, isFileOpen)) === true
    const isSplit = isOpened && look.columns >= WIDE_COLUMNS
    const body = { els, look, touched, selectedPath, cwd, home, canReveal, isSplit }
    const waiting = attachedOf(await read($, attached)).length
    const bar = [
      barBox($, els, look, touched, isOnlyChanged),
      divider(els, look, 'toolbar'),
      attachedRow($, els, waiting),
    ]
    return (
      <Box key="pane" flexDirection="column">
        {bar}
        {await paneBody($, body, isOpened, isOnlyChanged, drawnChars(bar))}
      </Box>
    )
  })
}

/** The header bar of a Turn: the chevron, the prompt's first line and the Touch count, on the raised fill on the desktop; in the terminal a row of characters. */
function turnHeader($: EngineInterface, els: ElementTable, look: Look, t: TrailTurn) {
  const { Box, Text, Button } = els
  const Svg = svgOf(els, look)
  const fill = look.isDesktop ? { backgroundColor: RAISED_FILL, paddingX: 1 } : {}
  return (
    <Box key={`turnHeader:${t.n}`} flexDirection="row" gap={1} {...fill}>
      <Box key={`chevron:${t.n}`} width={2} flexShrink={0}>
        {Svg === null ? (
          <Text color={GREY}>{t.isOpen ? '▾' : '▸'}</Text>
        ) : (
          <Svg source={chevronSvg(t.isOpen)} alt={t.isOpen ? 'chevron down' : 'chevron right'} width={14} height={14} />
        )}
      </Box>
      <Box key={`prompt:${t.n}`} flexGrow={1} flexShrink={1}>
        <Button key={turnKey(t.n)} plain onPress={() => toggleTurn($, t.n)}>
          <Text bold wrap="truncate-end">
            {t.text}
          </Text>
        </Button>
      </Box>
      <Text color={GREY}>{String(t.count)}</Text>
    </Box>
  )
}

/** The timeline's cell in a row: a small picture on the desktop, `├─` or `└─` in the terminal. The last row of a Turn ends the line. */
function timelineCell(els: ElementTable, look: Look, isLast: boolean) {
  const { Box, Text } = els
  const Svg = svgOf(els, look)
  const cell = isLast ? 'elbow' : 'tee'
  return (
    <Box width={2} flexShrink={0}>
      {Svg === null ? (
        <Text color="subtle">{LINE_LETTERS[cell]}</Text>
      ) : (
        <Svg source={lineSvg(cell)} alt={TIMELINE_ALT[cell]} width={14} height={LINE_HEIGHT} />
      )}
    </Box>
  )
}

/** A Touch's row on the timeline: its number, what was done and the file's name. */
function trailTouchRow(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  t: TouchEntry,
  isLast: boolean,
  picked: number | null,
) {
  const { Box, Text, Button } = els
  const isPicked = picked === t.n
  return (
    <Box key={`trailTouch:${t.n}`} flexDirection="row" gap={1} {...fillOf(isPicked, look)}>
      {timelineCell(els, look, isLast)}
      {look.isDesktop ? null : (
        <Box width={1} flexShrink={0}>
          {isPicked ? <Text color="suggestion">›</Text> : null}
        </Box>
      )}
      <Text color={GREY}>{String(t.n)}</Text>
      <Text color={COLOR[t.kind] ?? GREY}>{t.kind}</Text>
      <Button key={`trailFile:${t.n}`} plain onPress={() => pressTouch($, t, look.isApp)}>
        <Text wrap="truncate-middle" {...(isPicked && !look.isDesktop ? { bold: true } : {})}>
          {t.path.slice(t.path.lastIndexOf('/') + 1)}
        </Text>
      </Button>
    </Box>
  )
}

/** A command's row on the timeline: `Ran`, the command's first line, and how many files it changed. */
function trailRanRow(els: ElementTable, look: Look, key: string, r: RanEntry) {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="row" gap={1}>
      {timelineCell(els, look, false)}
      <Text bold>Ran</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{r.command}</Text>
      </Box>
      <Text color={GREY}>{String(r.files)}</Text>
    </Box>
  )
}

/** A folder's row on the timeline: the folder Claude moved to. */
function trailFolderRow(els: ElementTable, look: Look, key: string, label: string) {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="row" gap={1}>
      {timelineCell(els, look, false)}
      <Text color={GREY} wrap="truncate-middle">
        {label}
      </Text>
    </Box>
  )
}

/** The bold type, the description and the Touch count that head a helper's box. */
function helperHeader(els: ElementTable, key: string, box: HelperBox) {
  const { Box, Text } = els
  return (
    <Box key={`helperHeader:${key}`} flexDirection="row" gap={1}>
      <Text bold>{box.type}</Text>
      {box.description === '' ? null : (
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate-end">{box.description}</Text>
        </Box>
      )}
      <Text color={GREY}>{String(box.count)}</Text>
    </Box>
  )
}

/** One helper's Touches in one Turn: a rounded box headed by its type, description and count. It is the only bordered box in the Trail. */
function helperBox(
  $: EngineInterface,
  els: ElementTable,
  look: Look,
  turn: number,
  box: HelperBox,
  picked: number | null,
) {
  const { Box } = els
  const key = `${turn}:${box.id}`
  const drawn = (r: BoxRow, i: number) => {
    if (r.kind === 'folder') return trailFolderRow(els, look, `trailFolder:${key}:${i}`, r.label)
    if (r.kind === 'ran') return trailRanRow(els, look, `trailRan:${key}:${i}`, r.entry)
    return trailTouchRow($, els, look, r.entry, i === box.rows.length - 1, picked)
  }
  return (
    <Box key={`helperBox:${key}`} flexDirection="column" borderStyle="round" paddingX={1}>
      {helperHeader(els, key, box)}
      <Box key={`helperRows:${key}`} flexDirection="column">
        {box.rows.map(drawn)}
      </Box>
    </Box>
  )
}

/** The rows of a Turn on the timeline, oldest first. */
function turnRows($: EngineInterface, els: ElementTable, look: Look, t: TrailTurn, picked: number | null) {
  const { Box } = els
  const drawn = (r: TrailRow, i: number) => {
    if (r.kind === 'folder') return trailFolderRow(els, look, `trailFolder:${t.n}:${i}`, r.label)
    if (r.kind === 'ran') return trailRanRow(els, look, `trailRan:${t.n}:${i}`, r.entry)
    if (r.kind === 'helper') return helperBox($, els, look, t.n, r, picked)
    return trailTouchRow($, els, look, r.entry, i === t.rows.length - 1, picked)
  }
  return (
    <Box key={`turnRows:${t.n}`} flexDirection="column">
      {t.rows.map(drawn)}
    </Box>
  )
}

/** Whether the Trail had the keyboard at its last drawing; like the Files pane, it takes a first click on focusing it. */
let isTrailFocused = false

/** The address of a Turn's header button: `turn:` and the Turn's number. */
const turnKey = (n: number) => `turn:${n}`

/** Runs the action of the Trail button a first click on the unfocused Trail landed on, as its onPress would. */
async function pressTrailKey($: EngineInterface, key: string | undefined) {
  if (key === CLAUDE_ONLY_KEY) return toggleClaudeOnly($)
  const turn = /^turn:(\d+)$/.exec(key ?? '')
  if (turn?.[1] !== undefined) return toggleTurn($, Number(turn[1]))
  const file = /^trailFile:(\d+)$/.exec(key ?? '')
  const touch = (await readLog($)).find((x) => x.type === 'touch' && x.n === Number(file?.[1]))
  if (touch?.type === 'touch') return pressTouch($, touch, await isInApp($))
}

function trailHooks(on: On) {
  // A first click on an unfocused Trail sends no press; the focus lands on the button, which runs its action.
  on('ui.focus', { requestId: TRAIL_PANE }, async ($, e, next) => {
    const isClick = !isTrailFocused && e.origin.kind === 'person'
    const out = await next(e)
    if (isClick) await pressTrailKey($, e.element)
    return out
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: TRAIL_PANE }, async ($, e) => {
    isTrailFocused = e.props.isFocused
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const look = await lookOf($, e.surface, e.props.bodyColumns)
    const where = { cwd: await $.session.cwd(), home: (await $.env.get('HOME')) ?? null }
    const isOnlyClaude = (await read($, isClaudeOnly)) === true
    const picked = (await read($, trailSelected)) ?? null
    const trail = trailOf(await readLog($), await read($, turns), await read($, closedTurns), where, {
      helpers: await read($, helpers),
      isClaudeOnly: isOnlyClaude,
    })
    return (
      <Box key="trail" flexDirection="column">
        {trail.turns.length === 0 ? null : (
          <Box key="trailBar" justifyContent="flex-end">
            <Button key={CLAUDE_ONLY_KEY} {...hotkeyOf(look, 'claudeOnly')} onPress={() => toggleClaudeOnly($)}>
              {isOnlyClaude ? 'Show all' : 'Show Claude only'}
            </Button>
          </Box>
        )}
        <Box key="turns" flexDirection="column">
          {trail.turns.map((t) => (
            <Box key={`turnGroup:${t.n}`} flexDirection="column">
              {turnHeader($, els, look, t)}
              {t.earlier === 0 ? null : (
                <Box key={`turnEarlier:${t.n}`}>
                  <Text color={GREY}>{`+${t.earlier} earlier touches`}</Text>
                </Box>
              )}
              {t.isOpen ? turnRows($, els, look, t, picked) : null}
            </Box>
          ))}
        </Box>
        {trail.turns.length > 0 ? null : (
          <Box key="empty">
            <Text color={GREY}>No Turns yet. A Turn appears here when Claude touches a file.</Text>
          </Box>
        )}
        {trail.older === 0 ? null : (
          <Box key="olderTurns">
            <Text color={GREY}>{`+${trail.older} earlier turns`}</Text>
          </Box>
        )}
      </Box>
    )
  })
}

export const register = (on: On): void => {
  // Shared events, behind the empty matcher: see the entry file.
  on('session.start', {}, sessionStart).catch(($, e, next) => next(e))
  on('prompt.submit', {}, promptSubmit).catch(($, e, next) => next(e))
  on('agent.spawn', {}, agentSpawn).catch(($, e, next) => next(e))
  sessionHooks(on)
  toolHooks(on)
  commandHooks(on)
  closeHooks(on)
  paneHooks(on)
  trailHooks(on)
}
