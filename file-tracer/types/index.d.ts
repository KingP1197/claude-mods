/** The biggest thing done to a file, from biggest down: Deleted, Created, Moved, Edited, Read. */
export type Tag = 'Deleted' | 'Created' | 'Moved' | 'Edited' | 'Read'

/** What a record keeps of one touched file. */
export type RecordEntry = {
  /** The biggest thing done to the file so far. */
  tag: Tag
  /** True from a Touch until the person's next prompt; drawn as a dot. */
  isRecent: boolean
  /** Counts the touches: the file's latest touch took the number after the highest one before it. Bigger is newer; 0 for a file saved before the count. */
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

/** A record as an older version of the mod may have saved it: the first version saved the bare Tag, later ones may lack fields. */
export type SavedEntry = Tag | (Pick<RecordEntry, 'tag'> & Partial<RecordEntry>)

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

declare module 'claude-code' {
  interface PluginState {
    'file-tracer': {
      /** Each touched file's record so far, by absolute path. */
      records: Record<string, SavedEntry>
      /** Where an older version saved the records. Read while `records` is empty, never written; absent in a session that never had it. */
      trail: Record<string, SavedEntry>
      /** True once the person has closed the pane; `/file-tracer` clears it. */
      closed: boolean
      /** The folders the person closed in the pane, by path relative to the session's directory. Folders start open. */
      closedFolders: string[]
      /** The groups the person closed in the pane: 'project', 'worktrees' and 'outside'. Groups start open. */
      closedGroups: string[]
      /** The row the person last clicked, by absolute path; null before any click. An earlier version saved it relative to the session's directory. */
      selected: string | null
      /** True while the person has chosen `Show changed only`: the tree leaves out files that were only read. False or absent shows every touched file. */
      isChangedOnly: boolean
      /** True while the person has the selected file's File view open in place of the tree; `‹ All files` clears it. False or absent shows the tree. */
      isFileOpen: boolean
      /** True while the open file's Changes section shows the whole file in place of its diff. False or absent shows the diff. */
      isWholeFile: boolean
      /** True while the open file's whole-file text is drawn one pressable row per line (the acting form) in place of the code view; `Read only` clears it. False or absent shows the code view. Opening another file clears it. */
      isActing: boolean
      /** The line of the acting form the person pressed last, counted from 1, with `Comment` and `Edit` drawn under it; null or absent before any press. A value that is not a whole number from 1 up reads as none. Opening another file clears it. */
      selectedLine: number | null
      /** The line the open Comment box belongs to, counted from 1; null or absent while no box is open. The box shows only under the selected line, so a value that is not the selected line, or not a whole number from 1 up, reads as no box. Opening another file, choosing another line, `Cancel`, `Send`, `Attach` and the keyboard leaving the pane clear it. */
      commentLine: number | null
      /** The line the open Edit box belongs to, counted from 1, and the text of the line when the box was opened; null or absent while no Edit box is open. Like the Comment box it shows only under the selected line, so a line that is not the selected one, or anything that is not this shape, reads as no box. Opening another file, choosing another line, `Cancel`, `Save` and the keyboard leaving the pane clear it. */
      editBox: { line: number; original: string } | null
      /** What a refused `Save` told the person under the selected line; null or absent while there is nothing to tell. Opening another file, choosing another line, opening a box, `Cancel` and the keyboard leaving the pane clear it. */
      notice: string | null
      /** What a failed `Open in Files` told the person under the File view's buttons; null or absent while there is nothing to tell. Pressing `Open in Files` again and opening another file clear it. */
      filesNotice: string | null
      /** The comments the person attached to their next message, oldest first, each already in the shape Claude reads. The next prompt the user writes carries them, then none is left; `Discard` drops them. Absent, or anything but a list, reads as none; entries that are not text are left out. */
      attached: string[]
      /** What the person changed in files from the pane since their last message, oldest first. The next prompt the user writes carries them as a note each, then none is left. Several edits to one line are one note. Absent, or anything but a list, reads as none; entries of any other shape are left out. */
      notes: EditNote[]
      /** True while the person has the pane minimized to its strip; false or absent shows the full pane. */
      minimized: boolean
      /** The older piece of the Touch log: Touches in session order, newest last. The log is this then `logTail`, read as the newest 2,000 entries. Absent in a state from the first version. */
      log: LogEntry[]
      /** The newest entries of the Touch log, until there are enough to move into `log`; the Touch log is `log` then `logTail`. Absent in a state from before the split, which reads as none. */
      logTail: LogEntry[]
      /** The Turns so far, oldest first: each prompt the user submitted, as its number and its first line cut to 80 characters. Absent in a state from the first version, which reads as one Turn. */
      turns: Array<{ n: number; text: string }>
      /** The Turns the person closed in the Trail, by number. Turns start open; absent in a state from before the Trail. */
      closedTurns: number[]
      /** True while the person has chosen `Show Claude only` in the Trail: the helpers' boxes are left out. False or absent draws them. */
      isClaudeOnly: boolean
      /** The Touch the person pressed last in the Trail, by its number; null or absent before any press. */
      trailSelected: number | null
      /** The helpers Claude started, each by agent id with its type and description. Absent in a state from the first version. */
      helpers: Array<{ id: string; type: string; description: string }>
      /** The Descriptions written so far, oldest first, each by the key of the file and content it describes. */
      descriptions: Array<{ key: string; text: string }>
    }
  }
}
