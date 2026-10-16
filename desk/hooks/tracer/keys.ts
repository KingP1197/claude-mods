// The addresses of the tracer's buttons: each drawn button's key, and the press a key names back.

/** The Files pane's buttons that are not rows or lines; each one's key is its name. */
export const FILES_BUTTONS = [
  'reveal',
  'openFiles',
  'changed-only',
  'show-trail',
  'whole',
  'acting',
  'comment',
  'send',
  'attach',
  'edit',
  'save',
  'add',
  'delete',
  'cancel',
  'discard',
  'back',
] as const

/** One of the Files pane's named buttons. */
export type FilesButton = (typeof FILES_BUTTONS)[number]

/** A press on the Files pane, as its button's key names it: a named button, a line row or `Line N` button, or a tree row (`path` as the row names it). */
export type FilesPress =
  | { kind: 'button'; name: FilesButton }
  | { kind: 'line'; n: number }
  | { kind: 'jump'; n: number }
  | { kind: 'group' | 'dir' | 'file'; path: string }

const isFilesButton = (key: string): key is FilesButton => (FILES_BUTTONS as readonly string[]).includes(key)

/** The press a Files pane key names; null for a key that is none of the pane's buttons. */
export function filesPressOf(key: string | undefined): FilesPress | null {
  if (key === undefined) return null
  if (isFilesButton(key)) return { kind: 'button', name: key }
  const line = /^(line|jump):(\d+)$/.exec(key)
  if (line !== null) return { kind: line[1] === 'jump' ? 'jump' : 'line', n: Number(line[2]) }
  const row = /^(group|dir|file):(.+)$/s.exec(key)
  if (row === null) return null
  return { kind: row[1] === 'group' ? 'group' : row[1] === 'dir' ? 'dir' : 'file', path: row[2] ?? '' }
}

/** The key of the Files pane button that makes a press. A named button's key is typed as its name, so a table of every named button can be keyed by these. */
export function filesKey<N extends FilesButton>(press: { kind: 'button'; name: N }): N
export function filesKey(press: FilesPress): string
export function filesKey(press: FilesPress): string {
  if (press.kind === 'button') return press.name
  if (press.kind === 'line' || press.kind === 'jump') return `${press.kind}:${press.n}`
  return `${press.kind}:${press.path}`
}

/** A press on the Trail: the `Show Claude only` toggle, a Turn's header, or a Touch, by their numbers. */
export type TrailPress = { kind: 'claudeOnly' } | { kind: 'turn' | 'trailFile'; n: number }

/** The press a Trail key names; null for a key that is none of the Trail's buttons. */
export function trailPressOf(key: string | undefined): TrailPress | null {
  if (key === 'claude-only') return { kind: 'claudeOnly' }
  const found = /^(turn|trailFile):(\d+)$/.exec(key ?? '')
  return found === null ? null : { kind: found[1] === 'turn' ? 'turn' : 'trailFile', n: Number(found[2]) }
}

/** The key of the Trail button that makes a press. */
export const trailKey = (press: TrailPress): string =>
  press.kind === 'claudeOnly' ? 'claude-only' : `${press.kind}:${press.n}`
