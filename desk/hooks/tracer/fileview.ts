// The File view value: what the Files pane shows, as one saved value, and the moves from one value to the next. Plain logic; the reads and writes are in register.tsx.
import type { Acting, FileViewValue, LineBox } from '../../types'
import { pickedLine } from './acting'
import { noticeOf } from './edit'

/** The acting form with a line selected. */
type OnLine = Extract<Acting, { line: number }>

/** No line selected, so no box and no notice. */
const NO_LINE: Acting = { line: null, box: null, notice: null }

/** A click on a file row: its File view opens fresh. */
export const fileOpened = (): FileViewValue => ({ kind: 'file', whole: false, isActing: false, acting: NO_LINE })

/** `‹ All files`: the tree comes back with the same row selected. */
export const fileClosed = (): FileViewValue => ({ kind: 'tree' })

/** `Show whole file` and back: flips the Changes section between the diff and the whole file. */
export const wholeFlipped = (view: FileViewValue): FileViewValue =>
  view.kind === 'file' ? { ...view, whole: !view.whole } : view

/** The acting form of the view; null where the tree shows or the acting form is off. */
export const actingIn = (view: FileViewValue): Acting | null =>
  view.kind === 'file' && view.isActing ? view.acting : null

/** `Comment or edit` and `Read only`: the whole-file text becomes the acting form and back. The selected line and its box stay while the form is off, and come back with it. */
export const actingFlipped = (view: FileViewValue): FileViewValue =>
  view.kind === 'file' ? { ...view, isActing: !view.isActing } : view

/** The view moved by `move` where the acting form is on and has a line selected; unchanged otherwise. Nothing moves the acting form while it is off. */
function movedOnLine(view: FileViewValue, move: (acting: OnLine) => Acting): FileViewValue {
  if (view.kind !== 'file' || !view.isActing || view.acting.line === null) return view
  return { ...view, acting: move(view.acting) }
}

/** A press on a line of the acting form: the line is selected, with `Comment` and `Edit` under it. A box open on another line closes; one open on this line stays. */
export function linePicked(view: FileViewValue, n: number): FileViewValue {
  if (view.kind !== 'file' || !view.isActing) return view
  if (view.acting.line === n && view.acting.box !== null) return view
  return { ...view, acting: { line: n, box: null, notice: null } }
}

/** A press on a `Line N` button under Changes: the acting form comes on with that line selected. */
export const jumpedToLine = (view: FileViewValue, n: number): FileViewValue =>
  linePicked(view.kind === 'file' ? { ...view, isActing: true } : view, n)

/** `Comment`: the Comment box opens under the selected line, in place of any other box. */
export const commentOpened = (view: FileViewValue): FileViewValue => withBox(view, { kind: 'comment' })

/** The view with `box` under the selected line in place of any other; unchanged where no line is selected. */
const withBox = (view: FileViewValue, box: LineBox): FileViewValue =>
  movedOnLine(view, (acting) => ({ ...acting, box, notice: null }))

/** `Edit`: the Edit box opens under the selected line holding `original`, the line's text, in place of any other box. */
export const editOpened = (view: FileViewValue, original: string): FileViewValue =>
  withBox(view, { kind: 'edit', original })

/** `Cancel`, `Send`, `Attach`, a Save that changed nothing, and the keyboard leaving the pane: the box and the notice go, the line stays selected. */
export const boxClosed = (view: FileViewValue): FileViewValue =>
  movedOnLine(view, (acting) => ({ ...acting, box: null, notice: null }))

/** A Save, `+` or `×` the file refused, or found stale: the box closes and `notice` says why under the line. */
export const saveRefused = (view: FileViewValue, notice: string): FileViewValue =>
  movedOnLine(view, (acting) => ({ ...acting, box: null, notice }))

/** `+` written: the blank line after the selected one is selected, with an empty Edit box open on it. */
export const lineAdded = (view: FileViewValue): FileViewValue =>
  movedOnLine(view, (acting) => ({ line: acting.line + 1, box: { kind: 'edit', original: '' }, notice: null }))

/** `×` written: the box closes; the file now has `total` lines. With the last line gone the one above it is selected, so Comment and Edit keep a line to draw under. */
export const lineDeleted = (view: FileViewValue, total: number): FileViewValue =>
  movedOnLine(view, (acting) => {
    if (total < 1) return NO_LINE
    return { line: Math.min(acting.line, total), box: null, notice: null }
  })

/** The File view as saved state holds it. Saved state can hold anything: a value that is not this shape reads as the tree, and a part of it that is not reads as its default. */
export function fileViewOf(value: unknown): FileViewValue {
  const own = recordOf(value)
  if (own?.kind !== 'file') return { kind: 'tree' }
  return { kind: 'file', whole: own.whole === true, isActing: own.isActing === true, acting: savedActingOf(own.acting) }
}

/** The acting form as saved state holds it: no line where it is not an object; a box or a notice without a selected line reads as none. */
function savedActingOf(value: unknown): Acting {
  const own = recordOf(value)
  const line = own === null ? null : pickedLine(own.line)
  return own === null || line === null ? NO_LINE : { line, box: savedBoxOf(own.box), notice: noticeOf(own.notice) }
}

/** The box as saved state holds it; anything but a Comment box or an Edit box holding text reads as none. */
function savedBoxOf(value: unknown): LineBox | null {
  const own = recordOf(value)
  if (own?.kind === 'comment') return { kind: 'comment' }
  return own?.kind === 'edit' && typeof own.original === 'string' ? { kind: 'edit', original: own.original } : null
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
