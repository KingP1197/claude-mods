// The side panel's typing box. The desktop app's own field stays narrow and scrolls its text
// out of sight, so this one is drawn by the surface itself: it fills the panel and wraps.
// It holds the text locally, and posts it to register.tsx on each change and on Enter.
// register.tsx bumps `seq` when it takes a question, which empties the box.
import type { ClientKeyEvent, ClientModule, ClientSurface } from 'claude-code'

export type AskBoxProps = {
  draft: string
  seq: number
  placeholder: string
  /** Whether the panel holds the keyboard: the one sign the box gets that it lost it. */
  isPaneFocused: boolean
}
export type AskBoxPost = { kind: 'draft' | 'ask'; text: string }

// Changed in place by the handlers and the blink timer, which outlive the call that made them.
type Live = { text: string; seq: number; isActive: boolean; wasPaneFocused: boolean; isCursorOn: boolean }
type Local = { live: Live }

export const BLINK_MS = 530

// Names the surface sends for keys that type nothing.
const SILENT = new Set([
  'up',
  'down',
  'left',
  'right',
  'tab',
  'escape',
  'home',
  'end',
  'pageup',
  'pagedown',
  'insert',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
])

const ENTER = new Set(['return', 'enter'])
// Mac keyboards send their Delete key as either name.
const DELETE = new Set(['backspace', 'delete'])

/** One key's effect on the text: the new text and whether it asks; null when the key does nothing. */
export function edit(text: string, k: ClientKeyEvent): { text: string; isAsk: boolean } | null {
  if (ENTER.has(k.key)) return k.shift ? { text: `${text}\n`, isAsk: false } : { text, isAsk: true }
  // Cmd+Delete clears the box.
  if (DELETE.has(k.key)) return { text: k.meta ? '' : [...text].slice(0, -1).join(''), isAsk: false }
  if (k.ctrl || k.meta || SILENT.has(k.key)) return null
  if (k.key === 'space') return { text: `${text} `, isAsk: false }
  // A single character, or a pasted run of them.
  return { text: text + k.key, isAsk: false }
}

type Surface = ClientSurface<Local>

// The box's live state, made on the first draw and kept by the surface after that.
function liveOf(props: AskBoxProps, surface: Surface): Live {
  const saved = surface.state?.live
  if (saved !== undefined) return saved
  const made: Live = {
    text: props.draft,
    seq: props.seq,
    isActive: false,
    wasPaneFocused: props.isPaneFocused,
    isCursorOn: true,
  }
  // Started once: the cursor blinks while the box takes keys.
  surface.every(BLINK_MS, () => {
    if (!made.isActive) return
    made.isCursorOn = !made.isCursorOn
    surface.setState({ live: made })
  })
  surface.setState({ live: made })
  return made
}

// Brings the live state up to date with what register.tsx sent.
function sync(m: Live, props: AskBoxProps) {
  // A new seq from register.tsx means it took the question: start from its draft.
  if (m.seq !== props.seq) {
    m.seq = props.seq
    m.text = props.draft
  }
  // No event says the box lost the keyboard, but the panel losing it does.
  if (m.wasPaneFocused && !props.isPaneFocused) m.isActive = false
  m.wasPaneFocused = props.isPaneFocused
}

// A click or a key starts typing mode; each key edits the text or asks.
function listen(m: Live, surface: Surface) {
  const wake = () => {
    m.isActive = true
    m.isCursorOn = true
  }
  surface.onPointer((p) => {
    if (p.type !== 'down') return
    wake()
    surface.setState({ live: m })
  })
  surface.onKey((k) => {
    wake()
    const next = edit(m.text, k)
    if (next !== null && next.isAsk) {
      if (m.text.trim() !== '') surface.post({ kind: 'ask', text: m.text } satisfies AskBoxPost)
    } else if (next !== null) {
      m.text = next.text
      surface.post({ kind: 'draft', text: m.text } satisfies AskBoxPost)
    }
    surface.setState({ live: m })
  })
}

function view(m: Live, props: AskBoxProps, surface: Surface) {
  const { Box, Text } = surface.elements
  const cursor = m.isActive ? <Text color="suggestion">{m.isCursorOn ? '▏' : ' '}</Text> : null
  return (
    <Box flexDirection="column" width="100%">
      <Box borderStyle="round" borderColor={m.isActive ? 'suggestion' : 'subtle'} paddingX={1} width="100%">
        {/* The placeholder steps aside once the box takes keys, as a text field's does. */}
        {m.text === '' && !m.isActive ? (
          <Text dimColor>{props.placeholder}</Text>
        ) : m.text === '' ? (
          <Text>{cursor}</Text>
        ) : (
          <Text wrap="wrap">
            {m.text}
            {cursor}
          </Text>
        )}
      </Box>
      {m.isActive ? null : <Text dimColor>Click the box to type.</Text>}
    </Box>
  )
}

const AskBox: ClientModule<AskBoxProps, Local> = (props, surface) => {
  const m = liveOf(props, surface)
  sync(m, props)
  listen(m, surface)
  return view(m, props, surface)
}

export default AskBox
