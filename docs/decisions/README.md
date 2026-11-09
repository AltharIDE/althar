# Decisions

What Althar has decided, and why, one document per area. Each describes the
current state as built, keeps the reason for a decision where it still
matters, and says plainly what is decided but not built yet.

| Document | What it covers |
|---|---|
| [Foundations](foundations.md) | The Electron shell and the runtime, Effect, the desktop app's layers, how failures stay small, what CI gates, one feature for every host and agent, where the runtime runs |
| [Agents](agents.md) | ACP, which agents join, accounts, briefs and switching, how models are picked, keeping context small, plan usage and what a task used |
| [The coordinator](coordinator.md) | Always on, one pool of tools with leads, directing leads, its copies, its notes and handover, moving tasks, clearing its chat |
| [What agents may do](what-agents-may-do.md) | Allow everything, what asks, speaking for the person, the sandbox as the boundary, git's guard, the person's rules, the web, what stays and why |
| [The person's setup](the-persons-setup.md) | The person's MCP servers, skills and sign-in in every role; Althar ships no skills |
| [Tasks](tasks.md) | What a task is, its kinds and card, questions, rounds and shipping again, Needs you, the small-change lane, plan settings, what agents hand back |
| [Scheduling](scheduling.md) | Agents at once, what goes first, Running and Up next, lost connections, Althar's share of the load, automations |
| [Workspaces and runs](workspaces-and-runs.md) | Worktree or Local, the branch a task works toward, setup, cleaning folders away, Run, running any branch or pull request, what agents leave running |
| [Code hosts and trackers](code-hosts.md) | Connectors, connecting, pushing, attached pull requests, forks, conflicts and checks, acting on the host, merging, releases, trackers |
| [Reviews](reviews.md) | Who reviews and how, review after merge, others' pull requests, the seal, screenshots and Outputs |
| [The desktop app](desktop-app.md) | How the window reads, threads in rounds, what opens beside a conversation, dictation, themes, the window's frame, motion, the welcome |
| [Packaging](packaging.md) | Releases and updates, the Mac builds, Linux and Windows packages, the Flatpak, usage data, problem and crash reports |

## How the decision docs, the architecture docs and the notes divide

- **These documents say what is so and why.** The
  [architecture docs](../architecture/) say how it is built: processes,
  modules, data and protocols. Where one of them needs a rule, it links here
  rather than restating it.
- **The project's notes win.** The person's notes in Althar are current
  decisions. Where a document here disagrees with one, the note holds, and
  the document is wrong until it's fixed.
- **Open questions** are in [open-questions.md](../open-questions.md).

## Recording a decision

Edit the area document that holds it, so it keeps describing the current
state, and add a dated line to that document's **Changes** list at its foot.
There are no more numbered ADRs. A proposal that isn't decided yet lives in
[`proposed/`](proposed/) until it is, and then folds into its area document.

Proposals waiting now:

- [A task is a conversation plus parts, changeable at any time](proposed/a-task-is-a-conversation-plus-parts.md):
  the parts, as many changes and pull requests in a task as it needs, the
  workspace moving up, reviews that run code, talking to a lead as plain
  turns with a review only when the person ships, the review
  after a merge in the same task, chats on Scratch and presets. It would fold
  into [tasks](tasks.md), [workspaces and runs](workspaces-and-runs.md),
  [reviews](reviews.md), [code hosts](code-hosts.md), [agents](agents.md)
  and [what agents may do](what-agents-may-do.md).
- [ADR-087](proposed/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md):
  a lead's helpers.
- [ADR-103](proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md):
  projects on a host, and work placed across pools.
- [ADR-104](proposed/104-secrets.md): secrets, kept in one store with
  the project's home, each with a reach, and asked for on a card.

## The old ADRs

ADR-002 to ADR-102 were folded into the area documents and removed. The
documents hold what is current; git history keeps the old texts, last
under `docs/decisions/archive/` at commit `997f0e99b`. Two of the old ADRs,
ADR-087 and ADR-103, are still proposals in [`proposed/`](proposed/).

Code and older docs cite decisions as `ADR-NNN`. This table resolves each
one.

| ADR | What it decided | Now in |
|---|---|---|
| 001 | The repository-wide engineering target | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| 002 | ACP for every agent | [agents § ACP for every agent](agents.md#acp-for-every-agent) |
| 003 | Electron shell, with the runtime in a utility process | [foundations § The shell and the runtime](foundations.md#the-shell-and-the-runtime) |
| 004 | The coordinator is an agent session with Althar's tools | [coordinator § Always on](coordinator.md#always-on) |
| 005 | Althar briefs every agent, and a switch hands over everything | [agents § Briefs, and switching agent or model](agents.md#briefs-and-switching-agent-or-model) |
| 006 | A git worktree per task | [workspaces-and-runs § Worktree](workspaces-and-runs.md#worktree) |
| 007 | Every permission request reaches Althar | [what-agents-may-do § How a request reaches Althar](what-agents-may-do.md#how-a-request-reaches-althar) |
| 008 | Shortcuts in behaviour, never in recorded facts | [foundations § Recorded facts are complete; behaviour may start simple](foundations.md#recorded-facts-are-complete-behaviour-may-start-simple) |
| 009 | Effect on the runtime side | [foundations § Effect on the runtime side](foundations.md#effect-on-the-runtime-side) |
| 010 | The desktop app is MVVM, in feature folders | [foundations § The desktop app's layers](foundations.md#the-desktop-apps-layers) |
| 011 | Althar's own connectors for code hosts and trackers | [code-hosts § Connectors](code-hosts.md#connectors) |
| 012 | Several accounts per agent, each in its own home | [agents § Accounts](agents.md#accounts) |
| 013 | Project rules: a mode, always ask, never, and command rules | [what-agents-may-do § The person's rules](what-agents-may-do.md#the-persons-rules) |
| 014 | The window keeps what it read, and a screen reads before it shows | [desktop-app § How the window reads](desktop-app.md#how-the-window-reads) |
| 015 | The coordinator picks models; agents are only ways to them | [agents § How models are picked](agents.md#how-models-are-picked) |
| 016 | Pushing is git; a connection is what comes after | [code-hosts § Pushing a task's branch](code-hosts.md#pushing-a-tasks-branch) |
| 017 | Dictation runs on this machine, with a model downloaded on the first press | [desktop-app § Dictation](desktop-app.md#dictation) |
| 018 | Allow always keeps a rule in the project | [what-agents-may-do § The person's rules](what-agents-may-do.md#the-persons-rules) |
| 019 | The coordinator judges permission requests in fresh read-only sessions | [what-agents-may-do § Ask about more, and the coordinator decides](what-agents-may-do.md#ask-about-more-and-the-coordinator-decides) |
| 020 | What agents hand back is kept in the artifact store, by digest | [tasks § What agents hand back](tasks.md#what-agents-hand-back) |
| 021 | A question waits on the person, and outlives the agent that asked | [tasks § Questions to the person](tasks.md#questions-to-the-person) |
| 022 | What an agent leaves running is shown over the composer, and stops with its session | [workspaces-and-runs § What agents leave running](workspaces-and-runs.md#what-agents-leave-running) |
| 023 | Althar runs the project itself, with no agent | [workspaces-and-runs § Running the project](workspaces-and-runs.md#running-the-project) |
| 024 | Signed releases on GitHub, and an app that updates itself | [packaging § Releases](packaging.md#releases) |
| 025 | A new project is made in a tab of its own, under the id the window gave it | [desktop-app § A new project](desktop-app.md#a-new-project) |
| 026 | Connecting walks the person in, and says what the connection can do | [code-hosts § Connecting](code-hosts.md#connecting) |
| 027 | What the Flatpak reaches, and what it does not | [packaging § The Flatpak](packaging.md#the-flatpak) |
| 028 | Linux windows, packages and the keyring | [packaging § Off a Mac: windows and the keyring](packaging.md#off-a-mac-windows-and-the-keyring) |
| 029 | How hard the computer works is read by the runtime, only while a window shows it | [scheduling § Althar's share of the load](scheduling.md#althars-share-of-the-load) |
| 030 | Where the project says so, the lead resolves a conflict unasked, and Althar pushes the merge | [code-hosts § Conflicts](code-hosts.md#conflicts) |
| 031 | Althar hands the coordinator to a fresh session before its context fills, and keeps the project's notes | [coordinator § Handover before its context fills](coordinator.md#handover-before-its-context-fills) |
| 032 | A machine runs as many tasks' agents at once as its cores and memory allow, and the rest wait their turn | [scheduling § How many agents work at once](scheduling.md#how-many-agents-work-at-once) |
| 033 | The agent adapters run on a Node the app ships, and Althar's binary never runs as Node | [agents § The Node the adapters run on](agents.md#the-node-the-adapters-run-on) |
| 034 | A task goes back to work whenever its lead does, and ships again in a pull request of its own | [tasks § Rounds: back to work, and shipping again](tasks.md#rounds-back-to-work-and-shipping-again), [reviews § How a review round runs](reviews.md#how-a-review-round-runs) |
| 035 | A task's kind is read from what it has, and its card has nothing to press | [tasks § Kinds, read from what a task has](tasks.md#kinds-read-from-what-a-task-has), [reviews § Reviewing someone else's pull request](reviews.md#reviewing-someone-elses-pull-request) |
| 036 | Anonymous usage data goes from the main process, named events only | [packaging § Usage data](packaging.md#usage-data) |
| 037 | What the person does goes first, a task keeps its place between its steps, and new work waits | [scheduling § What goes first](scheduling.md#what-goes-first) |
| 038 | A task's lead starts afresh before its context grows large, and at a break in its work | [agents § Keeping context small](agents.md#keeping-context-small) |
| 039 | The person can have an agent compact its context, at once, with the agent's own command | [agents § Keeping context small](agents.md#keeping-context-small) |
| 040 | Until the person has looked, a change's checks are Althar's to see through | [code-hosts § Checks: Althar sees them through](code-hosts.md#checks-althar-sees-them-through) |
| 041 | What failed is said in full: a check run again once, its whole log on request, and the checks Althar can't see | [code-hosts § Checks: Althar sees them through](code-hosts.md#checks-althar-sees-them-through) |
| 042 | A task's thread reads in rounds: an ask, then what its lead says first, its work in a line, and what it says last | [desktop-app § A thread reads in rounds](desktop-app.md#a-thread-reads-in-rounds) |
| 043 | Allow everything is one switch, for a project or a task, apart from what the rest gets | [what-agents-may-do § What asks](what-agents-may-do.md#what-asks), [what-agents-may-do § Ask about more, and the coordinator decides](what-agents-may-do.md#ask-about-more-and-the-coordinator-decides) |
| 044 | A project runs many things, from a list with a default | [workspaces-and-runs § What a project runs](workspaces-and-runs.md#what-a-project-runs) |
| 045 | Problems are reported from the app, masked, through a Worker that makes Linear issues | [packaging § Problem reports](packaging.md#problem-reports) |
| 046 | Errors and crashes go to PostHog's error tracking from the main process, masked, behind a switch of their own; native minidumps stay on the computer | [packaging § Crash reports](packaging.md#crash-reports) |
| 047 | Failures are kept to what they belong to, and what Althar didn't expect is reported where it is kept | [foundations § Failures stay with what they belong to](foundations.md#failures-stay-with-what-they-belong-to) |
| 048 | The runtime stays in the app and runs headless too, and a client on the local socket can't answer for the person | [foundations § Where the runtime runs, and who may reach it](foundations.md#where-the-runtime-runs-and-who-may-reach-it) |
| 049 | The line up next is every task no agent has worked on yet, in the person's order | [scheduling § Running and Up next](scheduling.md#running-and-up-next) |
| 050 | An ACP agent joins where Althar can hold it to asking, and the rest wait with their reasons | [agents § Which agents join](agents.md#which-agents-join), [reviews § Reviewing someone else's pull request](reviews.md#reviewing-someone-elses-pull-request) |
| 051 | A finished task that isn't a change waits in Needs you until the person settles it | [tasks § Needs you and settling](tasks.md#needs-you-and-settling) |
| 052 | A task can be attached to an open pull request it didn't open, and follows it as one it opened | [code-hosts § Attaching a pull request a task didn't open](code-hosts.md#attaching-a-pull-request-a-task-didnt-open) |
| 053 | The code an agent names opens beside the conversation, read where the agent works, and never edited | [desktop-app § Code beside the conversation](desktop-app.md#code-beside-the-conversation) |
| 054 | A task's steps are a graph of its own face, in a lane for each agent, read from the runtime's runs | [desktop-app § The step graph](desktop-app.md#the-step-graph) |
| 055 | Althar is light, dark, or as the system is: one warm dark set of tokens, followed from nativeTheme | [desktop-app § Light and dark](desktop-app.md#light-and-dark) |
| 056 | A finished task's folder goes after a wait that suits how it ended, and comes back when the task needs it | [workspaces-and-runs § Finished tasks' folders](workspaces-and-runs.md#finished-tasks-folders) |
| 057 | A lead installs, runs the project, takes screenshots and runs checks again through Althar's tools, outside its sandbox; the coordinator takes screenshots too | [what-agents-may-do § Althar's tools outside the sandbox](what-agents-may-do.md#althars-tools-outside-the-sandbox) |
| 058 | The coordinator is a trusted reader, in copies of its own, held by a sandbox where it has one | [coordinator § Its copies of the repositories](coordinator.md#its-copies-of-the-repositories) |
| 059 | A tracker's workspaces are connected side by side, and a project may be bound to one | [code-hosts § Trackers](code-hosts.md#trackers) |
| 060 | A lost connection is waited out, and a failing service tried again, as a usage limit is held | [scheduling § A lost connection and a failing service](scheduling.md#a-lost-connection-and-a-failing-service) |
| 061 | Automations start ordinary tasks on a schedule: a kept request, and an occurrence for each time it was due, on this computer while Althar runs | [scheduling § Automations](scheduling.md#automations) |
| 062 | A usage read may use an account's own sign-in, once, for one call to its provider's usage URL, Anthropic's included | [agents § Reading plan usage](agents.md#reading-plan-usage) |
| 063 | Althar's part of the load is everything its work started, however it runs, and Althar itself | [scheduling § Althar's share of the load](scheduling.md#althars-share-of-the-load) |
| 064 | A file or folder sent with a message is copied into the thread's folder, which git ignores, and linked for the agent to open | [desktop-app § Files sent with a message](desktop-app.md#files-sent-with-a-message) |
| 065 | Running is what an agent works on now, and Up next is everything that waits, in the order it goes on | [scheduling § Running and Up next](scheduling.md#running-and-up-next) |
| 066 | Althar runs any branch or pull request in a copy of its own, fetched with its sign-in, and fetches for leads, which carry none | [workspaces-and-runs § Running a branch or a pull request](workspaces-and-runs.md#running-a-branch-or-a-pull-request) |
| 067 | Allow everything asks only before what can't be undone from the task | [what-agents-may-do § What asks](what-agents-may-do.md#what-asks) |
| 068 | A settled task stops everything it left running, however it settled, and what Althar lost track of is found by its mark | [workspaces-and-runs § Settling stops everything](workspaces-and-runs.md#settling-stops-everything) |
| 069 | Motion is one system, named by what happens, in CSS and the browser's own animations | [desktop-app § Motion](desktop-app.md#motion) |
| 070 | Failing checks go to the lead, whoever has looked, and it tells a failure of its own from one broken on main | [code-hosts § Checks: Althar sees them through](code-hosts.md#checks-althar-sees-them-through) |
| 071 | The sandbox is the boundary: what it holds runs unread, what crosses meets the rules, and git stops what can't be undone | [what-agents-may-do § The sandbox is the boundary](what-agents-may-do.md#the-sandbox-is-the-boundary), [what-agents-may-do § Git's guard](what-agents-may-do.md#gits-guard) |
| 072 | A lead's commits push as its turn ends, unless the project says otherwise, and wait for the person only where someone else pushed | [code-hosts § A lead's commits go up as its turn ends](code-hosts.md#a-leads-commits-go-up-as-its-turn-ends) |
| 073 | git over SSH in the Flatpak: Althar's own goes through the device's ssh, ssh in the sandbox trusts pinned code hosts, and nothing asks | [packaging § git over SSH in the Flatpak](packaging.md#git-over-ssh-in-the-flatpak) |
| 074 | CI gates a merge on Linux, and a release on everything: Windows, coverage and the packages after merge | [foundations § What CI gates](foundations.md#what-ci-gates) |
| 075 | An Intel Mac build beside Apple silicon's, each with only its own processor's binaries, in one update feed | [packaging § Two Mac builds, not one universal app](packaging.md#two-mac-builds-not-one-universal-app) |
| 076 | A pull request shows the review its change had, as a seal in its corner and the review folded at its end | [reviews § What a pull request shows of its review](reviews.md#what-a-pull-request-shows-of-its-review) |
| 077 | A task's screenshots go in one comment on its pull request, written anew as they change, by hand or by a project rule | [reviews § Screenshots on the pull request](reviews.md#screenshots-on-the-pull-request) |
| 078 | Project leads and their own reviewers can read the web, with a default-on project switch and outside reviews kept offline | [what-agents-may-do § The web](what-agents-may-do.md#the-web) |
| 079 | Outputs show the change as built: the lead marks options, a later round replaces earlier views, and a posted comment follows | [reviews § Outputs show the change as built](reviews.md#outputs-show-the-change-as-built) |
| 080 | A task folder's setup is recorded by a lead and replayed by Althar, and a lead's sandbox writes to its tools' caches | [workspaces-and-runs § Setting up a task's folder](workspaces-and-runs.md#setting-up-a-tasks-folder) |
| 081 | The coordinator, and a task's lead, do on the code host what the person's account can, short of four limits: what can't be undone waits for their word, a short never list stays theirs, a change to the code is a task, and nothing approves its own work; the coordinator runs merging and releases, and hears every pull request and main | [code-hosts § Acting on the host](code-hosts.md#acting-on-the-host), [code-hosts § Not built yet](code-hosts.md#not-built-yet) |
| 082 | A feature built for one code host, tracker or agent ships for every one that can have it, with Althar standing in or saying why | [foundations § A feature ships for every service that can have it](foundations.md#a-feature-ships-for-every-service-that-can-have-it) |
| 083 | A welcome on first launch: a short tour, then setup in steps, and a new project asks for its code host and a tracker | [desktop-app § The welcome](desktop-app.md#the-welcome) |
| 084 | What a task, or the coordinator's day, used is said per plan and per credit, as the share of a week or dollars, in the context ring and a Usage card in Outputs, with no total | [agents § What a task used](agents.md#what-a-task-used) |
| 085 | A fork's branches go upstream by a choice of the project's, offered once on what its host says; remotes are never rewritten, and open pull requests stay where they are | [code-hosts § A fork's branches](code-hosts.md#a-forks-branches) |
| 086 | The coordinator stops, holds, restarts and settles a task when the person's message in that turn asks, with a line in both threads; any other turn asks on a card, and discarding deletes nothing | [coordinator § Moving a task](coordinator.md#moving-a-task) |
| [087](proposed/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md) | A lead starts helpers on any agent, each in a copy of its own, and hears each one's result as a new turn | Proposed; would fold into [tasks § Helpers (proposed)](tasks.md#helpers-proposed) |
| 088 | The plan countdown, review rounds and new-project defaults are settings, read where they apply and seeding a project's first rules | [tasks § Plan and review settings](tasks.md#plan-and-review-settings) |
| 089 | The asks and refusals left once the sandbox is the boundary are what can't be undone: a crossing goes unread, a line is read from the shell's folder, and tearing down or publishing asks | [what-agents-may-do § Git's guard](what-agents-may-do.md#gits-guard) |
| 090 | Run opens its list, and runs where it is picked | [workspaces-and-runs § Run and where it runs](workspaces-and-runs.md#run-and-where-it-runs) |
| 091 | A task works Local, in the person's own checkout, one task at a time, or in a worktree of its own: a project default the coordinator overrides per task; Althar asks before switching a checkout and never stashes or resets it | [workspaces-and-runs § Local](workspaces-and-runs.md#local) |
| 092 | Conflicts and failed checks send a task back to work, one ask for both, on unless the person turned it off or stopped it; waiting on the person always says why | [code-hosts § Conflicts](code-hosts.md#conflicts) |
| 093 | A task works toward a branch, the project's Work toward or its own from its plan card: it starts there, its pull request goes there, and keeping it current, conflicts, checks, diffs and the push guard go by it; release branches are made and brought back on the person's word | [workspaces-and-runs § The branch a task works toward](workspaces-and-runs.md#the-branch-a-task-works-toward) |
| 094 | Skills are one store on the computer, of what the person added, given to each lead for its session (the curated catalog was dropped 8 Nov 2026) | [the-persons-setup § Skills](the-persons-setup.md#skills) |
| 095 | Skill and OpenSpec files stay off the repository unless the project says so, and a push is held back for them | [the-persons-setup § Skill and OpenSpec files in a change](the-persons-setup.md#skill-and-openspec-files-in-a-change) |
| 096 | Runs show in the pill over the composer again, in a task's and the coordinator's, in the row the lead's processes have; ADR-090's removal of it is reversed | [workspaces-and-runs § Where runs show](workspaces-and-runs.md#where-runs-show) |
| 097 | Agents work as the person's own: everything is allowed by default, their MCP servers, skills and sign-in in every role, and only what can't be undone asks; leads and the coordinator share one pool, the coordinator is always on with no way to turn it off, and tasks can also start without it | [what-agents-may-do § What asks](what-agents-may-do.md#what-asks), [the-persons-setup § In every role](the-persons-setup.md#in-every-role) |
| 098 | The window is dressed for the desktop it sits on, decided by Althar: the window manager's frame where it draws a good one (KWin, xfwm4, Marco, Openbox), the desktop's own buttons drawn where it expects client-side bars (GNOME), none on a tiling compositor; only gdbus, xprop and gsettings are run to tell | [desktop-app § The window on each desktop](desktop-app.md#the-window-on-each-desktop) |
| 099 | A turn at work is "Working for 8s", what the agent said on the way and one line for what it does now, replaced in place; it folds under "Worked for 19s ›" as it answers, its thinking only in the trail; streamed text comes at an even pace, its newest words fading in; in a task's thread a review is one line, the lead's latest handoff open under it | [desktop-app § A turn at work](desktop-app.md#a-turn-at-work) |
| 100 | A web page opens beside the conversation, in a session of its own for each task, where only web pages load, permissions and downloads are refused and sign-ins go to the person's browser; a comment pointed on it goes to the lead with what the person writes | [desktop-app § A web page beside the conversation](desktop-app.md#a-web-page-beside-the-conversation) |
| 101 | Clearing a coordinator's chat is one question with two kinds: clear only the view (a mark on the thread; the coordinator keeps the conversation; Show earlier and Undo) or forget the conversation too (the session ends and its messages are deleted); both keep what is still open and the project's records | [coordinator § Clearing its chat](coordinator.md#clearing-its-chat) |
| 102 | A change of a few lines is one step on a light model, starts at once, and is reviewed after it merges, with one card in its thread; Auto moves a lead to a lighter model of its agent as the plan runs out, with Keep for the task | [tasks § The small-change lane](tasks.md#the-small-change-lane), [reviews § A small change is reviewed after it merges](reviews.md#a-small-change-is-reviewed-after-it-merges) |
| [103](proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md) | A project's runtime and database live locally, on a personal host or on Althar hosting; automatic task placement uses its assigned worker pools, with SSH or Connect access, forwarded previews and explicit local test copies | Proposed; would fold into [foundations § Where the runtime runs, and who may reach it](foundations.md#where-the-runtime-runs-and-who-may-reach-it) |
| [104](proposed/104-secrets.md) | Secrets: one store with the project's home, sealed where it runs; a reach for each secret (agents' commands, Althar's runs only, Althar only); `.env` read in place, not copied; masking; agents ask on a card; stand-ins later | Proposed; would become `secrets.md` |
