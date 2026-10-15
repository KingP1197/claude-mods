/** The folders `git worktree list --porcelain` prints, the repository's own first: one `worktree <path>` line per block. */
export function parseWorktrees(listing: string): string[] {
  return listing
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length))
}

/** The worktrees that are a helper's: git lists the project's own folder (or a folder above it) among them, and that one is the project. */
export const linkedRoots = (cwd: string, roots: readonly string[]): string[] =>
  roots.filter((root) => cwd !== root && !cwd.startsWith(`${root}/`))

/**
 * Whether a file at `path`, new to the records, may sit in a worktree git has not listed yet: it is in no listed
 * helper's worktree, and either outside the project or where Claude makes its helpers' worktrees inside it.
 */
export function mayBeInUnlistedWorktree(path: string, cwd: string, roots: readonly string[]): boolean {
  if (linkedRoots(cwd, roots).some((root) => path.startsWith(`${root}/`))) return false
  return !path.startsWith(`${cwd}/`) || path.startsWith(`${cwd}/.claude/worktrees/`)
}
