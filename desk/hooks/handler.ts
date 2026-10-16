// The types an area's shared-event handler is declared with. The engine's `Next` and `StreamNext` carry members no
// area uses, and a handler declared with these narrower types still fits `on(event, {}, handler)`: the engine's
// `next` has the call these name. Also the one closure every drawn Button carries. No engine calls, no `$`.
import type { Args, Chunk, EventName, EventResult, Frozen, StreamingEventName } from 'claude-code'

export type EventIn<N extends EventName> = Frozen<Args<N>>
export type EventOut<N extends EventName> = EventResult<N>
/** A plain event's `next`, narrowed to its call. */
export type PlainNext<N extends EventName> = (e: EventIn<N>) => Promise<EventOut<N>>
/** A streaming event's `next`: opens the stream beneath, afresh on every call. */
export type StreamingNext<N extends StreamingEventName> = (e: EventIn<N>) => AsyncGenerator<Chunk<N>, EventOut<N>>

/**
 * The `onPress` every drawn Button passes, since the prop is required. Each area's `ui.press` hook takes the press by
 * returning `{ element }`, so the engine never gets down to this closure: it never runs.
 */
export const takenByPressHook = (): void => {}

/** The mod's name as the engine stamps it on a press: the `name` in desk/.claude-plugin/plugin.json. handler.test.ts fails if the two differ. */
export const OWN_PLUGIN = 'desk'

/**
 * Whether a pressed Button is one this mod drew. The press chain runs for every plugin's Buttons, and another plugin may
 * key one like ours. A `ui.focus` event may carry no plugin; that is not ours.
 */
export const isOwnPress = (e: { plugin?: string }): boolean => e.plugin === OWN_PLUGIN
