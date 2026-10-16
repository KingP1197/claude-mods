/** One source of context, as /context names it. */
export type Part = { name: string; tokens: number }

export type Line = {
  branch: string | null
  ctxUsed: number | null
  ctxWindow: number
  ctxPercent: number | null
  rate5: number | null
  rate7: number | null
  /** Context by source; null until the first breakdown arrives. */
  parts: Part[] | null
  /** True when parts came from the exact token count, false for the local estimate. */
  isExact: boolean
}

/** The Handoff button's progress: pressed and queued, then being written. */
export type Handoff =
  | { phase: 'idle' }
  | {
      phase: 'queued'
      /** The surface the press came from, so the copy lands on that clipboard. */
      surface: 'terminal' | 'desktop' | 'mobile' | 'vscode'
    }
  | {
      phase: 'writing'
      /** The surface the press came from, so the copy lands on that clipboard. */
      surface: 'terminal' | 'desktop' | 'mobile' | 'vscode'
      /** The handoff turn's id, from its turn.start: a second press ends that turn by it. Absent on a save from before
       *  the id was kept. */
      turnId?: string
    }

/** One question in the side-question panel: waiting, answered, or failed. */
export type SideTurn =
  | { question: string; state: 'pending' }
  | { question: string; state: 'answered'; answer: string }
  | {
      question: string
      state: 'failed'
      /** Why no answer came, in plain words. */
      failure: string
    }

/** The side-question panel: its thread, the unsent text, and what it is busy with. */
export type Side = {
  turns: SideTurn[]
  /** The text in the typing box, kept so a redraw or a reopened panel does not lose it. */
  draft: string
  /** Bumped each time a question is taken, which empties the typing box. */
  draftSeq: number
  isAsking: boolean
}

/** The main thread's prompt cache, as of its last model request. */
export type CacheSeen = {
  /** When that request was sent, in ms; the cache's lifetime counts from here. */
  sentAt: number
  /** That request's whole input plus its output: about what the next request re-stores once the cache lapses. */
  prefix: number
  /** The cache's lifetime in ms, read from the transcript; null until read. */
  ttlMs: number | null
}

/** The Auto warm switch: while on, the band keeps the hour-long cache warm until the off time. */
export type AutoWarm = {
  isOn: boolean
  /** When the switch turns itself off, in ms; 0 while it is off. */
  offAt: number
}

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
  isTeammate: boolean
  /** A workflow's agent: the engine's agent list never names these. */
  isWorkflow: boolean
  /** The agent whose loop started this one; null for one started from the main thread. */
  parentAgentId: string | null
  /** The full brief the agent was given. */
  task: string
  startedAt: number
  endedAt: number | null
  state: AgentState
  /** Absent until its first request answers, and for a teammate in a terminal pane of its own. */
  tokens?: AgentTokens
  /** The requests whose tokens the card counted, oldest first, the latest 50 only, so an older request seen again is
   *  not counted twice. Absent on a card saved before these were kept, and until a request counts. */
  counted?: string[]
  /** True while the card reads lost only because a reload cut off its spawn (it had no agent yet). A late answer to
   *  that spawn runs the card again and clears the mark. Absent otherwise. */
  isAbandoned?: boolean
  /** Absent until the agent writes a to-do list; many never do. */
  steps?: Step[]
  /** The arrival number of the last early report this card applied; absent until it applies one. */
  earlyApplied?: number
  /** When the card's last fact of each kind came, so a late, older report never replaces a newer value. Absent on
   *  a card saved before these times were kept, and until a fact of that kind changes the card. */
  factAt?: FactTimes
  /** When each step, by its id, last changed, so a late, older change to it never undoes a newer one. Absent until
   *  a single-step change applies. */
  stepAt?: Record<string, number>
}

/** When a card's last change of each kind came: its model and effort (`step`), its Steps (`steps`), its token
 *  counts (`usage`), its whole Steps list (`list`), which a single step older than it must not join, and the user's
 *  last wake of it (`wake`), which an ended report older than it must not undo. */
export type FactTimes = { step?: number; steps?: number; usage?: number; list?: number; wake?: number }

/** What an agent's own loop reports about it: a model request's start (`step`) or its counts (`usage`), a change to
 *  its Steps, or the end of its turn. The Agent Book applies each to the agent's card. Every field is set, as saved
 *  state holds JSON data. */
export type AgentReport =
  | { kind: 'step'; model: string; effort: string | null }
  | {
      kind: 'usage'
      /** The request, as `<turnId>:<index>`: a request counts once. */
      key: string
      usage: {
        input_tokens: number
        cache_read_input_tokens: number
        cache_creation_input_tokens: number
        output_tokens: number
      }
    }
  | { kind: 'steps'; steps: Step[] }
  | { kind: 'stepAdded'; id: string; title: string }
  | { kind: 'stepChanged'; id: string; status: StepStatus | 'deleted' | null; title: string | null }
  | { kind: 'ended'; reason: string }

/** A report that came before its agent's card linked: the report, when it came, and its place in arrival order. */
export type EarlyReport = { report: AgentReport; t: number; n: number }

/** The reports waiting for their agent's card to link, by agentId. `next` is the arrival number the next one gets. */
export type EarlyReports = { byAgent: Record<string, EarlyReport[]>; next: number }

/** One entry of an agent's Transcript, as its opened card shows it. `agent`: a message the agent wrote.
 *  `user`: its brief, or a message sent to it. `thought`: one piece of the agent's thinking. `tool`: one Tool call, by the tool's short name, with what it
 *  touched (`target`) and what came back (`summary`), null when there is none, and whether the tool reported an
 *  error (`isFailed`). */
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
      /** The tool use's id; keys the call among a card's opened ones. */
      id: string
      name: string
      target: string | null
      summary: string | null
      isFailed: boolean
      /** True while the call's result has not come back; absent once it has. */
      isInFlight?: boolean
      /** On an `Agent` call: the engine's id for the agent it started; null when the call named none. Absent on any other call. */
      childAgentId?: string | null
      /** The start of the call's input as `key: value` lines, and the last lines of its result. */
      input: string
      output: string
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
  /** The engine could not read its conversation, so `lines` holds only what the user sent from here. */
  isUnread: boolean
  /** The Card could not show the agent's thinking: the api form was refused, or an agent that thinks returned none. */
  isThinkingMissing: boolean
  /** How many older entries fell off the front, past the cap. */
  dropped: number
  /** The outcome of the last message sent or stop asked, shown under the box. */
  note: string | null
  /** How many messages were sent from this card; each send draws a fresh, empty box. */
  sent: number
}

/** What an opened card has open. A card with no entry has the defaults: both sections open, the brief cut, only
 *  the newest entries. */
export type CardSections = {
  /** The Brief section shows its body. Open by default. */
  isBriefOpen: boolean
  /** The Transcript section shows its body. Open by default. */
  isTranscriptOpen: boolean
  /** The Brief shows whole, not cut. Cut by default. */
  isBriefWhole: boolean
  /** The Transcript shows every entry it holds, not just the newest. Off by default. */
  isEarlierShown: boolean
  /** The ids of the Tool calls the user has flipped from how they start: a call starts closed, a failed one open. */
  flippedCalls: string[]
  /** The ids of the Thoughts the user has opened: a Thought starts closed. */
  openThoughts: string[]
}

/** The biggest thing done to a file, from biggest down: Deleted, Created, Moved, Edited, Read. */
export type Tag = 'Deleted' | 'Created' | 'Moved' | 'Edited' | 'Read'

/** What a record keeps of one touched file. */
export type RecordEntry = {
  /** The biggest thing done to the file so far. */
  tag: Tag
  /** True from a Touch until the person's next prompt; drawn as a dot. */
  isRecent: boolean
  /** Counts the touches: the file's latest touch took the number after the highest one before it. Bigger is newer. */
  order: number
  /**
   * The file's content before the session's first change to it. Null with `isBaselineTooBig` false means the before
   * text is unknown: a command changed the file and it had already changed before, so neither the records nor git held it.
   */
  baseline: string | null
  /** True when the file's first-touch content ran over 100,000 characters, the most the code view draws, so none was kept. */
  isBaselineTooBig: boolean
  /** The file's latest content the mod saw (a whole-file Read, a Write's text, an Edit's result), kept for a deleted file's view; absent when it saw none or it ran over 100,000 characters. */
  lastSeen?: string
  /** Where a moved file was before it moved, as an absolute path; absent for a file never moved. */
  oldPath?: string
  /** True when the user made the file's latest edit (a line saved from the pane), so its Tag reads "Edited by you", whatever Tag the record holds (`Created` and `Moved` too). A later Touch of Claude's other than a Read clears it; a Read leaves it. Absent reads as false. */
  isByUser?: boolean
}

/** Who made a Touch: Claude itself, one of its helpers by agent id, a shell command by its first line, or the user, whose edit saved from the pane is logged like a Touch. */
export type TouchBy =
  { kind: 'claude' } | { kind: 'helper'; id: string } | { kind: 'command'; text: string } | { kind: 'user' }

/** One Touch in the Touch log. */
export type TouchEntry = {
  type: 'touch'
  /** The Touch's number in session order, from 1. */
  n: number
  /** The Tag of this one Touch, not the file's biggest. */
  kind: Tag
  /** The file's absolute path after the Touch. */
  path: string
  /** Where a moved file was, as an absolute path; absent for any other Touch. */
  oldPath?: string
  /** The Turn the Touch happened in. */
  turn: number
  by: TouchBy
  /** The lines this Touch added and removed; null where the mod could not tell. */
  counts: { added: number; removed: number } | null
}

/** One shell command that changed files: the Touches it made follow it in the log. */
export type RanEntry = {
  type: 'ran'
  turn: number
  command: string
  files: number
  /** The agent id of the helper that ran the command; absent for a command of Claude's own loop. */
  helperId?: string
}

export type LogEntry = TouchEntry | RanEntry

/** What the user did to one line of a file from the pane, kept until their next message tells Claude. `line` counts from 1 as the file was after the edit (a deleted line: as it was before). */
export type EditNote = {
  /** The file's path relative to the project. */
  path: string
  line: number
  /** The line was changed, added or deleted. */
  kind: 'changed' | 'added' | 'deleted'
  /** The line before the edit; empty for an added line. */
  was: string
  /** The line after the edit; empty for a deleted line. */
  now: string
}

/** The box open under the acting form's selected line: a Comment box, or an Edit box holding the line's text when it was opened. */
export type LineBox = { kind: 'comment' } | { kind: 'edit'; original: string }

/** The acting form of an open file: the selected line (counted from 1; null before any press), the one box under it, and what a refused `Save` told the user under it. A box or a notice belongs to the selected line, so with no line there is neither. */
export type Acting =
  { line: null; box: null; notice: null } | { line: number; box: LineBox | null; notice: string | null }

/** What the Files pane shows: the tree, or the selected file's File view with the whole file or its diff. `isActing` says whether the acting form is on; `Read only` turns it off and keeps `acting`, so `Comment or edit` brings back the line and its box. */
export type FileViewValue = { kind: 'tree' } | { kind: 'file'; whole: boolean; isActing: boolean; acting: Acting }

declare module 'claude-code' {
  interface PluginState {
    desk: {
      line: Line | null
      isOpen: boolean
      /** The time the cache item counts from; only moves forward. Ticks every 30 seconds. */
      bandNow: number
      handoff: Handoff
      /** True from a Compact press until the compaction ends or is refused. */
      isCompacting: boolean
      side: Side
      /** True while the Band shows the Ask box under its two lines. */
      isSideOpen: boolean
      /** How many times the keyboard has moved out of the Band; the Ask box ends typing on each. */
      keyboardLeaves: number
      /** Null until the main thread's first reply. */
      cache: CacheSeen | null
      /** The Auto warm switch; off until first switched on. */
      autoWarm: AutoWarm
      agents: AgentRow[]
      /** Reports from agents whose spawn has not answered yet, kept until their card links or can never link. */
      early: EarlyReports
      /** The card whose brief is shown, by row id. */
      openAgent: string | null
      /** The time the cards count from; only moves forward. Ticks each second while any agent runs. */
      boardNow: number
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
      /** Each touched file's record so far, by absolute path. */
      records: Record<string, RecordEntry>
      /** True once the person has closed the pane; `/file-tracer` clears it. */
      closed: boolean
      /** The folders the person closed in the pane, by path relative to the session's directory. Folders start open. */
      closedFolders: string[]
      /** The groups the person closed in the pane: 'project', 'worktrees' and 'outside'. Groups start open. */
      closedGroups: string[]
      /** The row the person last clicked, by absolute path; null before any click. An earlier version saved it relative to the session's directory. */
      selected: string | null
      /** True while the person has chosen `Changed only`: the tree leaves out files that were only read. False or absent shows every touched file. */
      isChangedOnly: boolean
      /** What the Files pane shows: the tree, or the selected file's File view. `whole` is true while the Changes section shows the whole file in place of its diff. `acting` is the acting form (the whole-file text drawn one pressable row per line, so the person can pick a line to Comment on or Edit), null while it is off; `Read only` turns it off and forgets its line. In it, `line` is the line pressed last, counted from 1, null before any press; `box` is the one box open under that line, a Comment box or an Edit box holding the line's text when it was opened; `notice` is what a refused `Save` told the person under the line. A box and a notice belong to the selected line, so with no line there is neither. Opening a file starts a fresh File view; `‹ All files` returns to the tree. Absent, or not this shape, reads as the tree; a part that is not its shape reads as its default. */
      fileView: FileViewValue
      /** What a failed `Open in Files` told the person under the File view's buttons; null or absent while there is nothing to tell. Pressing `Open in Files` again and opening another file clear it. */
      filesNotice: string | null
      /** The comments the person attached to their next message, oldest first, each already in the shape Claude reads. The next prompt the user writes carries them, then none is left; `Discard` drops them. Absent, or anything but a list, reads as none; entries that are not text are left out. */
      attached: string[]
      /** What the person changed in files from the pane since their last message, oldest first. The next prompt the user writes carries them as a note each, then none is left. Several edits to one line are one note. Absent, or anything but a list, reads as none; entries of any other shape are left out. */
      notes: EditNote[]
      /** The older piece of the Touch log: Touches in session order, newest last. The log is this then `logTail`, read as the newest 2,000 entries. */
      log: LogEntry[]
      /** The newest entries of the Touch log, until there are enough to move into `log`; the Touch log is `log` then `logTail`. */
      logTail: LogEntry[]
      /** The Turns so far, oldest first: each prompt the user submitted, as its number and its first line cut to 80 characters. None before the first prompt, which reads as one Turn. */
      turns: Array<{ n: number; text: string }>
      /** The Turns the person closed in the Trail, by number. Turns start open. */
      closedTurns: number[]
      /** True while the person has chosen `Show Claude only` in the Trail: the helpers' boxes are left out. False or absent draws them. */
      isClaudeOnly: boolean
      /** The Touch the person pressed last in the Trail, by its number; null or absent before any press. */
      trailSelected: number | null
      /** The helpers Claude started, each by agent id with its type and description. */
      helpers: Array<{ id: string; type: string; description: string }>
      /** The Descriptions written so far, oldest first, each by the key of the file and content it describes. */
      descriptions: Array<{ key: string; text: string }>
    }
  }
}
