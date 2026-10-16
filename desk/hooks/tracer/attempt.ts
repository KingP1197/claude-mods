// Settles an engine call someone else started, and turns its failure into a reason the caller can read. Unlike
// ../failures.ts, it builds no toast. Plain logic, no engine calls.
import { errorText } from '../failures'

/** A call that worked with its value, or failed with the words for why. */
export type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string }

/** Settles a call into an Attempt, so that the caller reads the reason without a try. */
export const attempt = <T>(call: Promise<T>): Promise<Attempt<T>> =>
  call.then(
    (value): Attempt<T> => ({ ok: true, value }),
    (err: unknown): Attempt<T> => ({ ok: false, reason: errorText(err) }),
  )

/** Why a Save did not write: the read that failed, else the write that failed. */
export const saveFailure = (read: Attempt<unknown>, wrote: Attempt<unknown> | null): string => {
  if (!read.ok) return read.reason
  return wrote !== null && !wrote.ok ? wrote.reason : 'nothing was written'
}

/** The words an MCP tool's result gives when it says it failed: its text blocks, else a plain statement. */
export const mcpFailure = (result: { content: ReadonlyArray<{ type: string; text?: string }> }): string => {
  const words = result.content.flatMap((block) =>
    block.type === 'text' && block.text !== undefined ? [block.text] : [],
  )
  return words.join(' ').trim() || 'the app said the call failed'
}
