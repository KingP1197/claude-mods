import type { Tag, RecordEntry } from '../../types'
import { named, type FileView } from './view'

/** What the request for a Description is built from. */
export type DescribeInput = {
  tag: Tag
  path: string
  oldPath?: string
  before: string
  after: string
  diff: string
}

/** The request for one completion, as `$.model.complete` takes it. */
export type DescriptionRequest = {
  model: 'haiku'
  prompt: string
  maxTokens: number
  effort: 'low'
  timeoutMs: number
}

/** What to say about a file of this Tag and the text to show the model for it. */
function taskOf(input: DescribeInput): { ask: string; label: string; body: string } {
  if (input.tag === 'Created') {
    return { ask: 'Say what the file is for.', label: 'Text', body: input.after }
  }
  if (input.tag === 'Deleted') {
    return { ask: 'Say what the file was.', label: 'Last text', body: input.before }
  }
  // A file moved with no change in its text has no diff to show: say that, instead of an empty one.
  if (input.tag === 'Moved' && input.diff === '') {
    const ask = 'Say that the file moved from the old path to the new one, and that its text did not change.'
    return { ask, label: 'Change', body: '(the text did not change)' }
  }
  const ask = 'Say how the file differs now from when the session started.'
  return { ask: input.tag === 'Moved' ? `${ask} Say that the file moved.` : ask, label: 'Change', body: input.diff }
}

/** The most characters one request holds, the prompt of the second try included. */
const MAX_CHARS = 20_000

/** Room kept in a request for the line that tells the model its last reply ran long. */
const RESERVE = 1_000

/** The first lines of the prompt, up to the text itself. */
function headOf(input: DescribeInput, task: { ask: string; label: string }): string {
  return [
    'You caption one file for the user, who cannot read code.',
    'Reply with 8 words or fewer of plain English, and nothing else.',
    task.ask,
    `File: ${input.path}`,
    ...(input.oldPath === undefined ? [] : [`Moved from: ${input.oldPath}`]),
    `${task.label}:\n`,
  ].join('\n')
}

export function descriptionRequest(input: DescribeInput): DescriptionRequest {
  const task = taskOf(input)
  const head = headOf(input, task)
  const prompt = head + task.body.slice(0, Math.max(0, MAX_CHARS - RESERVE - head.length))
  return { model: 'haiku', prompt, maxTokens: 60, effort: 'low', timeoutMs: 30_000 }
}

/** The longest part of a long reply the second request quotes. */
const MAX_QUOTED = 300

/** The first request again, then a line saying the reply to it ran past 8 words. */
export function longReplyRequest(input: DescribeInput, reply: string): DescriptionRequest {
  const first = descriptionRequest(input)
  const prompt = `${first.prompt}\n\nYour last reply was too long: "${reply.slice(0, MAX_QUOTED)}"\nReply again with 8 words or fewer.`
  return { ...first, prompt }
}

/** What to ask the model about a changed file whose view is a diff, with paths as the view names them; null where the view holds no diff. */
export function inputFor(
  entry: Pick<RecordEntry, 'tag' | 'baseline' | 'oldPath'>,
  view: FileView,
  read: string | null,
  where: { cwd: string; path: string },
): DescribeInput | null {
  // A moved file whose text is as it was has no diff in its view; it still gets a Description of the move.
  const isPureMove =
    entry.tag === 'Moved' && entry.oldPath !== undefined && entry.baseline !== null && entry.baseline === read
  if (!('diff' in view) && !isPureMove) return null
  const moved = entry.oldPath === undefined ? {} : { oldPath: named(where.cwd, entry.oldPath) }
  return {
    tag: entry.tag,
    path: named(where.cwd, where.path),
    ...moved,
    before: entry.baseline ?? '',
    after: read ?? '',
    diff: 'diff' in view ? view.diff : '',
  }
}

/** The most words a Description holds. */
const MAX_WORDS = 8

const wordsOf = (text: string) => text.split(/\s+/).filter((word) => word !== '')

/** Asks the model for a Description of the file through `ask`, which answers a request with the reply's text or null. A reply of more than 8 words gets one more request; a second still too long is cut to its first 8 words. Null when no reply comes or it holds no words. */
export async function describe(
  input: DescribeInput,
  ask: (request: DescriptionRequest) => Promise<string | null>,
): Promise<string | null> {
  const first = await ask(descriptionRequest(input))
  if (first === null) return null
  let words = wordsOf(first)
  if (words.length > MAX_WORDS) {
    const second = await ask(longReplyRequest(input, first))
    if (second === null) return null
    words = wordsOf(second).slice(0, MAX_WORDS)
  }
  return words.length === 0 ? null : words.join(' ')
}

/** A short fingerprint of a text: two 32-bit FNV-1a hashes with different starting points, and the length. */
function hashOf(text: string): string {
  let [a, b] = [0x811c9dc5, 0x01000193]
  for (let i = 0; i < text.length; i += 1) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193)
    b = Math.imul(b ^ text.charCodeAt(i), 0x811c9dc5)
  }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}${text.length.toString(16)}`
}

/** The key a Description is kept under: the file's path and a fingerprint of its text before and after. */
export const keyOf = (input: Pick<DescribeInput, 'path' | 'before' | 'after'>) =>
  `${input.path}:${hashOf(input.before)}:${hashOf(input.after)}`

/** One Description kept: the key of the file and content, and the sentence. */
export type Kept = { key: string; text: string }

/** The most Descriptions kept. */
const MAX_KEPT = 500

const isKept = (x: unknown): x is Kept =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as Partial<Kept>).key === 'string' &&
  typeof (x as Partial<Kept>).text === 'string'

/** The saved Descriptions with a default for whatever an older version did not save or saved wrong: no list is an empty one, and an entry that is no key with a text drops. */
export const keptOf = (saved: unknown): Kept[] =>
  Array.isArray(saved) ? saved.filter(isKept).map((k) => ({ key: k.key, text: k.text })) : []

/** The Descriptions with this one added last, the oldest dropped past the most kept; an earlier one for the same key is replaced. */
export const withKept = (saved: unknown, kept: Kept): Kept[] =>
  [...keptOf(saved).filter((k) => k.key !== kept.key), kept].slice(-MAX_KEPT)
