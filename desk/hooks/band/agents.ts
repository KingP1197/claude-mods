// The Agent counter's figures, from the board's Batch. Nothing here calls the engine.
import type { AgentRow } from '../../types'

/** How many agents of the Batch are Live (running or idle) and how many have finished (every other state). */
export function countAgents(batch: readonly AgentRow[]): { live: number; finished: number } {
  const live = batch.filter((r) => r.state === 'running' || r.state === 'idle').length
  return { live, finished: batch.length - live }
}

/** The hover card's line for a Batch: the Live and finished counts, or that there is no Batch. */
export function agentsCard(batch: readonly AgentRow[]): string {
  if (batch.length === 0) return 'No agents this session'
  const { live, finished } = countAgents(batch)
  return `${live} running · ${finished} finished`
}
