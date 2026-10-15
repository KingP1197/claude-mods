// The Handoff button's request, cap and tool. Nothing here calls the engine:
// the validator follows `$` only within one file, so the hooks live in register.tsx.
// Claude hands the finished text to this plugin's tool, which holds it to the
// cap and puts it on the user's clipboard. Nothing is written to disk.
import type { ToolSpec } from 'claude-code'

import type { Handoff } from '../../types'

const TOOL_NAME = 'save_handoff'
export const TOOL = `mcp__desk__${TOOL_NAME}`
export const CAP = 3000

export const IDLE: Handoff = { phase: 'idle' }

/**
 * About 3.5 characters a token, so the estimate runs a little high and a
 * handoff it passes stays under the real cap.
 */
const CHARS_PER_TOKEN = 3.5
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN)

/** The prompt's character figure for a token cap: the characters the estimate allows, to the nearest 100, with a thousands comma. */
export const approxChars = (tokens: number): string =>
  (Math.round((tokens * CHARS_PER_TOKEN) / 100) * 100).toLocaleString('en-US')

export const FIRST_LINE = 'Write a handoff for the next session, then save it with the save_handoff tool.'

export const HANDOFF_PROMPT = `${FIRST_LINE}

The reader is a fresh Claude session with no memory of this one. The user will paste your handoff as its first message, and it must be able to carry on from the handoff alone.

Before writing, check the loose ends with commands, not memory: git status, commits not yet pushed, open worktrees, and anything still running. Skip what does not apply to this folder.

Use these headings, in this order. Write "None" under a heading with nothing to report.
1. Working on: the task, with its issue and PR numbers.
2. Why: the goal behind it.
3. State: where the work stands right now.
4. Done: each item with its proof (the command, test or file that shows it).
5. Unchecked: claims made this session that nothing has verified yet.
6. Pending: work started but not finished.
7. Next: what to work on next, opening with the exact first action.
8. Decisions: each ruling the user made, with their reason.
9. Dead ends: what was tried, and why it failed.
10. Loose ends: uncommitted or unpushed work, the worktree and branch, anything still running.
11. Rules: limits the user set this session, such as worker caps or things to leave alone.
12. Waiting on the user: questions only they can answer.

Name exact paths, numbers and commands. Keep the whole handoff under ${CAP.toLocaleString('en-US')} tokens, about ${approxChars(CAP)} characters; the tool measures it and sends back anything longer, so cut and call it again.

Call save_handoff once, with the whole handoff as \`text\`. Write it to no file. Once the tool confirms, reply with one line saying the handoff is on the clipboard.`

export const TOOL_SPEC: ToolSpec = {
  name: TOOL_NAME,
  description:
    "Puts a finished handoff on the user's clipboard. Call it only when asked to write a handoff, with the whole handoff as `text`.",
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The whole handoff, as Markdown.' } },
    required: ['text'],
  },
  isDeferred: false,
}

/** The call's `text` argument, trimmed; '' when it is missing or not a string. */
export const textOf = (raw: unknown) => (typeof raw === 'string' ? raw.trim() : '')

export const ok = (message: string) => ({ result: message, text: message })
export const fail = (message: string) => ({ ...ok(message), isError: true as const })
