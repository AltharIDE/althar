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
| [027](027-what-the-flatpak-reaches.md) | What the Flatpak reaches, and what it does not |
| [028](028-linux-windows-packages-and-the-keyring.md) | Linux windows, packages and the keyring |
| [029](029-the-load-read-when-asked.md) | How hard the computer works is read by the runtime, only while a window shows it |
| [030](030-the-lead-resolves-conflicts-and-althar-pushes-the-merge.md) | Where the project says so, the lead resolves a conflict unasked, and Althar pushes the merge |
| [031](031-coordinator-handed-over-before-it-fills.md) | Althar hands the coordinator to a fresh session before its context fills, and keeps the project's notes |
| [032](032-agents-at-once-on-this-machine.md) | A machine runs as many tasks' agents at once as its cores and memory allow, and the rest wait their turn |
| [033](033-adapters-on-a-node-of-their-own.md) | The agent adapters run on a Node the app ships, and Althar's binary never runs as Node |
| [034](034-a-task-goes-back-to-work-and-ships-again.md) | A task goes back to work whenever its lead does, and ships again in a pull request of its own |
| [035](035-a-task-s-kind-is-read-from-what-it-has.md) | A task's kind is read from what it has, and its card has nothing to press |
| [036](036-usage-data-from-the-main-process.md) | Anonymous usage data goes from the main process, named events only |
| [037](037-what-the-person-does-goes-first.md) | What the person does goes first, a task keeps its place between its steps, and new work waits |
| [038](038-a-lead-starts-afresh-at-a-break.md) | A task's lead starts afresh before its context grows large, and at a break in its work |
| [039](039-the-person-compacts-an-agent-s-context.md) | The person can have an agent compact its context, at once, with the agent's own command |
| [040](040-a-change-reaches-the-person-green.md) | Until the person has looked, a change's checks are Althar's to see through |
| [041](041-what-failed-said-in-full.md) | What failed is said in full: a check run again once, its whole log on request, and the checks Althar can't see |
| [042](042-a-task-s-thread-reads-in-rounds.md) | A task's thread reads in rounds: an ask, then what its lead says first, its work in a line, and what it says last |
| [043](043-allow-everything-is-one-switch-for-a-project-or-a-task.md) | Allow everything is one switch, for a project or a task, apart from what the rest gets |
| [044](044-a-project-runs-many-things.md) | A project runs many things, from a list with a default |
| [045](045-problem-reports.md) | Problems are reported from the app, masked, through a Worker that makes Linear issues |
| [046](046-crash-reports-to-posthog-from-main.md) | Errors and crashes go to PostHog's error tracking from the main process, masked, behind a switch of their own; native minidumps stay on the computer |
| [047](047-a-usage-read-may-use-an-accounts-token-once.md) | A usage read: an account's access token, in memory, for one call to its provider's usage URL |
