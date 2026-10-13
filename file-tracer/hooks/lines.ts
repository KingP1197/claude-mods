import { DIVIDER, GUIDE } from './colours'

/** One cell of the tree lines in a row, one per level: a branch with more below it, the last branch, a line passing by, or nothing. */
export type LineCell = 'tee' | 'elbow' | 'pipe' | 'blank'

/** Where a level of rows sits among the tree lines: the cells that pass by on the way in from the left, and whether the level is joined to a folder above it (the first level of the project's tree is not). */
export type Hang = { passing: LineCell[]; isJoined: boolean }

/** The cells of the child that is `isLast` of its level or not, and the hang of the rows under it. */
export function hangUnder(hang: Hang, isLast: boolean): { lines: LineCell[]; below: Hang } {
  if (!hang.isJoined) return { lines: [], below: { passing: [], isJoined: true } }
  return {
    lines: [...hang.passing, isLast ? 'elbow' : 'tee'],
    below: { passing: [...hang.passing, isLast ? 'blank' : 'pipe'], isJoined: true },
  }
}

/** The words the desktop's picture of a cell says. Short, since a drawing holds at most 100,000 characters and every row spends them. */
export const LINE_ALT: Record<Exclude<LineCell, 'blank'>, string> = {
  tee: 'tree branch',
  elbow: 'tree end',
  pipe: 'tree line',
}

/** The characters a cell takes in the terminal, two cells wide. */
export const LINE_LETTERS: Record<LineCell, string> = { tee: '├─', elbow: '└─', pipe: '│ ', blank: '  ' }

/** The row height the pictures span, so a line meets the one in the row above and below. */
export const LINE_HEIGHT = 20

/** The picture of a cell for the desktop: a line from the top edge of the row to the bottom (the whole row for a branch or a passing line, half of it for the last), and an arm to the right for a branch. */
export function lineSvg(cell: Exclude<LineCell, 'blank'>): string {
  const mid = LINE_HEIGHT / 2
  const bottom = cell === 'elbow' ? mid : LINE_HEIGHT
  const arm = cell === 'pipe' ? '' : `M7 ${mid}H14`
  const d = `M7 0V${bottom}${arm}`
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="${LINE_HEIGHT}" viewBox="0 0 14 ${LINE_HEIGHT}">`
  return `${open}<path d="${d}" fill="none" stroke="${GUIDE}" stroke-width="1"/></svg>`
}

/** The picture of a divider for the desktop: one pixel tall, stretched across its row (the width is the whole of the Box it sits in). */
export const dividerSvg = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="1" viewBox="0 0 1 1" preserveAspectRatio="none" style="display:block"><rect width="1" height="1" fill="${DIVIDER}"/></svg>`
