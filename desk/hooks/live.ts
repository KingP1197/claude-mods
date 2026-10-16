// Whether an agent is still working: the fact the band's counter and the board's cards share. Plain values only.
import type { AgentRow, AgentState } from '../types'

/** A state of a working agent: running, or a teammate idle between turns. Every other state has ended. */
export const isLiveState = (s: AgentState) => s === 'running' || s === 'idle'

/** A card whose agent is still working. */
export const isLive = (r: AgentRow) => isLiveState(r.state)
