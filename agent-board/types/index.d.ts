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
  /** The agent whose loop started this one; null for one started from the main thread. A row saved before this
   *  existed lacks it: read as null. */
  parentAgentId?: string | null
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

/** One entry of an agent's Transcript, as its opened card shows it. `agent`: a message the agent wrote.
 *  `user`: its brief, or a message sent to it. `thought`: one piece of the agent's thinking. `tool`: one Tool call, by the tool's short name, with what it
 *  touched (`target`) and what came back (`summary`), null when there is none, and whether the tool reported an
 *  error (`isFailed`). A card saved before these existed lacks them; read a missing one as null, or false. */
export type TranscriptLine =
  | { kind: 'agent' | 'user'; text: string }
  | {
      kind: 'thought'
      /** The thinking's place among the conversation's thinking blocks, `th<n>`; keys the Thought among a card's opened ones. */
      id: string
      /** The start of the thinking, at most 1,200 characters. */
      body: string
      /** How many characters of the thinking `body` leaves out. */
      more: number
    }
  | {
      kind: 'tool'
      /** The tool use's id; keys the call among a card's opened ones. Absent on a card saved before. */
      id?: string
      name: string
      target?: string | null
      summary?: string | null
      isFailed?: boolean
      /** True while the call's result has not come back. Absent on a card saved before; read as false. */
      isInFlight?: boolean
      /** On an `Agent` call: the engine's id for the agent it started; null when the call named none. Absent on a card saved before; read as null. */
      childAgentId?: string | null
      /** The start of the call's input as `key: value` lines, and the last lines of its result. Absent on a card
       *  saved before; read as none. */
      input?: string
      output?: string
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
  lines: TranscriptLine[] | null
  /** The engine could not read its conversation, so `lines` holds only what the user sent from here. A chat saved before this lacks it: readable. */
  isUnread?: boolean
  /** The Card could not show the agent's thinking: the api form was refused, or an agent that thinks returned none. A chat saved before this lacks it: not shown. */
  isThinkingMissing?: boolean
  /** How many older entries fell off the front, past the cap. A chat saved before this lacks it: none. */
  dropped?: number
  /** The outcome of the last message sent or stop asked, shown under the box. */
  note: string | null
  /** How many messages were sent from this card; each send draws a fresh, empty box. */
  sent: number
}

/** What an opened card has open. A card saved before this lacks every field; a missing field reads as the default:
 *  both sections open, the brief cut, only the newest entries. */
export type CardSections = {
  /** The Brief section shows its body. Open by default. */
  isBriefOpen?: boolean
  /** The Transcript section shows its body. Open by default. */
  isTranscriptOpen?: boolean
  /** The Brief shows whole, not cut. Cut by default. */
  isBriefWhole?: boolean
  /** The Transcript shows every entry it holds, not just the newest. Off by default. */
  isEarlierShown?: boolean
  /** The ids of the Tool calls the user has flipped from how they start: a call starts closed, a failed one open. */
  flippedCalls?: string[]
  /** The ids of the Thoughts the user has opened: a Thought starts closed. */
  openThoughts?: string[]
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
      /** Each card's open sections, by row id; cleared when a new batch starts. A card absent here has the defaults. */
      sections: Record<string, CardSections>
    }
  }
}
