// The Open rule: from git's answer for one path and whether the file is on disk to what a press on it opens.

/** What a press opens: the App diff, the App file pane, or nothing (the row says why). */
export type Opening = 'diff' | 'file' | 'gone'

/** `answer` is git's output for the path, null where git failed; a failure is no answer, so it never reads as "git has no record". */
export function openingOf(answer: string | null, exists: boolean): Opening {
  if (answer === null) return 'file'
  if (answer.trim() !== '') return 'diff'
  return exists ? 'file' : 'gone'
}

/** The notice for a press on a file that is not on disk and that git has no record of. */
export const goneNotice = (path: string) =>
  `${path.slice(path.lastIndexOf('/') + 1)} is gone and git has no record of it.`
