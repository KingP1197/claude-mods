import type { Tag, RecordEntry } from '../types'
import { unifiedDiff } from './diff'
import { tagWords } from './record'
import { shortPath } from './paths'
import { linkedRoots } from './worktrees'
import { hangUnder, type Hang, type LineCell } from './lines'

/** One line of the drawn tree. `path` is relative to the session's directory for a project row, and absolute for a row of a group. */
export type Row = {
  path: string
  /** Where the file or folder is on disk, absolute; '' for a group header. */
  abs: string
  name: string
  depth: number
  /** A file, a folder, or the header of a group of files that are not the project's own. */
  kind: 'file' | 'dir' | 'group'
  /** A folder or group whose files show; always true for a file row. */
  isOpen: boolean
  tag: Tag | null
  /** The words the Tag is drawn with: the Tag, or `Edited by you` where the user made the latest edit; null on a row with no Tag. */
  tagWords: string | null
  isRecent: boolean
  /** The lines the file gained and lost, or null where the record cannot tell (a file only read, or one whose text before or after is unknown). */
  counts: LineCounts | null
  /** True when `name` is a whole path (a file outside the project), which the pane cuts in the middle when it runs out of room. */
  isPath: boolean
  /** The tree lines before the row's chevron, one cell per level it sits below. */
  lines: LineCell[]
  /** The files a group holds; 0 on any other row. */
  count: number
  /** Where a group's files are on disk, from `~/` where it sits under the home folder; '' on any other row, and where a group's files share only the root. */
  place: string
}

/** The lines a file gained and lost. */
export type LineCounts = { added: number; removed: number }

/** Counts already worked out, by the record's path, its touch count and the texts' lengths, so a redraw diffs nothing again. */
const counted = new Map<string, LineCounts | null>()

/** The most counts kept before the memory starts over. */
const MAX_COUNTED = 2000

/** The lines of `after` against `before`, from the diff between them. */
export function diffCounts(before: string, after: string): LineCounts {
  const lines = unifiedDiff(before, after).split('\n')
  return {
    added: lines.filter((l) => l.startsWith('+')).length,
    removed: lines.filter((l) => l.startsWith('-')).length,
  }
}

/** The text a record's file had before the session and the latest text the mod saw of it, or null where either is unknown. A created file had no text before it, a deleted one has none now, and a text equal to the baseline is not kept as last seen. */
function textsOf(e: RecordEntry): [string, string] | null {
  if (e.tag === 'Read') return null
  if (e.tag === 'Deleted') {
    const last = e.lastSeen ?? e.baseline
    return last === null ? null : [last, '']
  }
  const before = e.tag === 'Created' ? (e.baseline ?? '') : e.baseline
  const after = e.lastSeen ?? e.baseline
  return before === null || after === null ? null : [before, after]
}

/**
 * The lines a record's file gained and lost over the session: its text before the first change against the latest text
 * the mod saw. A file only read has none, nor one whose text before or after is unknown; a changed file with none seen
 * has gained and lost nothing.
 */
export function countsOf(path: string, e: RecordEntry): LineCounts | null {
  const key = `${path}\0${e.order}\0${e.tag}\0${e.baseline?.length ?? -1}\0${e.lastSeen?.length ?? -1}`
  const known = counted.get(key)
  if (known !== undefined) return known
  const texts = textsOf(e)
  const result = texts === null ? null : diffCounts(...texts)
  if (counted.size >= MAX_COUNTED) counted.clear()
  counted.set(key, result)
  return result
}

/** The path relative to the directory, or null when it lies outside. */
function relativeTo(cwd: string, path: string): string | null {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return path.startsWith(base) ? path.slice(base.length) : null
}

type Node = { name: string; path: string; kids: Map<string, Node> }

function insert(root: Node, path: string) {
  let at = root
  let walked = ''
  for (const part of path.split('/')) {
    walked = walked === '' ? part : `${walked}/${part}`
    const next = at.kids.get(part) ?? { name: part, path: walked, kids: new Map<string, Node>() }
    at.kids.set(part, next)
    at = next
  }
}

/** The folder a tree's paths are relative to: how its rows are named, and where it is on disk. */
type TreeRoot = { id: string; abs: string }

/** A directory's path without a closing slash. */
const withoutSlash = (dir: string) => (dir.endsWith('/') ? dir.slice(0, -1) : dir)

/** The absolute path of a row's path: the path of a worktree's or an outside row already is one, a project row's is relative to `cwd`. */
export const absoluteOf = (cwd: string, path: string): string =>
  path.startsWith('/') ? path : `${withoutSlash(cwd)}/${path}`

/** The folder a chain of folders ends on: a folder whose only child is one folder runs on into it; a folder holding files, or more than one folder, ends the chain. */
function chainEnd(node: Node): Node {
  const only = node.kids.size === 1 ? [...node.kids.values()][0] : undefined
  return only !== undefined && only.kids.size > 0 ? chainEnd(only) : node
}

/** A chain's name: its folders' names joined by `/`, from `first` to `last`. */
const nameOfChain = (first: Node, last: Node): string =>
  last.path === first.path ? first.name : `${first.name}/${last.path.slice(first.path.length + 1)}`

/** The folder rows and file rows of a tree. `where` names the folder its paths are relative to: `id` prefixes each row's path (so rows of different trees never share one; '' for the session's directory), `abs` is that folder on disk. */
function flatten(
  node: Node,
  depth: number,
  records: Map<string, RecordEntry>,
  closed: ReadonlySet<string>,
  where: TreeRoot,
  hang: Hang,
): Row[] {
  const kids = [...node.kids.values()].sort(
    (a, b) => Number(b.kids.size > 0) - Number(a.kids.size > 0) || a.name.localeCompare(b.name),
  )
  return kids.flatMap((first, i) => {
    const k = chainEnd(first)
    const isDir = k.kids.size > 0
    const path = where.id === '' ? k.path : `${where.id}/${k.path}`
    const isOpen = !closed.has(path)
    const { lines, below } = hangUnder(hang, i === kids.length - 1)
    const entry = records.get(k.path)
    const row: Row = {
      path,
      abs: `${where.abs}/${k.path}`,
      name: nameOfChain(first, k),
      depth,
      kind: isDir ? 'dir' : 'file',
      isOpen,
      tag: entry?.tag ?? null,
      tagWords: entry === undefined ? null : tagWords(entry),
      isRecent: entry?.isRecent ?? false,
      counts: entry === undefined ? null : countsOf(`${where.abs}/${k.path}`, entry),
      isPath: false,
      lines,
      count: 0,
      place: '',
    }
    return isOpen ? [row, ...flatten(k, depth + 1, records, closed, where, below)] : [row]
  })
}

/** What the pane draws: the rows, and how many touched files the cap left out. */
export type Tree = { rows: Row[]; hidden: number }

/** The address of a row's button, which a press or a focus names back. */
export const buttonKey = (row: Pick<Row, 'path' | 'kind'>): string => `${row.kind}:${row.path}`

/** The row a button address names, or null for an address that is none of the rows'. */
export function rowOfKey(key: string | undefined): Pick<Row, 'path' | 'kind'> | null {
  if (key?.startsWith('dir:') === true) return { path: key.slice(4), kind: 'dir' }
  if (key?.startsWith('file:') === true) return { path: key.slice(5), kind: 'file' }
  if (key?.startsWith('group:') === true) return { path: key.slice(6), kind: 'group' }
  return null
}

/** The most files the tree draws, so a drawing stays far below the engine's 100,000-character limit. */
export const MAX_FILES = 500

const group = (path: string, name: string, isOpen: boolean, count: number, place: string): Row => ({
  path,
  abs: '',
  name,
  depth: 0,
  kind: 'group',
  isOpen,
  tag: null,
  tagWords: null,
  isRecent: false,
  counts: null,
  isPath: false,
  lines: [],
  count,
  place,
})

/** The deepest folder that holds every one of the paths: '' where they share only the root. */
function sharedFolder(paths: readonly string[]): string {
  const folders = paths.map((p) => p.split('/').slice(0, -1))
  const first = folders[0] ?? []
  const length = first.findIndex((part, i) => !folders.every((f) => f[i] === part))
  return first.slice(0, length < 0 ? first.length : length).join('/')
}

/** The header of the group of touched files outside the project, and a row for each, named by its path from `~/` where it sits under the home folder, else whole. */
function outsideRows(files: Array<[string, RecordEntry]>, isOpen: boolean, home: string | null): Row[] {
  if (files.length === 0) return []
  const place = shortPath(sharedFolder(files.map(([path]) => path)), home)
  const header = group('outside', 'Outside this project', isOpen, files.length, place)
  if (!isOpen) return [header]
  const rows = files
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, e]): Row => ({
      path,
      abs: path,
      name: shortPath(path, home),
      depth: 1,
      kind: 'file',
      isOpen: true,
      tag: e.tag,
      tagWords: tagWords(e),
      isRecent: e.isRecent,
      counts: countsOf(path, e),
      isPath: true,
      lines: ['blank'],
      count: 0,
      place: '',
    }))
  return [header, ...rows]
}

/** The last folder of a path. */
const nameOf = (path: string) => path.split('/').at(-1) ?? path

/** The header of the group of touched files in a helper's worktrees, then a folder for each worktree holding the tree of its files. */
function worktreeRows(
  byRoot: Map<string, Array<[string, RecordEntry]>>,
  closed: ReadonlySet<string>,
  isOpen: boolean,
  home: string | null,
): Row[] {
  if (byRoot.size === 0) return []
  const count = [...byRoot.values()].reduce((sum, files) => sum + files.length, 0)
  const place = shortPath(sharedFolder([...byRoot.keys()]), home)
  const header = group('worktrees', 'Worktrees', isOpen, count, place)
  if (!isOpen) return [header]
  const roots = [...byRoot.keys()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b))
  const rows = roots.flatMap((path) => {
    const files = byRoot.get(path) ?? []
    const isOpen = !closed.has(path)
    const top: Row = {
      path,
      abs: path,
      name: nameOf(path),
      depth: 1,
      kind: 'dir',
      isOpen,
      tag: null,
      tagWords: null,
      isRecent: false,
      counts: null,
      isPath: false,
      lines: ['blank'],
      count: 0,
      place: '',
    }
    const tree: Node = { name: '', path: '', kids: new Map() }
    for (const [rel] of files) insert(tree, rel)
    return isOpen
      ? [
          top,
          ...flatten(tree, 2, new Map(files), closed, { id: path, abs: path }, { passing: ['blank'], isJoined: true }),
        ]
      : [top]
  })
  return [header, ...rows]
}

/** What the tree needs to know of the session: its directory, the folders and groups the person closed, and the worktrees git lists for the project. */
export type TreeContext = {
  cwd: string
  closed: readonly string[]
  /** The groups the person closed: 'project', 'worktrees' and 'outside'. */
  closedGroups: readonly string[]
  worktrees: readonly string[]
  /** The home folder, or null where the environment names none. */
  home: string | null
  /** The most files to draw, newest first; the rest count as hidden. MAX_FILES where left out. */
  maxFiles?: number
}

/**
 * The tree of the touched files: those inside `cwd` as folders, then the group of those in a helper's worktree, then
 * the group of those outside the project. Only the `MAX_FILES` most recently touched draw, across all of them;
 * every folder shows its files unless it is in `closed`.
 */
export function treeRowsOf(records: Record<string, RecordEntry>, ctx: TreeContext): Tree {
  const { cwd } = ctx
  const linked = linkedRoots(cwd, ctx.worktrees)
  const all = Object.entries(records)
  const newest = all.sort(([, a], [, b]) => b.order - a.order).slice(0, Math.min(MAX_FILES, ctx.maxFiles ?? MAX_FILES))
  const inside: Array<[string, RecordEntry]> = []
  const outside: Array<[string, RecordEntry]> = []
  const byRoot = new Map<string, Array<[string, RecordEntry]>>()
  for (const [path, entry] of newest) {
    // The deepest worktree wins, and a worktree inside the project holds its files, not the project.
    const root = linked.filter((r) => path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
    const rel = relativeTo(cwd, path)
    if (root !== undefined) byRoot.set(root, [...(byRoot.get(root) ?? []), [path.slice(root.length + 1), entry]])
    else if (rel === null) outside.push([path, entry])
    else inside.push([rel, entry])
  }
  const tree: Node = { name: '', path: '', kids: new Map() }
  for (const [p] of inside) insert(tree, p)
  const closed = new Set(ctx.closed)
  const isProjectOpen = !ctx.closedGroups.includes('project')
  const projectRows = isProjectOpen
    ? flatten(tree, 0, new Map(inside), closed, { id: '', abs: withoutSlash(cwd) }, { passing: [], isJoined: false })
    : []
  const rows = [
    ...(inside.length === 0
      ? []
      : [group('project', 'This project', isProjectOpen, inside.length, shortPath(withoutSlash(cwd), ctx.home))]),
    ...projectRows,
    ...worktreeRows(byRoot, closed, !ctx.closedGroups.includes('worktrees'), ctx.home),
    ...outsideRows(outside, !ctx.closedGroups.includes('outside'), ctx.home),
  ]
  return { rows, hidden: all.length - newest.length }
}

/** What one divider costs the drawing, in the characters the engine counts. On the desktop it is the words of its picture. In a terminal it is a row of `─` as wide as the pane, and the engine counts each `─` as three characters (measured, 2026-10-12: a terminal pane 200 columns wide with four dividers drew about 1,900 characters more than the text showed). */
export const dividerChars = (isDesktop: boolean, columns: number): number => (isDesktop ? 10 : columns * 3)

/** A count as it fits the four-cell column: its sign and the number, `+12`; none (zero) draws nothing; past 999, thousands, `+12k`; past 99,999, `+99k+`, the plus saying the figure is cut off. */
const countText = (sign: '+' | '-', n: number): string => {
  if (n === 0) return ''
  if (n <= 999) return `${sign}${n}`
  const thousands = Math.floor(n / 1000)
  return thousands > 99 ? `${sign}99k+` : `${sign}${thousands}k`
}

/** The cells a count column holds at least; a figure that is cut off (`+99k+`) takes the one cell more it needs. */
export const COUNT_CELLS = 4

/** The width of the two count columns of a row: four cells each, or more where its figure is longer. */
export const countCellsOf = (counts: LineCounts | null): [number, number] => {
  const [added, removed] = countPair(counts)
  return [Math.max(COUNT_CELLS, added.length), Math.max(COUNT_CELLS, removed.length)]
}

/** The two figures of a line count, `['+12', '-3']`; a figure that is zero, or both where the count is unknown, is ''. */
export const countPair = (counts: LineCounts | null): [string, string] => [
  countText('+', counts?.added ?? 0),
  countText('-', counts?.removed ?? 0),
]
