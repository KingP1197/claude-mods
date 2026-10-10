/** Where a subagent stands. Idle is a teammate between turns. */
export type AgentState = 'running' | 'idle' | 'done' | 'failed' | 'stopped' | 'lost'

/** A subagent's token counts, summed from its own model requests. */
export type AgentTokens = {
  /** Its last request's whole input plus output: how full its context is. */
  context: number
  /** Every token its requests read and wrote, summed: what it used in all. */
  total: number
  /** The tokens it wrote itself, all requests summed. */
  output: number
  requests: number
  /** The last request counted, as `<turnId>:<index>`, so no request is counted twice. */
  lastRequest: string
}

export type StepStatus = 'pending' | 'in_progress' | 'completed'

/** One item of a subagent's own to-do list, from its TodoWrite or Task tool calls. */
export type Step = {
  /** `todo<N>` for a TodoWrite item, the task's id for a TaskCreate one. */
  id: string
  title: string
  status: StepStatus
}

/** One subagent of the current batch, as its card shows it. */
export type AgentRow = {
  /** Unique per spawn: the Agent tool call's id plus a counter. */
  id: string
  /** The engine's id for the agent's loop; null until the spawn resolves. */
  agentId: string | null
  description: string
  type: string
  /** An alias or a full model id; its own requests replace it with the exact id. */
  model: string | null
  effort: string | null
  /** True while the effort shown is the session's, before the agent's own requests report it. */
  isEffortInherited: boolean
  isTeammate: boolean
  /** A workflow's agent: the engine's agent list never names these. */
  isWorkflow: boolean
  /** The full brief the agent was given. */
  task: string
  startedAt: number
  endedAt: number | null
  state: AgentState
  /** Absent until its first request answers, and for a teammate in a terminal pane of its own. */
  tokens?: AgentTokens
  /** Absent until the agent writes a to-do list; many never do. */
  steps?: Step[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-board': {
      agents: AgentRow[]
      /** The card whose brief is shown, by row id. */
      openAgent: string | null
      /** The time the cards count from; only moves forward. Ticks each second while any agent runs. */
      now: number
      /** The main thread's effort, read off its last model request; a new agent starts with it. */
      effort: string | null
      /** The session's context window in tokens; a card's context share is measured against it. */
      window: number | null
      /** Whether the Finished section shows its cards. */
      isFinishedShown: boolean
    }
  }
}
