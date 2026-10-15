/** Lines of unchanged text kept on each side of a change. */
const CONTEXT = 3

/** The lines of a text, each with its line break; the last has none where the text does not end in one. */
const linesOf = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+/g) ?? []

/** The most steps from each end the search for a middle takes. Two texts further apart than twice this come out as the lines of one removed and the lines of the other added: not the shortest edit, but quick. */
const MAX_SEARCH = 2500

/** Which lines of each text the shortest edit script drops (`removed`, of the before text) and adds (`added`, of the after text). */
type Marks = { removed: Uint8Array; added: Uint8Array }

/** One walk of the search, from one end of the two ranges: where each diagonal got furthest (`-1` for one not reached), and how many diagonals at each edge it has run off. */
type Walk = { reach: Int32Array; skipFrom: number; skipTo: number }

const newWalk = (size: number): Walk => ({ reach: new Int32Array(size).fill(-1), skipFrom: 0, skipTo: 0 })

/** Whether the lines `x` and `y` steps in from the walk's end are the same. */
type Same = (x: number, y: number) => boolean

/** A point `[x, y]` where the two walks meet, or null; asked of the walk that moves second in each round. */
type Meet = (k: number, x: number, y: number) => readonly [number, number] | null

/** Where diagonal `k` starts in round `d`: below the diagonal beside it that got further, else beside the other. */
function startOf(reach: Int32Array, at: number, d: number, k: number): number {
  const isDown = k === -d || (k !== d && reach[at - 1]! < reach[at + 1]!)
  return isDown ? reach[at + 1]! : reach[at - 1]! + 1
}

/** The point a diagonal ends at after sliding along the lines both texts share. */
function slide(x: number, y: number, n: number, m: number, same: Same): readonly [number, number] {
  let [px, py] = [x, y]
  while (px < n && py < m && same(px, py)) {
    px += 1
    py += 1
  }
  return [px, py]
}

/** One round of one walk across its diagonals; the point where it meets the other walk, or null. */
function sweep(walk: Walk, d: number, size: { n: number; m: number; offset: number }, same: Same, meet: Meet | null) {
  for (let k = -d + walk.skipFrom; k <= d - walk.skipTo; k += 2) {
    const at = size.offset + k
    const x0 = startOf(walk.reach, at, d, k)
    const [x, y] = slide(x0, x0 - k, size.n, size.m, same)
    walk.reach[at] = x
    if (x > size.n) walk.skipTo += 2
    else if (y > size.m) walk.skipFrom += 2
    else {
      const found = meet?.(k, x, y) ?? null
      if (found !== null) return found
    }
  }
  return null
}

/**
 * The middle of the shortest edit script between `a[aLo, aHi)` and `b[bLo, bHi)`: a point `[x, y]` (relative to the
 * ranges' starts) the script passes through, found by walking from both ends until the two walks meet (Myers 1986, the
 * linear-space form). Null when the two ranges share nothing, or the walks do not meet within MAX_SEARCH steps.
 */
function middleOf(a: number[], aLo: number, aHi: number, b: number[], bLo: number, bHi: number) {
  const [n, m] = [aHi - aLo, bHi - bLo]
  const max = Math.min(Math.ceil((n + m) / 2), MAX_SEARCH)
  const size = { n, m, offset: max }
  const [forward, backward] = [newWalk(2 * max + 2), newWalk(2 * max + 2)]
  forward.reach[max + 1] = 0
  backward.reach[max + 1] = 0
  const delta = n - m
  // With an odd difference in length the walks meet while the forward one moves; with an even one, the backward one.
  const isForwardMeet = delta % 2 !== 0
  const reached = (walk: Walk, k: number) => {
    const other = max + delta - k
    return other >= 0 && other < walk.reach.length && walk.reach[other] !== -1 ? other : null
  }
  const meetForward: Meet = (k, x, y) => {
    const other = reached(backward, k)
    return other !== null && x >= n - backward.reach[other]! ? [x, y] : null
  }
  const meetBackward: Meet = (k, x) => {
    const other = reached(forward, k)
    const fx = other === null ? 0 : forward.reach[other]!
    return other !== null && fx >= n - x ? [fx, fx - (other - max)] : null
  }
  for (let d = 0; d < max; d += 1) {
    const front = sweep(forward, d, size, (x, y) => a[aLo + x] === b[bLo + y], isForwardMeet ? meetForward : null)
    if (front !== null) return front
    const back = sweep(
      backward,
      d,
      size,
      (x, y) => a[aHi - 1 - x] === b[bHi - 1 - y],
      isForwardMeet ? null : meetBackward,
    )
    if (back !== null) return back
  }
  return null
}

/** Marks the lines of `a[aLo, aHi)` and `b[bLo, bHi)` that the shortest edit script between them drops and adds. */
function mark(a: number[], b: number[], ranges: [number, number, number, number], marks: Marks) {
  let [aLo, aHi, bLo, bHi] = ranges
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    aLo += 1
    bLo += 1
  }
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
    aHi -= 1
    bHi -= 1
  }
  const middle = aLo < aHi && bLo < bHi ? middleOf(a, aLo, aHi, b, bLo, bHi) : null
  if (middle === null) {
    marks.removed.fill(1, aLo, aHi)
    marks.added.fill(1, bLo, bHi)
    return
  }
  mark(a, b, [aLo, aLo + middle[0], bLo, bLo + middle[1]], marks)
  mark(a, b, [aLo + middle[0], aHi, bLo + middle[1], bHi], marks)
}

/** One line of the diff, with its line break: ' ' for unchanged, '-' for removed, '+' for added. */
type Op = { sign: ' ' | '-' | '+'; text: string }

/** The two texts' lines in one run, each marked unchanged, removed or added. */
function opsOf(before: string[], after: string[], marks: Marks): Op[] {
  const ops: Op[] = []
  let [i, j] = [0, 0]
  while (i < before.length || j < after.length) {
    if (i < before.length && marks.removed[i] === 1) ops.push({ sign: '-', text: before[i++]! })
    else if (j < after.length && marks.added[j] === 1) ops.push({ sign: '+', text: after[j++]! })
    else {
      ops.push({ sign: ' ', text: before[i]! })
      i += 1
      j += 1
    }
  }
  return ops
}

/** The ranges of ops [from, to) that hold a change and its context, one per hunk; ranges that touch are one. */
function hunkRanges(ops: Op[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  ops.forEach((op, i) => {
    if (op.sign === ' ') return
    const [from, to] = [Math.max(0, i - CONTEXT), Math.min(ops.length, i + CONTEXT + 1)]
    const last = ranges.at(-1)
    if (last !== undefined && from <= last[1]) last[1] = to
    else ranges.push([from, to])
  })
  return ranges
}

/** The line as the diff shows it: its sign and text, then a mark where the text has no final line break. */
const drawn = (op: Op): string[] =>
  op.text.endsWith('\n') ? [op.sign + op.text.slice(0, -1)] : [op.sign + op.text, '\\ No newline at end of file']

/** The unified diff from `before` to `after`: hunks with 3 lines of context, empty where the texts match. */
export function unifiedDiff(before: string, after: string): string {
  const [oldLines, newLines] = [linesOf(before), linesOf(after)]
  const ids = new Map<string, number>()
  const idOf = (line: string) => ids.get(line) ?? (ids.set(line, ids.size), ids.size - 1)
  const marks = { removed: new Uint8Array(oldLines.length), added: new Uint8Array(newLines.length) }
  mark(oldLines.map(idOf), newLines.map(idOf), [0, oldLines.length, 0, newLines.length], marks)
  const ops = opsOf(oldLines, newLines, marks)
  return hunkRanges(ops)
    .map(([from, to]) => {
      const [kept, shown] = [ops.slice(0, from), ops.slice(from, to)]
      const oldBefore = kept.filter((op) => op.sign !== '+').length
      const newBefore = kept.filter((op) => op.sign !== '-').length
      const oldCount = shown.filter((op) => op.sign !== '+').length
      const newCount = shown.filter((op) => op.sign !== '-').length
      const [oldStart, newStart] = [oldBefore + (oldCount === 0 ? 0 : 1), newBefore + (newCount === 0 ? 0 : 1)]
      return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...shown.flatMap(drawn), ''].join('\n')
    })
    .join('')
}
