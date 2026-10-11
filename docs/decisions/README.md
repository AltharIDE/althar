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
| [004](004-coordinator-is-an-agent-session.md) | The coordinator is an agent session with Althar's tools |
| [005](005-althar-briefs-every-agent.md) | Althar briefs every agent, and a switch hands over everything |
| [006](006-worktree-per-task.md) | A git worktree per task |
| [007](007-permission-requests-reach-althar.md) | Every permission request reaches Althar |
| [008](008-shortcuts-in-behaviour-not-in-records.md) | Shortcuts in behaviour, never in recorded facts |
| [009](009-effect-on-the-runtime-side.md) | Effect on the runtime side |
| [010](010-desktop-app-mvvm.md) | The desktop app is MVVM, in feature folders |
| [011](011-own-connectors-for-hosts-and-trackers.md) | Althar's own connectors for code hosts and trackers |
| [012](012-several-accounts-per-agent.md) | Several accounts per agent, each in its own home |
| [013](013-project-rules.md) | Project rules: a mode, always ask, never, and command rules |
| [014](014-window-keeps-what-it-read.md) | The window keeps what it read, and a screen reads before it shows |
| [015](015-coordinator-picks-models.md) | The coordinator picks models; agents are only ways to them |
| [016](016-push-without-a-connection.md) | Pushing is git; a connection is what comes after |
| [017](017-dictation-on-this-machine.md) | Dictation runs on this machine, with a model downloaded on the first press |
| [018](018-allow-always-keeps-a-rule.md) | Allow always keeps a rule in the project |
| [019](019-coordinator-judges-permissions.md) | The coordinator judges permission requests in fresh read-only sessions |
| [020](020-what-agents-hand-back.md) | What agents hand back is kept in the artifact store, by digest |
| [021](021-a-question-outlives-its-session.md) | A question waits on the person, and outlives the agent that asked |
| [022](022-what-agents-leave-running.md) | What an agent leaves running is shown over the composer, and stops with its session |
| [023](023-althar-runs-the-project.md) | Althar runs the project itself, with no agent |
| [024](024-signed-releases-and-updates.md) | Signed releases on GitHub, and an app that updates itself |
| [025](025-new-project-in-its-own-tab.md) | A new project is made in a tab of its own, under the id the window gave it |
| [026](026-connecting-walks-the-person-in.md) | Connecting walks the person in, and says what the connection can do |
| [027](027-the-load-read-when-asked.md) | How hard the computer works is read by the runtime, only while a window shows it |
