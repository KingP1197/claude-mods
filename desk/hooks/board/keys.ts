// The board's button keys, one codec for both directions. Drawing encodes a press into the key a Button
// carries; a press, or a first click that arrives only as focus landing on that key, decodes it back.
// Nothing here calls the engine.
import type { SectionName } from './agents'

const CARD_KINDS = ['name', 'stop', 'child', 'more', 'earlier'] as const
const SECTION_NAMES: readonly SectionName[] = ['brief', 'transcript']
const FINISHED_KEY = 'toggle-finished'

/** A board button's press: what it acts on, read from its key. */
export type Pressed =
  | { kind: 'name'; id: string }
  | { kind: 'stop'; id: string }
  | { kind: 'child'; id: string }
  | { kind: 'more'; id: string }
  | { kind: 'earlier'; id: string }
  | { kind: 'section'; id: string; which: SectionName }
  | { kind: 'call'; id: string; callId: string }
  | { kind: 'thought'; id: string; thoughtId: string }
  | { kind: 'finished' }

/** What each press does, in words that finish "Could not ...": the toast for a press whose action threw. */
export const BOARD_DOING: Record<Pressed['kind'], string> = {
  finished: 'show or hide the finished agents',
  name: 'open or close the agent card',
  child: 'open or close the agent card',
  stop: 'stop the agent',
  more: 'show all of the brief or cut it short',
  earlier: 'show or hide the earlier transcript entries',
  section: 'open or close that section of the card',
  call: 'open or close that tool call',
  thought: 'open or close that thought',
}

/** The key a button of this press is drawn with. */
export function boardKey(p: Pressed): string {
  switch (p.kind) {
    case 'finished':
      return FINISHED_KEY
    case 'section':
      return `section:${p.id}:${p.which}`
    case 'call':
      return `call:${p.id}:${p.callId}`
    case 'thought':
      return `thought:${p.id}:${p.thoughtId}`
    default:
      return `${p.kind}:${p.id}`
  }
}

/** A section key's tail, `<card>:<section>`, as its press. */
function sectionOf(rest: string): Pressed | null {
  const m = /^(.+):([a-z]+)$/.exec(rest)
  const which = SECTION_NAMES.find((n) => n === m?.[2])
  return m === null || which === undefined ? null : { kind: 'section', id: m[1] ?? '', which }
}

/** A chevron key's tail, `<card>:<entry>`, as the press of a Tool call or a Thought. The entry may hold colons. */
function entryOf(kind: string, rest: string): Pressed | null {
  const m = /^([^:]+):(.+)$/.exec(rest)
  if (m === null) return null
  const [, id = '', entry = ''] = m
  if (kind === 'call') return { kind, id, callId: entry }
  return kind === 'thought' ? { kind, id, thoughtId: entry } : null
}

/** The press a key names, or null for an element that is no button, such as the message box. */
export function boardPressOf(key: string | undefined): Pressed | null {
  if (key === FINISHED_KEY) return { kind: 'finished' }
  const m = /^([a-z]+):(.+)$/.exec(key ?? '')
  if (m === null) return null
  const [, kind = '', rest = ''] = m
  const card = CARD_KINDS.find((k) => k === kind)
  if (card !== undefined) return { kind: card, id: rest }
  return kind === 'section' ? sectionOf(rest) : entryOf(kind, rest)
}
