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
| [The person's setup](the-persons-setup.md) | The person's MCP servers, skills and sign-in in every role, and the skill catalog |
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
  the parts, the workspace moving up, reviews that run code, the review after
  a merge in the same task, chats on Scratch and presets. It would fold into
  [tasks](tasks.md), [workspaces and runs](workspaces-and-runs.md) and
  [reviews](reviews.md).
- [ADR-087](proposed/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md):
  a lead's helpers.
- [ADR-103](proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md):
  projects on a host, and work placed across pools.

## The old ADRs

ADR-002 to ADR-102 are in [`archive/`](archive/), under their old file names.
Each starts with a line saying where its current state now lives. They are
the record of how each decision was reached; where an archived ADR and an
area document disagree, the document holds. Two of them, ADR-087 and
ADR-103, are still proposals, in [`proposed/`](proposed/).

Code and older docs cite decisions as `ADR-NNN`. This table resolves each
one.

| ADR | What it decided | Now in |
|---|---|---|
| 001 | The repository-wide engineering target | [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| [002](archive/002-acp-for-every-agent.md) | ACP for every agent | [agents § ACP for every agent](agents.md#acp-for-every-agent) |
| [003](archive/003-electron-shell.md) | Electron shell, with the runtime in a utility process | [foundations § The shell and the runtime](foundations.md#the-shell-and-the-runtime) |
| [004](archive/004-coordinator-is-an-agent-session.md) | The coordinator is an agent session with Althar's tools | [coordinator § Always on](coordinator.md#always-on) |
| [005](archive/005-althar-briefs-every-agent.md) | Althar briefs every agent, and a switch hands over everything | [agents § Briefs, and switching agent or model](agents.md#briefs-and-switching-agent-or-model) |
| [006](archive/006-worktree-per-task.md) | A git worktree per task | [workspaces-and-runs § Worktree](workspaces-and-runs.md#worktree) |
| [007](archive/007-permission-requests-reach-althar.md) | Every permission request reaches Althar | [what-agents-may-do § How a request reaches Althar](what-agents-may-do.md#how-a-request-reaches-althar) |
| [008](archive/008-shortcuts-in-behaviour-not-in-records.md) | Shortcuts in behaviour, never in recorded facts | [foundations § Recorded facts are complete; behaviour may start simple](foundations.md#recorded-facts-are-complete-behaviour-may-start-simple) |
| [009](archive/009-effect-on-the-runtime-side.md) | Effect on the runtime side | [foundations § Effect on the runtime side](foundations.md#effect-on-the-runtime-side) |
| [010](archive/010-desktop-app-mvvm.md) | The desktop app is MVVM, in feature folders | [foundations § The desktop app's layers](foundations.md#the-desktop-apps-layers) |
| [011](archive/011-own-connectors-for-hosts-and-trackers.md) | Althar's own connectors for code hosts and trackers | [code-hosts § Connectors](code-hosts.md#connectors) |
| [012](archive/012-several-accounts-per-agent.md) | Several accounts per agent, each in its own home | [agents § Accounts](agents.md#accounts) |
| [013](archive/013-project-rules.md) | Project rules: a mode, always ask, never, and command rules | [what-agents-may-do § The person's rules](what-agents-may-do.md#the-persons-rules) |
| [014](archive/014-window-keeps-what-it-read.md) | The window keeps what it read, and a screen reads before it shows | [desktop-app § How the window reads](desktop-app.md#how-the-window-reads) |
| [015](archive/015-coordinator-picks-models.md) | The coordinator picks models; agents are only ways to them | [agents § How models are picked](agents.md#how-models-are-picked) |
| [016](archive/016-push-without-a-connection.md) | Pushing is git; a connection is what comes after | [code-hosts § Pushing a task's branch](code-hosts.md#pushing-a-tasks-branch) |
| [017](archive/017-dictation-on-this-machine.md) | Dictation runs on this machine, with a model downloaded on the first press | [desktop-app § Dictation](desktop-app.md#dictation) |
| [018](archive/018-allow-always-keeps-a-rule.md) | Allow always keeps a rule in the project | [what-agents-may-do § The person's rules](what-agents-may-do.md#the-persons-rules) |
| [019](archive/019-coordinator-judges-permissions.md) | The coordinator judges permission requests in fresh read-only sessions | [what-agents-may-do § Ask about more, and the coordinator decides](what-agents-may-do.md#ask-about-more-and-the-coordinator-decides) |
| [020](archive/020-what-agents-hand-back.md) | What agents hand back is kept in the artifact store, by digest | [tasks § What agents hand back](tasks.md#what-agents-hand-back) |
| [021](archive/021-a-question-outlives-its-session.md) | A question waits on the person, and outlives the agent that asked | [tasks § Questions to the person](tasks.md#questions-to-the-person) |
| [022](archive/022-what-agents-leave-running.md) | What an agent leaves running is shown over the composer, and stops with its session | [workspaces-and-runs § What agents leave running](workspaces-and-runs.md#what-agents-leave-running) |
| [023](archive/023-althar-runs-the-project.md) | Althar runs the project itself, with no agent | [workspaces-and-runs § Running the project](workspaces-and-runs.md#running-the-project) |
| [024](archive/024-signed-releases-and-updates.md) | Signed releases on GitHub, and an app that updates itself | [packaging § Releases](packaging.md#releases) |
| [025](archive/025-new-project-in-its-own-tab.md) | A new project is made in a tab of its own, under the id the window gave it | [desktop-app § A new project](desktop-app.md#a-new-project) |
| [026](archive/026-connecting-walks-the-person-in.md) | Connecting walks the person in, and says what the connection can do | [code-hosts § Connecting](code-hosts.md#connecting) |
| [027](archive/027-what-the-flatpak-reaches.md) | What the Flatpak reaches, and what it does not | [packaging § The Flatpak](packaging.md#the-flatpak) |
| [028](archive/028-linux-windows-packages-and-the-keyring.md) | Linux windows, packages and the keyring | [packaging § Off a Mac: windows and the keyring](packaging.md#off-a-mac-windows-and-the-keyring) |
| [029](archive/029-the-load-read-when-asked.md) | How hard the computer works is read by the runtime, only while a window shows it | [scheduling § Althar's share of the load](scheduling.md#althars-share-of-the-load) |
| [030](archive/030-the-lead-resolves-conflicts-and-althar-pushes-the-merge.md) | Where the project says so, the lead resolves a conflict unasked, and Althar pushes the merge | [code-hosts § Conflicts](code-hosts.md#conflicts) |
| [031](archive/031-coordinator-handed-over-before-it-fills.md) | Althar hands the coordinator to a fresh session before its context fills, and keeps the project's notes | [coordinator § Handover before its context fills](coordinator.md#handover-before-its-context-fills) |
| [032](archive/032-agents-at-once-on-this-machine.md) | A machine runs as many tasks' agents at once as its cores and memory allow, and the rest wait their turn | [scheduling § How many agents work at once](scheduling.md#how-many-agents-work-at-once) |
| [033](archive/033-adapters-on-a-node-of-their-own.md) | The agent adapters run on a Node the app ships, and Althar's binary never runs as Node | [agents § The Node the adapters run on](agents.md#the-node-the-adapters-run-on) |
| [034](archive/034-a-task-goes-back-to-work-and-ships-again.md) | A task goes back to work whenever its lead does, and ships again in a pull request of its own | [tasks § Rounds: back to work, and shipping again](tasks.md#rounds-back-to-work-and-shipping-again), [reviews § How a review round runs](reviews.md#how-a-review-round-runs) |
| [035](archive/035-a-task-s-kind-is-read-from-what-it-has.md) | A task's kind is read from what it has, and its card has nothing to press | [tasks § Kinds, read from what a task has](tasks.md#kinds-read-from-what-a-task-has), [reviews § Reviewing someone else's pull request](reviews.md#reviewing-someone-elses-pull-request) |
| [036](archive/036-usage-data-from-the-main-process.md) | Anonymous usage data goes from the main process, named events only | [packaging § Usage data](packaging.md#usage-data) |
| [037](archive/037-what-the-person-does-goes-first.md) | What the person does goes first, a task keeps its place between its steps, and new work waits | [scheduling § What goes first](scheduling.md#what-goes-first) |
| [038](archive/038-a-lead-starts-afresh-at-a-break.md) | A task's lead starts afresh before its context grows large, and at a break in its work | [agents § Keeping context small](agents.md#keeping-context-small) |
| [039](archive/039-the-person-compacts-an-agent-s-context.md) | The person can have an agent compact its context, at once, with the agent's own command | [agents § Keeping context small](agents.md#keeping-context-small) |
| [040](archive/040-a-change-reaches-the-person-green.md) | Until the person has looked, a change's checks are Althar's to see through | [code-hosts § Checks: Althar sees them through](code-hosts.md#checks-althar-sees-them-through) |
| [041](archive/041-what-failed-said-in-full.md) | What failed is said in full: a check run again once, its whole log on request, and the checks Althar can't see | [code-hosts § Checks: Althar sees them through](code-hosts.md#checks-althar-sees-them-through) |
| [042](archive/042-a-task-s-thread-reads-in-rounds.md) | A task's thread reads in rounds: an ask, then what its lead says first, its work in a line, and what it says last | [desktop-app § A thread reads in rounds](desktop-app.md#a-thread-reads-in-rounds) |
| [043](archive/043-allow-everything-is-one-switch-for-a-project-or-a-task.md) | Allow everything is one switch, for a project or a task, apart from what the rest gets | [what-agents-may-do § What asks](what-agents-may-do.md#what-asks), [what-agents-may-do § Ask about more, and the coordinator decides](what-agents-may-do.md#ask-about-more-and-the-coordinator-decides) |
| [044](archive/044-a-project-runs-many-things.md) | A project runs many things, from a list with a default | [workspaces-and-runs § What a project runs](workspaces-and-runs.md#what-a-project-runs) |
| [045](archive/045-problem-reports.md) | Problems are reported from the app, masked, through a Worker that makes Linear issues | [packaging § Problem reports](packaging.md#problem-reports) |
| [046](archive/046-crash-reports-to-posthog-from-main.md) | Errors and crashes go to PostHog's error tracking from the main process, masked, behind a switch of their own; native minidumps stay on the computer | [packaging § Crash reports](packaging.md#crash-reports) |
| [047](archive/047-failures-kept-where-they-belong-and-reported-at-the-edge.md) | Failures are kept to what they belong to, and what Althar didn't expect is reported where it is kept | [foundations § Failures stay with what they belong to](foundations.md#failures-stay-with-what-they-belong-to) |
| [048](archive/048-where-the-runtime-runs-and-who-may-reach-it.md) | The runtime stays in the app and runs headless too, and a client on the local socket can't answer for the person | [foundations § Where the runtime runs, and who may reach it](foundations.md#where-the-runtime-runs-and-who-may-reach-it) |
| [049](archive/049-the-line-up-next-is-in-the-person-s-order.md) | The line up next is every task no agent has worked on yet, in the person's order | [scheduling § Running and Up next](scheduling.md#running-and-up-next) |
| [050](archive/050-an-agent-joins-where-althar-can-hold-it-to-asking.md) | An ACP agent joins where Althar can hold it to asking, and the rest wait with their reasons | [agents § Which agents join](agents.md#which-agents-join), [reviews § Reviewing someone else's pull request](reviews.md#reviewing-someone-elses-pull-request) |
| [051](archive/051-a-finished-task-waits-for-the-person-to-settle-it.md) | A finished task that isn't a change waits in Needs you until the person settles it | [tasks § Needs you and settling](tasks.md#needs-you-and-settling) |
| [052](archive/052-a-task-attaches-to-a-pull-request-it-didn-t-open.md) | A task can be attached to an open pull request it didn't open, and follows it as one it opened | [code-hosts § Attaching a pull request a task didn't open](code-hosts.md#attaching-a-pull-request-a-task-didnt-open) |
| [053](archive/053-the-code-an-agent-names-opens-beside-the-conversation.md) | The code an agent names opens beside the conversation, read where the agent works, and never edited | [desktop-app § Code beside the conversation](desktop-app.md#code-beside-the-conversation) |
| [054](archive/054-a-task-s-steps-are-a-graph-in-a-lane-for-each-agent.md) | A task's steps are a graph of its own face, in a lane for each agent, read from the runtime's runs | [desktop-app § The step graph](desktop-app.md#the-step-graph) |
| [055](archive/055-light-dark-or-as-the-system-is.md) | Althar is light, dark, or as the system is: one warm dark set of tokens, followed from nativeTheme | [desktop-app § Light and dark](desktop-app.md#light-and-dark) |
| [056](archive/056-a-finished-task-s-folder-goes-after-a-wait-and-comes-back-when-needed.md) | A finished task's folder goes after a wait that suits how it ended, and comes back when the task needs it | [workspaces-and-runs § Finished tasks' folders](workspaces-and-runs.md#finished-tasks-folders) |
| [057](archive/057-a-lead-works-outside-its-sandbox-through-althar-s-tools.md) | A lead installs, runs the project, takes screenshots and runs checks again through Althar's tools, outside its sandbox; the coordinator takes screenshots too | [what-agents-may-do § Althar's tools outside the sandbox](what-agents-may-do.md#althars-tools-outside-the-sandbox) |
| [058](archive/058-the-coordinator-is-a-trusted-reader-in-copies-of-its-own.md) | The coordinator is a trusted reader, in copies of its own, held by a sandbox where it has one | [coordinator § Its copies of the repositories](coordinator.md#its-copies-of-the-repositories) |
| [059](archive/059-a-tracker-s-workspaces-side-by-side-and-a-project-bound-to-one.md) | A tracker's workspaces are connected side by side, and a project may be bound to one | [code-hosts § Trackers](code-hosts.md#trackers) |
| [060](archive/060-a-lost-connection-is-waited-out-and-a-failing-service-tried-again.md) | A lost connection is waited out, and a failing service tried again, as a usage limit is held | [scheduling § A lost connection and a failing service](scheduling.md#a-lost-connection-and-a-failing-service) |
| [061](archive/061-automations-start-ordinary-tasks-on-a-schedule.md) | Automations start ordinary tasks on a schedule: a kept request, and an occurrence for each time it was due, on this computer while Althar runs | [scheduling § Automations](scheduling.md#automations) |
| [062](archive/062-a-usage-read-may-use-an-account-s-own-sign-in-once.md) | A usage read may use an account's own sign-in, once, for one call to its provider's usage URL, Anthropic's included | [agents § Reading plan usage](agents.md#reading-plan-usage) |
| [063](archive/063-althar-s-part-is-all-its-work-started-and-itself.md) | Althar's part of the load is everything its work started, however it runs, and Althar itself | [scheduling § Althar's share of the load](scheduling.md#althars-share-of-the-load) |
| [064](archive/064-a-file-sent-with-a-message-is-copied-where-the-agent-reads-and-linked.md) | A file or folder sent with a message is copied into the thread's folder, which git ignores, and linked for the agent to open | [desktop-app § Files sent with a message](desktop-app.md#files-sent-with-a-message) |
| [065](archive/065-running-is-what-an-agent-works-on-and-up-next-is-everything-that-waits.md) | Running is what an agent works on now, and Up next is everything that waits, in the order it goes on | [scheduling § Running and Up next](scheduling.md#running-and-up-next) |
| [066](archive/066-althar-runs-any-branch-or-pull-request-and-fetches-for-leads.md) | Althar runs any branch or pull request in a copy of its own, fetched with its sign-in, and fetches for leads, which carry none | [workspaces-and-runs § Running a branch or a pull request](workspaces-and-runs.md#running-a-branch-or-a-pull-request) |
| [067](archive/067-allow-everything-asks-only-before-what-can-t-be-undone.md) | Allow everything asks only before what can't be undone from the task | [what-agents-may-do § What asks](what-agents-may-do.md#what-asks) |
| [068](archive/068-a-settled-task-stops-everything-it-left-running.md) | A settled task stops everything it left running, however it settled, and what Althar lost track of is found by its mark | [workspaces-and-runs § Settling stops everything](workspaces-and-runs.md#settling-stops-everything) |
| [069](archive/069-motion-is-one-system-named-by-what-happens.md) | Motion is one system, named by what happens, in CSS and the browser's own animations | [desktop-app § Motion](desktop-app.md#motion) |
| [070](archive/070-failing-checks-go-to-the-lead-whoever-has-looked.md) | Failing checks go to the lead, whoever has looked, and it tells a failure of its own from one broken on main | [code-hosts § Checks: Althar sees them through](code-hosts.md#checks-althar-sees-them-through) |
| [071](archive/071-the-sandbox-is-the-boundary-anything-inside-it-runs.md) | The sandbox is the boundary: what it holds runs unread, what crosses meets the rules, and git stops what can't be undone | [what-agents-may-do § The sandbox is the boundary](what-agents-may-do.md#the-sandbox-is-the-boundary), [what-agents-may-do § Git's guard](what-agents-may-do.md#gits-guard) |
| [072](archive/072-a-lead-s-commits-push-as-its-turn-ends.md) | A lead's commits push as its turn ends, unless the project says otherwise, and wait for the person only where someone else pushed | [code-hosts § A lead's commits go up as its turn ends](code-hosts.md#a-leads-commits-go-up-as-its-turn-ends) |
| [073](archive/073-git-over-ssh-in-the-flatpak-goes-through-the-device.md) | git over SSH in the Flatpak: Althar's own goes through the device's ssh, ssh in the sandbox trusts pinned code hosts, and nothing asks | [packaging § git over SSH in the Flatpak](packaging.md#git-over-ssh-in-the-flatpak) |
| [074](archive/074-ci-gates-a-merge-on-linux-and-a-release-on-everything.md) | CI gates a merge on Linux, and a release on everything: Windows, coverage and the packages after merge | [foundations § What CI gates](foundations.md#what-ci-gates) |
| [075](archive/075-an-intel-mac-build-beside-apple-silicon.md) | An Intel Mac build beside Apple silicon's, each with only its own processor's binaries, in one update feed | [packaging § Two Mac builds, not one universal app](packaging.md#two-mac-builds-not-one-universal-app) |
| [076](archive/076-a-pull-request-shows-the-review-its-change-had.md) | A pull request shows the review its change had, as a seal in its corner and the review folded at its end | [reviews § What a pull request shows of its review](reviews.md#what-a-pull-request-shows-of-its-review) |
| [077](archive/077-a-task-s-screenshots-go-in-one-comment-on-its-pull-request.md) | A task's screenshots go in one comment on its pull request, written anew as they change, by hand or by a project rule | [reviews § Screenshots on the pull request](reviews.md#screenshots-on-the-pull-request) |
| [078](archive/078-project-leads-can-read-the-web.md) | Project leads and their own reviewers can read the web, with a default-on project switch and outside reviews kept offline | [what-agents-may-do § The web](what-agents-may-do.md#the-web) |
| [079](archive/079-outputs-show-the-change-as-built.md) | Outputs show the change as built: the lead marks options, a later round replaces earlier views, and a posted comment follows | [reviews § Outputs show the change as built](reviews.md#outputs-show-the-change-as-built) |
| [080](archive/080-a-task-folder-s-setup-is-recorded-by-a-lead-and-replayed.md) | A task folder's setup is recorded by a lead and replayed by Althar, and a lead's sandbox writes to its tools' caches | [workspaces-and-runs § Setting up a task's folder](workspaces-and-runs.md#setting-up-a-tasks-folder) |
| [081](archive/081-the-coordinator-acts-on-the-code-host-as-the-person-s-account-can.md) | The coordinator, and a task's lead, do on the code host what the person's account can, short of four limits: what can't be undone waits for their word, a short never list stays theirs, a change to the code is a task, and nothing approves its own work; the coordinator runs merging and releases, and hears every pull request and main | [code-hosts § Acting on the host](code-hosts.md#acting-on-the-host), [code-hosts § Not built yet](code-hosts.md#not-built-yet) |
| [082](archive/082-a-feature-for-one-host-tracker-or-agent-ships-for-all.md) | A feature built for one code host, tracker or agent ships for every one that can have it, with Althar standing in or saying why | [foundations § A feature ships for every service that can have it](foundations.md#a-feature-ships-for-every-service-that-can-have-it) |
| [083](archive/083-a-welcome-on-first-launch.md) | A welcome on first launch: a short tour, then setup in steps, and a new project asks for its code host and a tracker | [desktop-app § The welcome](desktop-app.md#the-welcome) |
| [084](archive/084-what-a-task-used-of-each-plan-and-credit.md) | What a task, or the coordinator's day, used is said per plan and per credit, as the share of a week or dollars, in the context ring and a Usage card in Outputs, with no total | [agents § What a task used](agents.md#what-a-task-used) |
| [085](archive/085-a-fork-s-branches-go-upstream-by-a-per-project-choice.md) | A fork's branches go upstream by a choice of the project's, offered once on what its host says; remotes are never rewritten, and open pull requests stay where they are | [code-hosts § A fork's branches](code-hosts.md#a-forks-branches) |
| [086](archive/086-the-coordinator-moves-a-task-on-the-person-s-word-or-asks-on-a-card.md) | The coordinator stops, holds, restarts and settles a task when the person's message in that turn asks, with a line in both threads; any other turn asks on a card, and discarding deletes nothing | [coordinator § Moving a task](coordinator.md#moving-a-task) |
| [087](proposed/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md) | A lead starts helpers on any agent, each in a copy of its own, and hears each one's result as a new turn | Proposed; would fold into [tasks § Helpers (proposed)](tasks.md#helpers-proposed) |
| [088](archive/088-plan-countdown-review-rounds-and-new-project-defaults-are-settings.md) | The plan countdown, review rounds and new-project defaults are settings, read where they apply and seeding a project's first rules | [tasks § Plan and review settings](tasks.md#plan-and-review-settings) |
| [089](archive/089-the-asks-and-refusals-left-are-what-can-t-be-undone.md) | The asks and refusals left once the sandbox is the boundary are what can't be undone: a crossing goes unread, a line is read from the shell's folder, and tearing down or publishing asks | [what-agents-may-do § Git's guard](what-agents-may-do.md#gits-guard) |
| [090](archive/090-run-opens-its-list-and-runs-where-it-is-picked.md) | Run opens its list, and runs where it is picked | [workspaces-and-runs § Run and where it runs](workspaces-and-runs.md#run-and-where-it-runs) |
| [091](archive/091-a-task-works-local-in-the-person-s-checkout-or-in-a-worktree.md) | A task works Local, in the person's own checkout, one task at a time, or in a worktree of its own: a project default the coordinator overrides per task; Althar asks before switching a checkout and never stashes or resets it | [workspaces-and-runs § Local](workspaces-and-runs.md#local) |
| [092](archive/092-conflicts-and-failed-checks-send-a-task-back-to-work.md) | Conflicts and failed checks send a task back to work, one ask for both, on unless the person turned it off or stopped it; waiting on the person always says why | [code-hosts § Conflicts](code-hosts.md#conflicts) |
| [093](archive/093-a-task-works-toward-the-project-s-branch-or-its-own.md) | A task works toward a branch, the project's Work toward or its own from its plan card: it starts there, its pull request goes there, and keeping it current, conflicts, checks, diffs and the push guard go by it; release branches are made and brought back on the person's word | [workspaces-and-runs § The branch a task works toward](workspaces-and-runs.md#the-branch-a-task-works-toward) |
| [094](archive/094-skills-one-store-a-curated-catalog.md) | Skills are one store on the computer, from a curated catalog, given to each lead for its session | [the-persons-setup § Skills](the-persons-setup.md#skills) |
| [095](archive/095-skill-and-openspec-files-stay-off-the-repository.md) | Skill and OpenSpec files stay off the repository unless the project says so, and a push is held back for them | [the-persons-setup § Skill and OpenSpec files in a change](the-persons-setup.md#skill-and-openspec-files-in-a-change) |
| [096](archive/096-runs-show-in-the-pill-over-the-composer-again.md) | Runs show in the pill over the composer again, in a task's and the coordinator's, in the row the lead's processes have; ADR-090's removal of it is reversed | [workspaces-and-runs § Where runs show](workspaces-and-runs.md#where-runs-show) |
| [097](archive/097-agents-work-as-the-person-s-own-and-only-what-can-t-be-undone-asks.md) | Agents work as the person's own: everything is allowed by default, their MCP servers, skills and sign-in in every role, and only what can't be undone asks; leads and the coordinator share one pool, the coordinator is always on with no way to turn it off, and tasks can also start without it | [what-agents-may-do § What asks](what-agents-may-do.md#what-asks), [the-persons-setup § In every role](the-persons-setup.md#in-every-role) |
| [098](archive/098-the-window-is-dressed-for-the-desktop-it-sits-on.md) | The window is dressed for the desktop it sits on, decided by Althar: the window manager's frame where it draws a good one (KWin, xfwm4, Marco, Openbox), the desktop's own buttons drawn where it expects client-side bars (GNOME), none on a tiling compositor; only gdbus, xprop and gsettings are run to tell | [desktop-app § The window on each desktop](desktop-app.md#the-window-on-each-desktop) |
| [099](archive/099-a-turn-s-work-is-one-live-line-then-folds-reviews-are-a-line.md) | A turn at work is "Working for 8s", what the agent said on the way and one line for what it does now, replaced in place; it folds under "Worked for 19s ›" as it answers, its thinking only in the trail; streamed text comes at an even pace, its newest words fading in; in a task's thread a review is one line, the lead's latest handoff open under it | [desktop-app § A turn at work](desktop-app.md#a-turn-at-work) |
| [100](archive/100-a-web-page-opens-beside-the-conversation-in-a-session-of-its-own.md) | A web page opens beside the conversation, in a session of its own for each task, where only web pages load, permissions and downloads are refused and sign-ins go to the person's browser; a comment pointed on it goes to the lead with what the person writes | [desktop-app § A web page beside the conversation](desktop-app.md#a-web-page-beside-the-conversation) |
| [101](archive/101-clearing-a-coordinator-chat-clears-the-view-or-forgets-the-conversation.md) | Clearing a coordinator's chat is one question with two kinds: clear only the view (a mark on the thread; the coordinator keeps the conversation; Show earlier and Undo) or forget the conversation too (the session ends and its messages are deleted); both keep what is still open and the project's records | [coordinator § Clearing its chat](coordinator.md#clearing-its-chat) |
| [102](archive/102-a-small-change-is-one-step-reviewed-after-merge-and-auto-moves-to-a-lighter-model.md) | A change of a few lines is one step on a light model, starts at once, and is reviewed after it merges, with one card in its thread; Auto moves a lead to a lighter model of its agent as the plan runs out, with Keep for the task | [tasks § The small-change lane](tasks.md#the-small-change-lane), [reviews § A small change is reviewed after it merges](reviews.md#a-small-change-is-reviewed-after-it-merges) |
| [103](proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md) | A project's runtime and database live locally, on a personal host or on Althar hosting; automatic task placement uses its assigned worker pools, with SSH or Connect access, forwarded previews and explicit local test copies | Proposed; would fold into [foundations § Where the runtime runs, and who may reach it](foundations.md#where-the-runtime-runs-and-who-may-reach-it) |
