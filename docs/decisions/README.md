# Decisions

One architecture decision record (ADR) per file, numbered in order. An ADR
records context, the decision, the alternatives considered, the trade-off, an
owner, and when to revisit it. A superseded ADR stays, marked superseded.

ADR-001, the repository-wide engineering target, is recorded in
[`ARCHITECTURE.md`](../../ARCHITECTURE.md).

| ADR | Decision |
|---|---|
| [002](002-acp-for-every-agent.md) | ACP for every agent |
| [003](003-electron-shell.md) | Electron shell, with the runtime in a utility process |
| [004](004-coordinator-is-an-agent-session.md) | The coordinator is an agent session with Charrette's tools |
| [005](005-charrette-briefs-every-agent.md) | Charrette briefs every agent, and a switch hands over everything |
| [006](006-worktree-per-task.md) | A git worktree per task |
| [007](007-permission-requests-reach-charrette.md) | Every permission request reaches Charrette |
| [008](008-shortcuts-in-behaviour-not-in-records.md) | Shortcuts in behaviour, never in recorded facts |
| [009](009-effect-on-the-runtime-side.md) | Effect on the runtime side |
| [010](010-desktop-app-mvvm.md) | The desktop app is MVVM, in feature folders |
| [011](011-own-connectors-for-hosts-and-trackers.md) | Charrette's own connectors for code hosts and trackers |
| [012](012-several-accounts-per-agent.md) | Several accounts per agent, each in its own home |
