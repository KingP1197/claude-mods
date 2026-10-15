/** One changed file in git's status: its two-letter code, its path in the repository, and where it came from. */
export type StatusEntry = { code: string; path: string; oldPath: string | null }

/**
 * Reads the output of `git status --porcelain=v1 -z`: entries `XY path`, each ended by a NUL. A rename or a copy
 * is followed by one more field, the path it came from.
 */
export function parseStatus(out: string): StatusEntry[] {
  const fields = out.split('\0')
  const entries: StatusEntry[] = []
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] ?? ''
    if (field.length < 4) continue
    const code = field.slice(0, 2)
    const isRename = code.includes('R') || code.includes('C')
    // A path ending in `/` is a folder that holds another repository: no file, and git cannot hash it.
    if (field.endsWith('/')) continue
    entries.push({ code, path: field.slice(3), oldPath: isRename ? (fields[(i += 1)] ?? null) : null })
  }
  return entries
}
