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

/** One message of an agent's conversation, as its opened card shows it. */
export type ChatLine = {
  /** `agent`: what the agent wrote or did. `to-agent`: its brief, or a message sent to it. */
  who: 'agent' | 'to-agent'
  text: string
}

/** A message the user sent from a card. The engine hides a mod's messages when a conversation is read back,
 *  so the board keeps its own copy, and where it went. */
export type SentLine = {
  text: string
  /** How many of the agent's messages came before it, so it shows in its place among them. */
  after: number
}

/** The opened card's view of its agent's conversation, and what the user did there. */
export type Chat = {
  agentId: string
  /** Its last few messages, oldest first; null when the engine cannot read its conversation. */
  lines: ChatLine[] | null
  /** The outcome of the last message sent or stop asked, shown under the box. */
  note: string | null
  /** How many messages were sent from this card; each send draws a fresh, empty box. */
  sent: number
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
      /** The opened card's conversation view; null while no card is open. */
      chat: Chat | null
      /** Each agent's messages from the user, by agentId; cleared when a new batch starts. */
      sent: Record<string, SentLine[]>
    }
  }
}
