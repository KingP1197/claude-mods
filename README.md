# kp-mods

Two mods for [Claude Code](https://claude.com/claude-code).

- **desk-status** adds a band above the prompt. It shows your branch, your rate limits and a bar of how full the context window is, split by source. A Details list breaks the bar down. Buttons write a handoff note to your clipboard, compact the session, or ask a side question.
- **agent-board** opens a side panel with one card per subagent. Each card shows the agent's effort tier, model, to-do progress, share of the context window, tokens and running time. Click a card's name to see the agent's last three messages, send it a message, or stop it. The panel opens by itself when a batch of agents starts. `/agent-board` reopens it.

## Install

Type this at the prompt of a Claude Code session running in a terminal:

```
/plugin install desk-status --marketplace KingP1197/claude-mods
```

```
/plugin install agent-board --marketplace KingP1197/claude-mods
```

Answer `y` to add the marketplace, then pick a scope. The user scope makes the mod load in every new session.

The install command works only in a terminal. A mod installed there at the user scope also loads in the Claude desktop app's Code tab.

## Good to know

- Only one mod can draw above the prompt. If another installed mod also does, the two will clash.
- A message to a running agent goes straight into its conversation, without a permission check. The agent reads it as a plain user message.
- A message to a finished agent wakes it up through Claude Code's SendMessage tool. Auto mode may block that, and the card then says so. To send anyway, switch modes, or add `SendMessage` to the `permissions.allow` list in your settings. That rule lets every SendMessage through, including ones Claude sends on its own.
- Stop uses Claude Code's TaskStop tool. If auto mode or a permission rule blocks it, the card says to switch modes or add `TaskStop` to your allow list.
- Tested with Claude Code 2.1.296. Older versions may not support mods.

## Remove

```
/plugin uninstall desk-status
```

```
/plugin uninstall agent-board
```

## License

MIT. See [LICENSE](LICENSE).
