// Reveal: from the operating system and a path to the button's label and the command that opens the file manager.

/** The systems Reveal knows: a Mac, Linux, or anything else, which reads as Windows. */
type System = 'Darwin' | 'Linux' | 'Windows'

/** What Reveal needs to know of the selection. */
export type RevealInput = {
  system: System
  path: string
  isFolder: boolean
  stillExists: boolean
  /** The nearest folder above the path that is still on disk. */
  nearestFolder: string
}

/** The button's label and the program with its arguments. */
export type Reveal = { label: string; argv: string[] }

/** The folder a path sits in. */
export const parentOf = (path: string) => (path.lastIndexOf('/') <= 0 ? '/' : path.slice(0, path.lastIndexOf('/')))

export function reveal(from: RevealInput): Reveal {
  // A path that is gone cannot be selected: its nearest folder opens instead.
  const input = from.stillExists ? from : { ...from, path: from.nearestFolder, isFolder: true }
  if (input.system === 'Linux') {
    return { label: 'Open folder', argv: ['xdg-open', input.isFolder ? input.path : parentOf(input.path)] }
  }
  if (input.system === 'Windows') {
    const label = 'Show in File Explorer'
    return { label, argv: input.isFolder ? ['explorer', input.path] : ['explorer', `/select,${input.path}`] }
  }
  const label = 'Show in Finder'
  if (input.isFolder) return { label, argv: ['open', input.path] }
  return { label, argv: ['open', '-R', input.path] }
}

/** The system `uname -s` named: its answer, or null where it did not run. */
export function systemOf(ran: { exitCode: number; stdout: string } | null): System {
  const name = ran !== null && ran.exitCode === 0 ? ran.stdout.trim() : ''
  return name === 'Darwin' || name === 'Linux' ? name : 'Windows'
}
