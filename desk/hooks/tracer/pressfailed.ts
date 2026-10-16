// What a press was doing, from the key it came from: the action a failure toast names.
import { filesPressOf, trailPressOf, type FilesButton, type FilesPress, type TrailPress } from './keys'

/** What each named Files pane button does, in words that follow "Could not". */
const BUTTON_DOING: Record<FilesButton, string> = {
  reveal: 'reveal the file',
  openFiles: 'open the file in Files',
  'changed-only': 'switch the changed-only filter',
  'show-trail': 'open the Trail',
  whole: 'switch between the changes and the whole file',
  acting: 'switch the editing form',
  comment: 'open the comment box',
  send: 'send the comment',
  attach: 'attach the comment',
  edit: 'open the edit box',
  save: 'save the edit',
  add: 'add a line',
  delete: 'delete the line',
  cancel: 'close the box',
  discard: 'discard the comments',
  back: 'go back to the tree',
}

/** The words for a press that names no action of the tracer's. */
const NO_PRESS = 'finish that press in the file tracer'

/** What a press on the Files pane does. */
function filesDoing(press: FilesPress): string {
  if (press.kind === 'button') return BUTTON_DOING[press.name]
  if (press.kind === 'line') return 'select that line'
  if (press.kind === 'jump') return 'jump to that line'
  if (press.kind === 'group') return 'open or close the group'
  return press.kind === 'dir' ? 'open or close the folder' : 'open the file'
}

/** What a press on the Trail does. */
function trailDoing(press: TrailPress): string {
  if (press.kind === 'claudeOnly') return 'switch the Claude-only filter'
  return press.kind === 'turn' ? 'open or close the turn' : 'open that file from the Trail'
}

/** The words that follow "Could not" in the toast for a press that failed: what the press was doing, from its key. A missing key and a key that is none of the tracer's get the neutral words. */
export function pressAction(key: string | undefined): string {
  if (key === undefined) return NO_PRESS
  const files = filesPressOf(key)
  if (files !== null) return filesDoing(files)
  const trail = trailPressOf(key)
  return trail === null ? NO_PRESS : trailDoing(trail)
}
