// The words every failure toast and notice uses to give its reason, shared by the three areas. Plain logic, no engine
// calls.

/** What a reason reads when the thrown value or the refusal gave none. */
const NO_REASON = 'no reason given'

/** What a refused prompt's reason reads when the hook that refused it gave none. */
export const REFUSED_BY_HOOK = 'another hook refused it'

/**
 * A reason trimmed, with the full stops it ends with cut off so a sentence made around it never doubles the period.
 * Empty when the reason was blank.
 */
const trimmed = (reason: string): string => reason.trim().replace(/\.+$/, '').trim()

/** The text as it is, or "no reason given" where it is blank. */
const orNone = (text: string): string => (text.trim() === '' ? NO_REASON : text)

/** A reason as a sentence part: trimmed, final full stops cut, and "no reason given" where it was blank. */
export const reasonText = (reason: string): string => orNone(trimmed(reason))

/**
 * The words to show for a thrown value: an Error's message, or whatever else was thrown as a string. Never empty: a
 * blank one reads "no reason given".
 */
export const errorText = (err: unknown): string => {
  const text = err instanceof Error ? err.message : String(err)
  return orNone(text)
}

/**
 * Two styles of failure toast. "Could not <action>: <reason>." (this function) is for a press whose action threw: the
 * catch-all of a press hook, and the tracer's wrapper. Every other failure toast keeps the words the user already saw,
 * with `because`'s bracketed reason added: "<old words> (<reason>)." Exceptions, by what they are. A press that catches
 * its own failure beside an old toast for the same action (the side panel's open) keeps that old bracket style. The
 * Files pane and Agents pane opens keep their old colon wording, with no closing full stop and no trimming of the
 * reason. The reveal toast and the open-in-Files notice keep their old words too; reveal has no closing full stop. The
 * turn-ended toast writes its brackets from fixed words, not from a thrown reason. The reason loses any full stops it
 * ends with, so the period is never doubled. A reason left empty (an Error with no message, or only dots and spaces)
 * drops the colon: "Could not <action>." Advice for the user goes after it as its own sentence.
 */
export const failToast = (action: string, reason: string, advice?: string): string => {
  const why = trimmed(reason)
  return `Could not ${action}${why === '' ? '' : `: ${why}`}.${advice === undefined ? '' : ` ${advice}`}`
}

/**
 * A reason in round brackets, for the toasts that keep their old words and add why: full stops cut off its end, and a
 * blank one reads "no reason given".
 */
export const because = (reason: string): string => `(${reasonText(reason)})`
