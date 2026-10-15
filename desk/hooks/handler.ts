// The types an area's shared-event handler is declared with. The engine's `Next` and `StreamNext` carry members no
// area uses, and a handler declared with these narrower types still fits `on(event, {}, handler)`: the engine's
// `next` has the call these name. Types only: no engine calls, no `$`.
import type { Args, Chunk, EventName, EventResult, Frozen, StreamingEventName } from 'claude-code'

export type EventIn<N extends EventName> = Frozen<Args<N>>
export type EventOut<N extends EventName> = EventResult<N>
/** A plain event's `next`, narrowed to its call. */
export type PlainNext<N extends EventName> = (e: EventIn<N>) => Promise<EventOut<N>>
/** A streaming event's `next`: opens the stream beneath, afresh on every call. */
export type StreamingNext<N extends StreamingEventName> = (e: EventIn<N>) => AsyncGenerator<Chunk<N>, EventOut<N>>
