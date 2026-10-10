# kp-mods

Two mods for [Claude Code](https://claude.com/claude-code).

- **desk-status** adds a band above the prompt. It shows your branch, your rate limits and a bar of how full the context window is, split by source. A Details list breaks the bar down. Buttons write a handoff note to your clipboard, compact the session, or ask a side question.
- **agent-board** opens a side panel with one card per subagent. Each card shows the agent's effort tier, model, to-do progress, share of the context window, tokens and running time. The panel opens by itself when a batch of agents starts. `/agent-board` reopens it.

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
