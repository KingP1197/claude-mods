// The Transcript: an agent's conversation read as entries. Nothing here calls the engine.
import type { ApiMessage, SessionMessage, ToolUseSummary } from 'claude-code'

import type { AgentRow, TranscriptLine, SentLine } from '../../types'
import { NUDGE } from './agents'
import { BAR_DONE, BAR_LIVE, ICON_INK, LINE_GUIDE } from './colors'

/** A longer message is cut to this many characters, so one message cannot fill the board. */
const LINE_CHARS = 280

const clip = (s: string) => (s.length > LINE_CHARS ? `${s.slice(0, LINE_CHARS - 1).trimEnd()}…` : s)

/** `mcp__desk__report_progress` reads `report_progress`; a built-in tool keeps its name. */
const toolName = (t: string) => (t.startsWith('mcp__') ? t.slice(t.lastIndexOf('__') + 2) : t)

/** Claude Code's marker in a stopped agent's conversation. It reads as a user message, but nobody wrote it. */
const isStopMarker = (text: string) => /^\[Request interrupted by user[^\]]*\]$/.test(text)

type Fields = Record<string, unknown>
const fieldsOf = (v: unknown): Fields => (typeof v === 'object' && v !== null ? (v as Fields) : {})
const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/** A path as the project knows it: without the project's folder in front. A path outside it stays whole. */
const inProject = (path: string, cwd: string | null) =>
  cwd !== null && path.startsWith(`${cwd.replace(/\/$/, '')}/`) ? path.slice(cwd.replace(/\/$/, '').length + 1) : path

type Target = (input: Fields, cwd: string | null) => string | null

const fileTarget: Target = (input, cwd) => {
  const path = textOf(input['file_path'])
  return path === null ? null : inProject(path, cwd)
}

const grepTarget: Target = (input, cwd) => {
  const [pattern, folder] = [textOf(input['pattern']), textOf(input['path'])]
  if (pattern === null) return null
  return folder === null ? pattern : `${pattern} in ${inProject(folder, cwd)}`
}

/** What each tool's Tool call touched: the file, the search. A tool not listed touched nothing worth naming. */
const TARGETS: Record<string, Target> = {
  Read: fileTarget,
  Edit: fileTarget,
  Write: fileTarget,
  Grep: grepTarget,
  Glob: (input) => textOf(input['pattern']),
  Bash: (input) => textOf(input['command'])?.split('\n')[0] ?? null,
  Agent: (input) => textOf(input['description']),
}

/** A text's lines; the line break that ends the last one starts no further line. */
const linesOf = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'))

/** The `+12 −3` of a change: the lines added and removed, once the lines both texts open and close with are set aside. */
function changeCounts(before: string, after: string): string {
  const [was, now] = [linesOf(before), linesOf(after)]
  const same = (a: string[], b: string[], from: number) => {
    let n = 0
    while (n < Math.min(a.length, b.length) - from && a.at(-1 - n) === b.at(-1 - n)) n++
    return n
  }
  let head = 0
  while (head < Math.min(was.length, now.length) && was[head] === now[head]) head++
  const tail = same(was, now, head)
  return `+${now.length - head - tail} −${was.length - head - tail}`
}

const count = (n: unknown, noun: string) => (typeof n === 'number' ? `${n} ${noun}` : null)

/** The lines of what the model read back, for a tool use that stores no result; undefined when it stored no text. */
const textLines = (use: ToolUseSummary): number | undefined =>
  use.text === undefined || use.text === '' ? undefined : linesOf(use.text).length

/** The `3 files` a tool's text announces on a `Found 3 files` line; null when it has no such line. */
const foundFiles = (use: ToolUseSummary): string | null => {
  const found = /^Found (\d+) files?\b/m.exec(use.text ?? '')
  return found === null ? null : `${found[1]} files`
}

/** The total a count-mode Grep announces on a `Found 7 total occurrences` line; undefined when the text has none. */
const foundOccurrences = (use: ToolUseSummary): number | undefined => {
  const found = /^Found (\d+) total occurrences?\b/m.exec(use.text ?? '')
  return found === null ? undefined : Number(found[1])
}

/** The lines of a Grep's text that read `path:line:text`; undefined when the text has none. */
const matchingLines = (use: ToolUseSummary): number | undefined => {
  const n = linesOf(use.text ?? '').filter((l) => /^\S[^:]*:\d+:/.test(l)).length
  return n === 0 ? undefined : n
}

type Summary = (use: ToolUseSummary) => string | null

/** What came back from each tool, in a few words. A tool not listed has no summary. */
const SUMMARIES: Record<string, Summary> = {
  Read: (use) => count(fieldsOf(fieldsOf(use.result)['file'])['numLines'] ?? textLines(use), 'lines'),
  Edit: (use) => changeCounts(textOf(use.input['old_string']) ?? '', textOf(use.input['new_string']) ?? ''),
  // Only a stored result says what the file held before; without it there is nothing to compare against.
  Write: (use) => {
    const result = fieldsOf(use.result)
    return 'originalFile' in result
      ? changeCounts(textOf(result['originalFile']) ?? '', textOf(use.input['content']) ?? '')
      : null
  },
  Grep: (use) => {
    const result = fieldsOf(use.result)
    return (
      count(result['numMatches'] ?? result['numLines'], 'matches') ??
      count(result['numFiles'], 'files') ??
      foundFiles(use) ??
      count(foundOccurrences(use) ?? matchingLines(use), 'matches')
    )
  },
  Glob: (use) => count(fieldsOf(use.result)['numFiles'], 'files') ?? foundFiles(use),
}

/** How many lines of a Tool call's input and of the end of its result an entry keeps, and how long a kept line may be.
 *  Entries ride in saved state, so a call keeps little. */
const KEPT_INPUT_LINES = 5
const KEPT_OUTPUT_LINES = 20
const KEPT_LINE_CHARS = 240

const clipLine = (l: string) => (l.length > KEPT_LINE_CHARS ? `${l.slice(0, KEPT_LINE_CHARS - 1)}…` : l)

const inputText = (input: Fields): string =>
  Object.entries(input)
    .map(([key, v]) => `${key}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')

/** The id of the agent an Agent call started: on the tool use once the session tracks it, else in the stored result. */
const startedAgent = (use: ToolUseSummary): string | null => use.agentId ?? textOf(fieldsOf(use.result)['agentId'])

/** Whether a tool use is still in flight: the engine holds neither the tool's record nor the text the model read
 *  back, and no error. */
const isInFlight = (use: ToolUseSummary): boolean =>
  use.text === undefined && use.result === undefined && use.isError !== true

/** One Tool call as an entry: the tool's short name, what it touched and what came back, and the start of its input
 *  and the end of its result for when the call is opened. */
const toolEntryOf = (use: ToolUseSummary, cwd: string | null): TranscriptLine => ({
  kind: 'tool',
  id: use.tool_use_id,
  name: toolName(use.tool),
  target: TARGETS[use.tool]?.(use.input, cwd) ?? null,
  summary: SUMMARIES[use.tool]?.(use) ?? null,
  isFailed: use.isError === true,
  ...(isInFlight(use) ? { isInFlight: true } : {}),
  ...(use.tool === 'Agent' ? { childAgentId: startedAgent(use) } : {}),
  input: linesOf(inputText(use.input)).slice(0, KEPT_INPUT_LINES).map(clipLine).join('\n'),
  output: linesOf(use.text ?? '')
    .slice(-KEPT_OUTPUT_LINES)
    .map(clipLine)
    .join('\n'),
})

/** The board's row for the agent an Agent call started, found in the card `cardId`: by the agent id the call
 *  names, else by the card's own agent as parent and the call's description. Null when the board has none. */
export function childOf(
  rows: readonly AgentRow[],
  cardId: string,
  l: Extract<TranscriptLine, { kind: 'tool' }>,
): AgentRow | null {
  const id = l.childAgentId ?? null
  const named = id === null ? undefined : rows.find((r) => r.agentId === id)
  if (named !== undefined) return named
  const parent = rows.find((r) => r.id === cardId)?.agentId ?? null
  if (parent === null || !l.target) return null
  return rows.find((r) => r.parentAgentId === parent && r.description === l.target) ?? null
}

/** Whether an entry hangs off the timeline on an elbow (a Tool call or a Thought) rather than sitting on a dot. */
export const isHung = (l: TranscriptLine | undefined): l is Extract<TranscriptLine, { kind: 'tool' | 'thought' }> =>
  l?.kind === 'tool' || l?.kind === 'thought'

/** The most lines an opened Tool call draws, and how many a failed one's output keeps. */
const OPEN_LINES = 20
const FAILED_LINES = 6

/** What an opened Tool call draws: its input, a blank line, then as much of the end of its result as the 20 lines
 *  allow. A failed one draws only the last six lines of its output. */
export function openedSource(l: Extract<TranscriptLine, { kind: 'tool' }>): string {
  const output = linesOf(l.output ?? '')
  if (l.isFailed) return output.slice(-FAILED_LINES).join('\n')
  const input = linesOf(l.input ?? '')
  const room = OPEN_LINES - input.length - 1
  return [...input, '', ...output.slice(-room)].join('\n')
}

/** How many characters of a Thought an entry keeps; the opened row shows them all and counts the rest. */
const THOUGHT_CHARS = 1200

/** The Thoughts to draw before each assistant message, by the message's index among the rows. */
export type Thoughts = ReadonlyMap<number, readonly TranscriptLine[]>

const blocksOf = (m: ApiMessage): Fields[] => (Array.isArray(m.content) ? m.content.map(fieldsOf) : [])

/** A text with its white space gone, so two readings of one reply compare equal however they were joined. */
const squeezed = (s: string) => s.replace(/\s+/g, '')

/** The row of the same reply as an assistant message of the api form: the first not yet taken that shares a tool use
 *  with it, else the one whose words are the same. -1 when none does. */
function rowOf(rows: readonly SessionMessage[], taken: ReadonlySet<number>, blocks: Fields[]): number {
  const ids = blocks.filter((b) => b['type'] === 'tool_use').map((b) => b['id'])
  const said = squeezed(blocks.map((b) => (b['type'] === 'text' ? (textOf(b['text']) ?? '') : '')).join(''))
  return rows.findIndex(
    (m, i) =>
      m.role === 'assistant' &&
      !taken.has(i) &&
      (m.toolUses.some((u) => ids.includes(u.tool_use_id)) || (said !== '' && squeezed(m.text) === said)),
  )
}

/** The Thoughts the api form of a conversation holds, each filed under the row of its reply. A thinking block
 *  becomes a Thought of the first 1,200 characters; redacted thinking, which has no text, becomes none. */
export function thoughtsOf(rows: readonly SessionMessage[], api: readonly ApiMessage[]): Thoughts {
  const found = new Map<number, TranscriptLine[]>()
  const taken = new Set<number>()
  let n = 0
  for (const m of api) {
    if (m.role !== 'assistant') continue
    const blocks = blocksOf(m)
    const own: TranscriptLine[] = []
    for (const b of blocks) {
      if (!isThinking(b)) continue
      const text = textOf(b['thinking']) ?? ''
      if (b['type'] === 'thinking' && text !== '')
        own.push({
          kind: 'thought',
          id: `th${n}`,
          body: text.slice(0, THOUGHT_CHARS),
          more: Math.max(0, text.length - THOUGHT_CHARS),
        })
      n += 1
    }
    const at = own.length === 0 ? -1 : rowOf(rows, taken, blocks)
    if (at < 0) continue
    taken.add(at)
    found.set(at, own)
  }
  return found
}

const isThinking = (b: Fields) => b['type'] === 'thinking' || b['type'] === 'redacted_thinking'

/** Whether the Card has to say it cannot show the agent's thinking: the api form could not be read, or it was read
 *  for an agent that thinks and holds an assistant message with no thinking block in the whole conversation. */
export function isThinkingMissing(api: unknown, thinks: boolean): boolean {
  if (!Array.isArray(api)) return true
  const messages = (api as ApiMessage[]).filter((m) => m.role === 'assistant')
  return thinks && messages.length > 0 && !messages.some((m) => blocksOf(m).some(isThinking))
}

/** One message as entries: the message itself when it has words, then each Tool call it made. A message with
 *  nothing to read (a tool's answer back to the agent, or a stop) has none. */
function entriesOfMessage(
  m: SessionMessage,
  cwd: string | null,
  thoughts: readonly TranscriptLine[],
): TranscriptLine[] {
  // The board's own nudge rides on every brief; the user did not write it.
  const text = m.text.replace(NUDGE, '').trim()
  if (m.role === 'user') return text === '' || isStopMarker(text) ? [] : [{ kind: 'user', text: clip(text) }]
  const said: TranscriptLine[] = text === '' ? [] : [{ kind: 'agent', text: clip(text) }]
  return [...thoughts, ...said, ...m.toolUses.map((u) => toolEntryOf(u, cwd))]
}

const sentEntry = (s: SentLine): TranscriptLine => ({ kind: 'user', text: clip(s.text) })

/** An agent's whole Transcript, oldest first, the user's own sent messages each in its place. One recorded past
 *  the end of what was read back still shows, last. A delivered message can show in the conversation read back
 *  while it waits for the agent; then the board's own copy is left out. The user message that opens the conversation
 *  is the Brief, and shows as no entry. */
export function entriesOf(
  messages: readonly SessionMessage[],
  sentHere: readonly SentLine[],
  cwd: string | null = null,
  brief: string | null = null,
  thoughts: Thoughts = new Map(),
): TranscriptLine[] {
  const isReadBack = (s: SentLine) =>
    messages.some((m, i) => i >= s.after && m.role === 'user' && m.text.includes(s.text))
  const shown = sentHere.filter((s) => !isReadBack(s))
  // The conversation opens with the Brief as the user message the agent was spawned with; the Brief section shows it.
  const first = messages.findIndex((m) => m.role === 'user')
  const opening =
    brief !== null && first > -1 && messages[first]?.text.replace(NUDGE, '').trim() === brief.trim() ? first : -1
  const sentAfter = (n: number) => shown.filter((s) => s.after === n).map(sentEntry)
  return [
    ...sentAfter(0),
    ...messages.flatMap((m, i) => [
      ...(i === opening ? [] : entriesOfMessage(m, cwd, thoughts.get(i) ?? [])),
      ...sentAfter(i + 1),
    ]),
    ...shown.filter((s) => s.after > messages.length).map(sentEntry),
  ]
}

/** The pixel width and height of a tool icon. */
export const ICON_SIZE = 14

const icon = (alt: string, inner: string) => ({
  alt,
  source:
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 14 14" fill="none" ` +
    `stroke="${ICON_INK}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`,
})

const PAGE_AND_PENCIL = icon('Page and pencil', '<path d="M3 1.5h5.5L11 4v8.5H3z"/><path d="M5 10.5l4-4 1 1-4 4H5z"/>')
const MAGNIFIER = icon('Magnifier', '<circle cx="6" cy="6" r="3.8"/><path d="M9 9l3.5 3.5"/>')
const PROMPT_BOX = icon(
  'Prompt box',
  '<rect x="1.5" y="2.5" width="11" height="9" rx="1.5"/><path d="M4 5.5l2 1.5-2 1.5M7.5 9h3"/>',
)

const ICONS: Record<string, { alt: string; source: string }> = {
  Read: PAGE_AND_PENCIL,
  Edit: PAGE_AND_PENCIL,
  Write: PAGE_AND_PENCIL,
  Grep: MAGNIFIER,
  Glob: MAGNIFIER,
  Bash: PROMPT_BOX,
}

/** What a tool with no icon leads with on desktop: nothing drawn, but as wide as an icon, so names line up. */
export const BLANK_ICON = icon('No icon', '')

/** The picture a Tool call leads with, by the tool's short name; null for a tool with no icon. */
export const toolIcon = (name: string): { alt: string; source: string } | null => ICONS[name] ?? null

/** How many entries the Transcript shows until the user asks for the earlier ones. */
const SHOWN_ENTRIES = 12

/** The index of the first entry drawn: the newest few, or all of them. */
export const firstShown = (count: number, isAll: boolean): number => (isAll ? 0 : Math.max(0, count - SHOWN_ENTRIES))

/** The most entries the board holds for one agent; the oldest past this drop. */
const MAX_ENTRIES = 200

/** The newest entries up to the cap, and how many older ones fell off. */
export const capped = (entries: readonly TranscriptLine[]) => ({
  lines: entries.slice(-MAX_ENTRIES),
  dropped: Math.max(0, entries.length - MAX_ENTRIES),
})

const KINDS: readonly unknown[] = ['agent', 'user', 'thought', 'tool']

/** Whether a saved line is an entry. A card saved before entries had kinds holds lines without one; they read
 *  as none until the next read of the conversation replaces them. */
export const isEntry = (l: unknown): l is TranscriptLine =>
  typeof l === 'object' && l !== null && KINDS.includes((l as { kind?: unknown }).kind)

// The timeline. Each row of the Transcript has a small gutter picture; the pictures of neighbouring rows meet at
// their top and bottom edges, so the line runs on unbroken. All of it is `line-guide`, see-through grey.
// The dots take the bar's own colours: `bar-done` for a message, `bar-live` for the one being written.

/** The gutter's width and a row's height, in pixels. */
export const GUTTER_W = 16
export const ROW_H = 20

const gutter = (inner: string, height = ROW_H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${GUTTER_W}" height="${height}" viewBox="0 0 ${GUTTER_W} ${height}">${inner}</svg>`

const run = (from: number, to: number) =>
  `<path d="M8 ${from}V${to}" fill="none" stroke="${LINE_GUIDE}" stroke-width="1.5"/>`

/** Whose message a dot marks, and whether the agent is still writing it. */
export type Dot = 'agent' | 'user' | 'writing'

const DOTS: Record<Dot, string> = {
  agent: `fill="${BAR_DONE}"`,
  user: `fill="none" stroke="${BAR_DONE}" stroke-width="1.5"`,
  writing: `fill="${BAR_LIVE}"`,
}

/** A message's dot with the line through it: up to the row above when there is one, always down to the text. */
export const dotSvg = (dot: Dot, hasAbove: boolean) =>
  gutter(`${hasAbove ? run(0, 6) : ''}${run(14, ROW_H)}<circle cx="8" cy="10" r="4" ${DOTS[dot]}/>`)

/** The line alone, beside a message's text of `rows` rows: it goes on down only when another row follows. */
export const lineSvg = (hasBelow: boolean, rows = 1) => gutter(hasBelow ? run(0, rows * ROW_H) : '', rows * ROW_H)

/** How many rows a text takes when its words wrap at `columns` cells. An estimate: the engine reports no measured
 *  height. A word wider than a row breaks across rows; a line break starts a new row. */
export function wrappedRows(text: string, columns: number): number {
  const width = Math.max(1, columns)
  let rows = 0
  for (const line of text.split('\n')) {
    let used = 0
    let n = 1
    for (const word of line.split(/\s+/).filter((w) => w !== '')) {
      if (used > 0 && used + 1 + word.length <= width) {
        used += 1 + word.length
        continue
      }
      if (used > 0) n += 1
      const whole = Math.floor((word.length - 1) / width)
      n += whole
      used = word.length - whole * width
    }
    rows += n
  }
  return rows
}

/** A Tool call's elbow off the line: the line goes on past it when another row follows, else it ends here. */
export const elbowSvg = (hasBelow: boolean) =>
  gutter(`${run(0, hasBelow ? ROW_H : 10)}<path d="M8 10H15" fill="none" stroke="${LINE_GUIDE}" stroke-width="1.5"/>`)
