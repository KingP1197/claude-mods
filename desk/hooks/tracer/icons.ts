import { OPEN_FOLDER_FILL } from './colours'

/** The kinds of file the tree tells apart by a Type icon. */
type IconKind = 'ts' | 'md' | 'json' | 'sh' | 'other'

/** What a file's Type icon is: its kind, its colour, the two cells of letters the terminal draws, and the words the desktop's picture says. */
export type TypeIcon = { kind: IconKind; color: string; letters: string; alt: string }

/** The design system's fixed colours for pictures: `type-ts`, `type-md`, `type-json` and `icon-ink`. */
const TYPE_COLOR = { ts: '#3b82f6', md: '#0891b2', json: '#d97706', ink: '#8b949e' } as const

const BY_EXTENSION: Record<string, IconKind> = {
  ts: 'ts',
  tsx: 'ts',
  js: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  md: 'md',
  json: 'json',
  jsonc: 'json',
  yaml: 'json',
  yml: 'json',
  toml: 'json',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
}

const LOOK: Record<IconKind, Omit<TypeIcon, 'letters'> & { letters: string | null }> = {
  ts: { kind: 'ts', color: TYPE_COLOR.ts, letters: 'TS', alt: 'TypeScript or JavaScript file' },
  md: { kind: 'md', color: TYPE_COLOR.md, letters: 'M↓', alt: 'Markdown file' },
  json: { kind: 'json', color: TYPE_COLOR.json, letters: '{}', alt: 'data file' },
  sh: { kind: 'sh', color: TYPE_COLOR.ink, letters: '>_', alt: 'shell script' },
  other: { kind: 'other', color: TYPE_COLOR.ink, letters: null, alt: 'file' },
}

/** The extension of a file name, lowercase: after the last dot, or after the first for a name like `.gitignore`; '' for none. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The Type icon of a file name, by its extension. A file of no known kind gets the extension's first two letters, or two dots without an extension. */
export function typeIconOf(name: string): TypeIcon {
  const ext = extensionOf(name)
  const look = LOOK[BY_EXTENSION[ext] ?? 'other']
  return { ...look, letters: look.letters ?? (ext === '' ? '··' : ext.slice(0, 2).padEnd(2)) }
}

/** The picture of a Type icon for the desktop, about 14 pixels: its letters in its colour, or for a file of no known kind a page outline. */
export function iconSvg(icon: TypeIcon): string {
  const open = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">'
  if (icon.kind === 'other') {
    const page = 'M3.5 1.5h5l3 3v8h-8z M8.5 1.5v3h3'
    return `${open}<path d="${page}" fill="none" stroke="${icon.color}" stroke-width="1" stroke-linejoin="round"/></svg>`
  }
  const letters = icon.letters.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const face = 'font-family="ui-monospace,Menlo,monospace" font-size="9" font-weight="700"'
  return `${open}<text x="7" y="10.5" text-anchor="middle" ${face} fill="${icon.color}">${letters}</text></svg>`
}

const OPEN_TAG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">'

/** The chevron for the desktop: pointing down for an open folder, right for a closed one. */
export const chevronSvg = (isOpen: boolean): string =>
  `${OPEN_TAG}<path d="${isOpen ? 'M3 5l4 4 4-4' : 'M5 3l4 4-4 4'}" fill="none" stroke="${TYPE_COLOR.ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`

/** The folder outline for the desktop, lightly filled when open. */
export const folderSvg = (isOpen: boolean): string =>
  `${OPEN_TAG}<path d="M1.5 3.5h4l1.5 1.5h5.5v6.5h-11z" fill="${isOpen ? OPEN_FOLDER_FILL : 'none'}" stroke="${TYPE_COLOR.ink}" stroke-width="1" stroke-linejoin="round"/></svg>`
