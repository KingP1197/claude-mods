// Comments the user writes on a line of a file: the text that goes to Claude, in the shape the app's Files tab uses. Plain logic; the drawing and the sending are in register.tsx.

/** The fence's language for the extensions the language is not named by; any other extension is its own language. */
const LANGUAGE: Record<string, string> = {
  md: 'markdown',
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  zsh: 'bash',
  yml: 'yaml',
}

/** The language a file's fence names: from its extension; none for a file without one. */
function languageOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  if (dot < 1) return ''
  const extension = name.slice(dot + 1).toLowerCase()
  return LANGUAGE[extension] ?? extension
}

/** The fence around a line: three backticks, or one more than the longest run of them in the line, so that the line cannot end the fence. */
const fenceOf = (text: string): string =>
  '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((run) => run[0].length + 1)))

/** A line of a file in a fence, the fence naming the language of the file at `path`. */
export function fenced(path: string, text: string): string {
  const fence = fenceOf(text)
  return `${fence}${languageOf(path)}\n${text}\n${fence}`
}

/** The comment as Claude reads it: where the line is, the line in a fence, then the user's words. `path` is relative to the project. */
export function commentText(where: { path: string; line: number; text: string }, words: string): string {
  return `In \`${where.path}\` at line ${where.line}:\n${fenced(where.path, where.text)}\n${words}`
}

/** The comments waiting for the user's next message, as saved state holds them: a list of texts. Saved state can hold anything, and a bad value means none. */
export const attachedOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((c): c is string => typeof c === 'string' && c !== '') : []

/** The line that says how many comments wait for the user's next message. */
export const attachedWords = (count: number): string =>
  `${count} ${count === 1 ? 'comment' : 'comments'} attached to your next message`

/** The prompt with the attached comments after it, each parted from the text before by a blank line. */
export const withComments = (text: string, comments: string[]): string =>
  [text, ...comments].filter((part) => part !== '').join('\n\n')

/** The kinds of prompt that come from the engine, a schedule or another session, not from the user or from a mod, and that attached comments do not ride on. */
const MACHINE_PROMPTS = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'observer',
  'observer-activity',
  'coordinator',
])

/** Whether a prompt is one the user wrote, which attached comments ride on: not one a mod submitted, and not one the engine or another session sent. */
export const isUsersPrompt = (origin: { kind: string }): boolean =>
  origin.kind !== 'plugin' && !MACHINE_PROMPTS.has(origin.kind)
