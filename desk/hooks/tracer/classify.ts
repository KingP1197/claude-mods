import type { Touch } from './record'

/** The tool call as the hook sees it: its name and the tool's own arguments beside it. */
type Call = { tool: string } & Record<string, unknown>
type Fields = Record<string, unknown>

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const fieldsOf = (v: unknown): Fields => (typeof v === 'object' && v !== null ? (v as Fields) : {})

/** A Touch at `path`, or null when the call named no path; `seen` is the file's content after, where the call showed it. */
const touch = (path: string | null, tag: Touch['tag'], baseline: string | null, seen: string | null = null) =>
  path === null ? null : ({ path, tag, baseline, ...(seen === null ? {} : { seen }) } satisfies Touch)

/** Whether a Read gave the whole file: from its first line to its last, and not cut short by the token cap. */
const isWhole = (file: Fields): boolean =>
  file['startLine'] === 1 && file['numLines'] === file['totalLines'] && file['truncatedByTokenCap'] !== true

/** A Read: the file's path as the result gives it, else as asked; the text read is the baseline, and what was last seen, only when it is the whole file. */
function read(input: Call, result: Fields): Touch | null {
  const file = fieldsOf(result['file'])
  const whole = isWhole(file) ? text(file['content']) : null
  return touch(text(file['filePath']) ?? text(input['file_path']), 'Read', whole, whole)
}

/** The text with an edit applied, as the Edit tool applies it: the first match, or every match for a replace-all; null when the result lacks what is needed or the text has no match. */
function applied(result: Fields): string | null {
  const [original, from, to] = [text(result['originalFile']), text(result['oldString']), text(result['newString'])]
  if (original === null || from === null || from === '' || to === null || !original.includes(from)) return null
  if (result['replaceAll'] === true) return original.split(from).join(to)
  const at = original.indexOf(from)
  return original.slice(0, at) + to + original.slice(at + from.length)
}

/** An Edit: the file as it was before the edit is the baseline, and the file as the edit left it is what was last seen. */
const edit = (input: Call, result: Fields) =>
  touch(text(input['file_path']), 'Edited', text(result['originalFile']), applied(result))

/** A NotebookEdit: the notebook as it was before the edit is the baseline. */
const notebookEdit = (input: Call, result: Fields) =>
  touch(text(input['notebook_path']), 'Edited', text(result['original_file']))

/** A Write: Created for a new file, with an empty baseline; Edited for a file it replaced. The text written is what the file holds now. */
function write(input: Call, result: Fields): Touch | null {
  const [path, content] = [text(input['file_path']), text(input['content'])]
  if (result['type'] === 'create') return touch(path, 'Created', '', content)
  return touch(path, 'Edited', text(result['originalFile']), content)
}

/** Tools that touch a file. Anything else, searches included, touches none. */
const TOOLS = new Map([
  ['Read', read],
  ['Edit', edit],
  ['NotebookEdit', notebookEdit],
  ['Write', write],
])

/** What a finished tool call did to a file, or null when it touched none. */
export function classify(input: Call, result: unknown): Touch | null {
  return TOOLS.get(input.tool)?.(input, fieldsOf(result)) ?? null
}
