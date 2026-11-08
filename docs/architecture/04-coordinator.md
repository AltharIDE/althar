# Coordinator

## Decision

Each project has a coordinator: the agent you talk to about the project as a
whole. It plans work, hands it out and directs the leads. It never writes
code. It is always on: there is no switch, setting or mode to turn it off. A
task can also start from the board, the composer or a
lead, and the coordinator stays the place for triage, routing, launching a
batch from the tracker, and merging ([ADR-097](../decisions/097-agents-work-as-the-person-s-own-and-only-what-can-t-be-undone-asks.md)).

> The coordinator is an ordinary agent session with Althar's tools and
> read-only access to the repositories. Althar keeps its conversation. The
> provider session is disposable. Leads and the coordinator share one pool
> of tools, the person's MCP servers and skills; the coordinator changes no
> code, for tidiness, not safety (ADR-097, from its second phase).

See [ADR-004](../decisions/004-coordinator-is-an-agent-session.md).

## What it does

- answers questions about the project, its code, and its work;
- plans work, drafts tasks, and orders a batch of them;
- triages and refines tickets, once a tracker connector exists
  ([06](06-integrations-and-skills.md));
- recommends a lead model per task, with its reasons, from the models it can
  use now and what is known of each ([05](05-workflow-engine.md),
  [ADR-015](../decisions/015-coordinator-picks-models.md));
- shows a task's plan before it starts: steps, a model per step, optional
  steps, and a short countdown after which the plan starts on its own. In the
  MVP the plan is always one fixed graph with its choices filled in
  ([MVP plan](../plans/mvp.md)); composing a graph per task comes next;
- starts something small at once, without a plan (a mini task): trying
  something out, checking how something behaves. One lead it picks, no
  review, nothing outside the project when it is done, and no countdown
  (`start_task`). It is a plain task, in a worktree with no branch until its
  lead changes the repository, when its work goes on a branch of its own
  that stays on this Mac. It stays plain until the person asks its lead to
  make it a real change (`make_it_a_change`), which the coordinator hears of
  at its next turn
  ([ADR-035](../decisions/035-a-task-s-kind-is-read-from-what-it-has.md));
- runs the project for the person, with no agent, when they ask, and keeps how
  it runs when Althar can't tell (ADR-023);
- follows the work, and passes messages to a task's lead;
- directs leads: tells one what to do next or to push, coordinates several,
  and does on a task what the person can in the window (accept, merge on
  their word, stop, hold, restart, settle, review again, and so on). Leads
  can do most of it too (ADR-097, its second phase);
- changes the project's settings and Althar's own, as the person can on the
  Settings screens: at once, each with a line and Undo, except that what
  loosens what asks goes only on the person's own message in the turn
  ([ADR-097](../decisions/097-agents-work-as-the-person-s-own-and-only-what-can-t-be-undone-asks.md#settings), its second phase; leads have it too);
- keeps the project's notes: decisions the person makes in conversation that
  the code doesn't show, which every session of it starts with
  ([ADR-031](../decisions/031-coordinator-handed-over-before-it-fills.md));
- judges task permission requests when the project selects that mode, in a
  fresh read-only session using its agent and model, without delaying the
  conversation ([ADR-019](../decisions/019-coordinator-judges-permissions.md)).

It never edits a repository, even for a one-line change: a change is always
a task with a lead, with a branch, a review and a record. That is tidiness,
not safety (ADR-097). It merges only on the person's word
([below](#merging-on-the-persons-word)). Until ADR-097's second phase it
doesn't install or build either, so trying something out that needs the
project set up is a task; from then it may, in its copies. Althar refuses the coordinator's
commands that change anything beyond its own copies, for its role, and its
brief says so, so it doesn't take that for the person saying no. What a task has built is in that task's worktree, so the coordinator
asks its lead to try it.

## Shape

```mermaid
flowchart LR
    You["You"] <--> Thread["Coordinator thread<br/>Althar's record"]
    Thread --> Brief["Brief"]
    Brief --> Session["Coordinator session<br/>any agent, over ACP"]
    Session <-->|"MCP"| Tools["Althar tools"]
    Session <-->|"MCP"| Own["The person's MCP servers (ADR-097)"]
    Tools --> Runtime["Runtime commands and queries"]
    Session -.->|"reads"| Repos["Copies of its own"]
    Runtime --> Tasks["Tasks, leads, and steps"]
```

The coordinator runs on the same adapter as every other agent
([03](03-agent-runtime-and-auth.md)). What makes it the coordinator is its
role: its brief, its tools, and its read-only rule.

## Its folder and permissions

The coordinator leaves implementation to task leads for tidiness, not safety.
It works in disposable copies, refreshed before each turn. Ordinary files may
be read anywhere; secret files and the keychain remain protected.

Where Claude Code's OS sandbox starts, commands run in it with writes held to
its folder and temporary files, and every command reaches Althar's rules, which
answer it at once. Network and localhost are open; only the SSH agent's own
socket is allowed. It loads selected skills, but no repository settings or
hooks, and its edit tools stay denied. Claude's native sandbox still refuses
opening process-substitution pipes under `/dev/fd`; the coordinator retries
such a read outside the sandbox, where its read-only rules run it. Codex uses
its ordinary workspace sandbox. Without an OS sandbox, commands run unless they
visibly write outside the coordinator's folder. Scripts, variables, loops and
process substitutions are not refused for being unreadable.

The coordinator uses the project's rules, including the person's Never and Ask
rules. Visible irreversible crossings ask as for a lead. A refusal is explained
in the same turn, with the command and its reason; it is never held silently
for the next message.

```mermaid
flowchart LR
  C[Coordinator command] --> S{OS sandbox holds it?}
  S -->|yes| R[Run inside its folder boundary]
  S -->|no| W{Visible write outside its folder?}
  W -->|yes| D[Refuse and explain why]
  W -->|no| P[Project rules and irreversible asks]
```

Review workspaces and review-only tool lists remain with the task-as-parts work.
An outside author's code still does not run without the person's word.

## Althar tools

Althar gives the coordinator an MCP server at `session/new`. Names are
provisional. From ADR-097's second phase leads get the same tools, the
commands to start and move tasks included, and the coordinator gets the
leads' (below): one pool, with only a lead's own task and worktree, and the
coordinator's disposable folder, apart.

| Tool | What it does | Kind |
|---|---|---|
| `project_overview` | Rules, repositories, notes | Read |
| `list_tasks`, `read_task` | Status, plan, steps, lead, and how its pull request stands: draft or ready, checks, unpushed commits, merged or closed, read from the same data as the task's card (never asked of the host; said as last seen where it may be stale or unknown). A task whose pull requests are all merged reads as finished; a closed one is said as last seen, since nothing watches it for reopening | Read |
| `find_tasks` | The project's tasks found by what they were about: words from a title, what the person asked, what a lead reported or built, a pull request's number, an issue's key, a branch or a file; best first, a line each with where it stands, its pull request, its id and what matched ([02](02-desktop-runtime.md#queries)) | Read |
| `read_thread` | A task's thread, or, without a task, its own conversation: the latest part, then further back a part at a time | Read |
| `read_change` | A task's diff and checks | Read |
| `read_pull_request` | Any of the project's pull requests, whoever opened it, by its number or link, as its host has it now: state, where it goes and whether it conflicts there, size, description, checks with the end of a failed one's log, and what everyone said on it, as data ([ADR-058](../decisions/058-the-coordinator-is-a-trusted-reader-in-copies-of-its-own.md)) | Read |
| `read_check_log` | A check's whole log on one of the project's pull requests, a page at a time ([ADR-041](../decisions/041-what-failed-said-in-full.md)) | Read |
| `rerun_check` | Runs a failed check on a pull request of the project's, or on the default branch's latest commit, once more: the one named, or each that failed. GitHub's Actions job, GitLab's pipeline job, Bitbucket Cloud's pipeline whole on the same commit; Bitbucket Data Center's builds are another service's, so it says whose and links the build ([ADR-081](../decisions/081-the-coordinator-acts-on-the-code-host-as-the-person-s-account-can.md)) | Command, undone in a step |
| `read_default_branch_checks` | The checks on a repository's default branch's latest commit, with the end of the first failed ones' logs | Read |
| `mark_ready`, `close_pull_request`, `reopen_pull_request` | Marks ready, closes unmerged, or opens again a pull request Althar opened, by its number or link. Each can be taken back in a step. Bitbucket Cloud can't reopen a declined one, so closing there waits for the person's word, and is refused until that is built; a pull request a person opened is theirs | Command, undone in a step |
| `update_branch` | Merges the pull request's target branch into its branch, at the head just read, on any of the project's pull requests: GitHub's update-branch, and on GitLab and both Bitbucket editions a merge in a copy of Althar's own, pushed plainly. A merge commit, never a rebase or a forced push. A conflict stops and names the files; a branch pushed to meanwhile is left as it is; a fork's branch the account can't push to is left for its author, whom only the person's word asks ([ADR-081](../decisions/081-the-coordinator-acts-on-the-code-host-as-the-person-s-account-can.md)) | Command, undone in a step |
| `reply_on_pull_request` | Replies, signed as from Althar, in a thread or a pull request's conversation: on one Althar opened, or whose author is the connected account or one of the repository's own people. An outside author's waits for the person's word, since the notification can't be taken back | Command, undone in a step |
| `edit_pull_request` | Gives a pull request another title, description, or both, on the same pull requests as a reply: on one a task follows, by the project's naming, the task's title following, as its lead's `edit_pull_request` does; elsewhere as given. What Althar put around a description it wrote (the review, the issue, its credit) stays. `rename_task` retitles a task's open pull request too. An outside author's waits for the person's word | Command, undone in a step |
| `push_tag` | Tags the commit the person's words name, or the default branch's latest, on any of the project's hosts; made by Althar, never forced. A tag already on that commit is done; one on another commit is refused unless they asked to move it; deleting one is asked for too ([ADR-081](../decisions/081-the-coordinator-acts-on-the-code-host-as-the-person-s-account-can.md#a-release)) | Asked-for |
| `read_release` | A tag's release as its host has it (GitHub's draft or published one, GitLab's release, Bitbucket's tag and Downloads), and the CI runs on the tag, with what each waits on and whose press it is, linked | Read |
| `approve_release_run` | Approves what a run on a tag waits on: GitHub's environment, GitLab's deployment approval or manual job. Where the account can't, or only the person can (Bitbucket's manual steps), it does nothing and says so with the host's button | Asked-for |
| `publish_release` | Publishes a tag's release as its host does: GitHub's draft made public, GitLab's release made, Bitbucket Cloud's files put in Downloads from the project's repository; Data Center's tag is the release | Asked-for |
| `rerun_failed_jobs` | Runs the failed jobs of a tag's newest failed run again: GitHub's and GitLab's jobs, Bitbucket Cloud's pipeline whole | Command, undone in a step |
| `read_release_steps` | How one of the project's repositories says it is released, from its CI files and release docs, to say as a line a step and keep as a project note | Read |
| `draft_task` | Creates a task in draft, with its repositories and intent: a title of a few words (at most 60 characters), and what the person last said to it kept as what they asked for, which the task's thread opens with and its lead reads | Command |
| `read_issue`, `find_issues` | An issue on a connected tracker or in the project's repository, with who has it, its fields and latest comments; and issues found by words, tracker, where, state or a run of keys, the person's open ones without ([06](06-integrations-and-skills.md#finding-and-reading-issues)) | Read |
| `draft_issue` | Drafts an issue on a connected tracker with every field it has, as a card the person files, changes or discards; or files it at once where the project's notes say so or the person just did, its card the receipt ([06](06-integrations-and-skills.md#drafting-issues)) | Command |
| `list_models` | The models it can use now, by maker, with their scores and each one's efforts: the ids a step takes, the one it starts at by itself, and the person's default where they set one | Query |
| `propose_plan` | Steps, a model per step and, where it matters, an effort that model offers, optional steps. An effort it doesn't offer is refused with the ones it does; left out, the step starts at the person's default for the model, or else the model's own | Command |
| `start_task` | Drafts a mini task and starts it at once: one lead, at an effort as `propose_plan` takes one, no review, nothing outside the project when it is done; a plain task (a quick task), with no branch until its lead changes the repository, and then one that stays on this Mac | Command |
| `find_pull_requests` | The pull requests in the project's repositories, whoever opened them: open unless said, by author, words in the title, those asking the person's review, or drafts; at most 30 a repository, newest change first. A line each, with its title quoted as data and never its description, and whether Althar opened it (for which task) or a task reviews it already. Each host's list call (`CodeHost.listChanges`), read-only | Read |
| `review_pull_request` | Starts a review of someone else's pull request, by its link or its number in the project's repository, with the lead it picks: a task on a read-only copy of the pull request's head, whose lead drafts a review the person posts (ADR-097: an outside author's; a team's gets a worktree and runs its code, from its fourth phase) ([06](06-integrations-and-skills.md#reviewing-someone-elses-pull-request)). Asked again, the task still reviewing it; once that one is done, a new review | Command |
| `list_automations` | The project's automations on this computer: when each runs, what each run does, where it stands, and how its last run went ([ADR-061](../decisions/061-automations-start-ordinary-tasks-on-a-schedule.md)) | Read |
| `propose_automation`, `change_automation` | An automation as the person asked for it, or a change to one: a name, the prompt each run is asked, days and a time or every hour, the lead, and what each run ends in (nothing, a draft or ready pull request, or reviews of each new pull request). Each on a card in its thread; nothing runs until the person turns it on, and a change that reaches further needs them to turn it on again, with Undo | Command |
| `pause_automation` | Pauses one when the person says, since it only stops | Command |
| `resume_automation`, `run_automation_now` | At once in a turn the person's message started, with a line in the thread; otherwise a small card the person presses, since both spend their plan and the coordinator reads text from outside ([ADR-086](../decisions/086-the-coordinator-moves-a-task-on-the-person-s-word-or-asks-on-a-card.md)) | Command |
| `stop_task`, `hold_task`, `restart_task`, `settle_task` | The person's own buttons on a task, by its slug: Stop (or with `turn`, only its lead's turn), Hold a plan counting down, Start, Resume or Reopen, and done, keep for later or discard (done and keep only for a task that isn't a change). In a turn the person's message started, at once, with a line quoting their words in the coordinator's thread and the task's; in any other, a `task_ask` card with one button that does it as their press, and Not now (ADR-097's second phase: at once in any turn, with the lines, since each can be undone). Discarding keeps the worktree and branch (ADR-056). `TaskActions.ts` ([ADR-086](../decisions/086-the-coordinator-moves-a-task-on-the-person-s-word-or-asks-on-a-card.md)) | Command |
| `rename_task` | Gives a task another title, as the person can, where its title no longer says what it does; its slug and branch stay, and what the person asked stays in its thread | Command |
| `make_it_a_change` | A lead's, not the coordinator's: offered only on a quick task not made a change yet, and refused, with why, on any other. Called when the person asks to turn what the lead made into a real thing: a title for what it does now, a reviewer named as `propose_plan` names one (none only where the person said so), and a pull request, a draft or ready for review. Makes its branch where it has none; renames the task and gives its plan, and the run under way, the review and the ending, or opens a round with them where its last run had ended; its thread and the coordinator's news say so. The lead's next `finish_step` goes through the review, then the pull request opens ([ADR-035](../decisions/035-a-task-s-kind-is-read-from-what-it-has.md)) | Command |
| `run_project` | Runs the project with no agent, its default or one of what it runs by name: the default branch in a copy of its own, or a task's worktree (ADR-023, ADR-044) | Command |
| `screenshot` | A picture of a page served on this computer (any address, from ADR-097's first phase), a run's or a dev server's, drawn offscreen by the desktop app at a viewport, whole or one element; leads have it too (ADR-057) | Read |
| `set_run_command` | Keeps how a repository runs, its own way to run, for Althar to run it; leads have it too (ADR-023) | Command |
| `keep_run` | Keeps something more for the project to run by a name and a command, or drops it; leads have it too (ADR-044) | Command |
| `order_tasks` | Orders a batch | Command |
| `message_lead` | Sends a message to a task's lead, queued or as an interrupt | Command |
| `keep_note`, `list_notes`, `drop_note` | The project's notes: a decision the person made, in a sentence; at most 40 (ADR-031) | Command |
| `read_settings` | From ADR-097's second phase: a section of the project's settings or Althar's, or all of them, each setting with its words as the screen shows them, its value, the values it takes, and whether changing it loosens what asks; leads have it too | Read |
| `change_settings` | From ADR-097's second phase: changes a section's settings through the call its screen makes, with a line and Undo in the thread. Tightening and every plain change at once; a change that loosens what asks (Rules, Never and Ask me, a server switched back on, the team's reviews posted unasked) only where it names the person's own message in the turn, else a card; signing out, leaving a repository out and removing the project on their word; signing in, connecting and adding a repository open the walk-in or the picker for them ([ADR-097](../decisions/097-agents-work-as-the-person-s-own-and-only-what-can-t-be-undone-asks.md#settings)); leads have it too | Command |
| `recommend_lead` | Records a lead recommendation and its reasons | Command |

A lead's own tools, beside `finish_step` and its pull request's, do what its
sandbox would refuse, outside it (ADR-057): `install_dependencies` runs its
worktree's setup again; `run_project` and `stop_project` run the project in
its worktree, as the run the person sees; `screenshot`, as above; and
`rerun_check` runs checks on its pull request again (the coordinator's
runs them on any of the project's, and on the default branch). For checks that fail,
`read_default_branch_checks` reads those on its default branch's latest
commit, and `hand_checks_to_person` brings a failure that isn't the change's
to the person, with a line on why (ADR-070). `show_pictures` shows
the person pictures from its worktree in its thread at any time, a step open
or none, each with a caption: checked as `finish_step`'s screenshots are
(inside the worktree, what its name says it is, up to 20 MB), and kept in
the artifact store as they are, so they stay once the worktree goes. A
review's lead doesn't have it: its draft is what it hands the person.

The same server serves every session. The read tools are how a lead, a step,
or an agent that took over a task reads the record its brief left out. Command
tools are granted per role; a lead gets none of the coordinator's commands,
and reads the project's other tasks as below. ADR-097's second phase ends
that split: leads may start tasks and act on them.

## What a lead sees of other tasks

Two tasks often touch the same code. Rather than the coordinator telling
each lead by hand to read the other's branch, every task's lead, and the
reviewer of a task's change, sees the project's other tasks, read-only.
They get the coordinator's own read tools, which say more of each task's
work to them, and one more:

| Tool | What a lead reads |
|---|---|
| `list_tasks`, `find_tasks` | As the coordinator does, and under each task: whether it is the lead's own, where it works (Local, in the person's checkout, or a worktree), its branch, and, for an open task, the files it changes now, uncommitted ones too |
| `read_task` | Its brief (title and description), where it stands, its plan, what it built and couldn't show working, its branch and folder, each step's report, its pull request, and what its review found |
| `read_thread` | Its thread, the person's messages included, the latest part first, then further back a page at a time |
| `read_task_diff` | Its change against where its branch started, as it stands in its folder now, uncommitted work and new files nobody has added included; all of it or the paths asked for, with the list of files first and a long diff a page at a time. A new file is read up to 2 MiB, as the Changes view reads one, and a longer one says so |

Only tasks of the same project are found (`taskOf` reads by project). Nothing
among these tools messages another lead, changes another task or writes in
another folder: leads still talk to each other only through the coordinator,
until ADR-097's second phase gives them the coordinator's commands.
A review of someone else's pull request isn't given them, since its lead
reads that pull request's untrusted words and reaches the web, and so reads
none of the person's work in progress.

The runtime reads another task's folder on the lead's behalf, outside the
lead's sandbox (`otherTasks.ts`), so the sandbox needn't widen to reach
another worktree. It reads without disturbing whoever works there: every git
command runs on a copy of that folder's index with git's optional locks off
(`untouched` in `git.ts`), because `git diff` and `git status` refresh the
index as they read and write it back under its lock. Files themselves are
only read. A Local task's checkout is read as it stands only while the task
holds it and it is on the task's branch: the person's own edits there show
with it, and once they switch it away, only the branch's commits are read.
A task whose folder was removed is read from its branch's commits too.

Leads whose work meets get a heads-up (`Overlaps.ts`). When a lead's edit
or command ends, or a lead's turn starts or ends, Althar compares
the paths in its change with those of the project's other running tasks (open,
with a lead's session here). For each task changing a file it changes too,
the lead is told once which task and which files, and to read that task's work
before going on, and the other lead is told the same. A lead is told only while
it is still in a turn as it is told, at work on the task. One between turns
isn't woken for it: it hears of the overlap as its next turn starts.
What was told is kept in the record (`task.overlap_noticed`, for each pair
and direction), so further edits and later launches say nothing more. Looks
run one at a time, and a task asking again while it waits is looked at once.

```mermaid
sequenceDiagram
  participant A as Lead A (in a turn)
  participant R as Runtime
  participant B as Lead B (in a turn)
  A->>R: edit ends (live event)
  R->>R: A's and B's changes, read untouched
  R-->>A: Heads-up: B changes README.md too
  R-->>B: Heads-up: A changes README.md too
  R->>R: keep task.overlap_noticed for both directions
  A->>R: read_task_diff B
  R-->>A: B's diff, uncommitted work included
```

Each lead's brief says these tools exist, and to read another task's work
before changing code it changes, and where the brief names another task.

## Conversation and context

The conversation with you is Althar's record, kept in full with the
project. The provider session is a working copy of it.

The session is rebuilt from a brief ([03](03-agent-runtime-and-auth.md)) when:

- the coordinator is first opened;
- the app restarts and the agent can't load the old session;
- you switch the coordinator's agent;
- its context is filling up (below).

The coordinator's brief holds its instructions for the role and the
project's notes, then the thread as far as it fits. Older turns are read
through its tools.

### Handed to a fresh session before it fills

An agent left to fill its context compacts it by itself, at a moment of its
choosing, into a summary of its own, and a decision made only in
conversation may not survive it. So Althar hands the coordinator over first
([ADR-031](../decisions/031-coordinator-handed-over-before-it-fills.md)):

- **When.** Once the agent says its context is 80% full (`HANDOVER_AT`, from
  ACP's usage updates, as the composer's context ring shows it), between
  turns: after the turn it crossed in, or at once where it says so between
  turns. Never in a turn. The old session takes no more turns from then; what
  the person says meanwhile waits for the fresh one.
- **On what.** The same agent, account, model and effort. The fresh session
  is started first, and the old one stopped as superseded by it; one that
  can't start leaves the old one carrying on, its agent compacting by itself.
  So does a brief that would take 40% or more of a fresh session's context:
  it would be due again at once.
- **Its brief, from Althar's records rather than the raw thread:** its role,
  a line that it took over and should read earlier details with
  `read_thread`, `read_task` or the code rather than guess, the project as
  `project_overview` gives it, the notes, every open task (where it stands,
  who leads it and what waits on the person; for the newest 25, its plan and
  what its lead last reported too), and the conversation's last twelve
  messages, word for word. Each part is bounded; a message longer than a
  part comes in parts, so `read_thread` reaches all of it.
- **What the person sees:** a quiet line in the thread, "Started a fresh
  session; picked up 3 open tasks." The thread is Althar's record, so the
  whole conversation stays there to scroll.
- **What doesn't move:** plans in their countdown, held plans, drafts and
  running tasks are Althar's, not the session's, and carry on as they were.

### Notes

A decision the person makes in conversation that the code doesn't show, such
as "issue drafts need an approval card, on every tracker", is kept as one of
the project's notes, a sentence each, at most 40. The coordinator's brief
tells it to keep one when the person decides something like that, and to
drop one they take back; every brief of it holds them, and so does
`project_overview`. The person sees them in the project's settings, says
one in their own words, and removes what no longer holds. Each is a row
with its record; a removed one keeps its row.

### The compaction seam

Althar hands the coordinator over before its agent compacts, and a brief
uses the records, the notes, the last messages and the tools. Althar writes
no summaries yet.

Continuous compaction will write summaries as records:

```ts
type ThreadSummary = {
  id: string
  threadId: string
  coversFromSequence: number
  coversToSequence: number
  artifactId: string
  writtenBy: string // agent and model
  createdAt: string
}
```

A brief then uses the latest summaries for what came before its verbatim
turns. The interface can show older conversation at lower detail from the
same records. Nothing else needs to change for this to arrive.

## Task events

Task status changes reach the coordinator thread as task cards that Althar
posts, a projection of task facts. The coordinator agent doesn't write them.

In the MVP the coordinator agent is prompted only by your messages. It reads
task state through its tools when it needs it. Whether it is also prompted
when a batch it planned needs its next task is open.

## Agent, model, and usage

- The coordinator can run on any agent, and switches like a lead: the new
  agent takes over the whole thread.
- It runs on your plan, so its default model matters for cost. Which
  default is open. A project can do without it (ADR-097): its session
  starts when the person talks to it, or news it acts on wakes it.
- When its account runs out, it switches under the project rule like any
  session. Tasks keep running; the coordinator never blocks a task.

## One per project, then one per person

In the MVP there is one coordinator per project, on this device. Later, each
developer has their own coordinator, with its own thread and session, reading
the shared project state ([07](07-persistence-security-and-cloud.md)). Nothing
in the tools assumes one coordinator: every command carries its actor.

## Open questions

- Its default model.
- Whether task events prompt it, and which.
- When continuous compaction summarises, and with which model.

## Verification gates

- The coordinator cannot change a repository even if its agent tries (for
  tidiness, ADR-097).
- Every tool call is a recorded, idempotent command with an actor.
- Rebuilding the session loses no turn of the thread.
- A handover happens between turns, never in one, and leaves plans, drafts
  and running tasks as they were.
- Switching the coordinator's agent keeps the thread.
- A coordinator out of usage pauses no task.

## The person's word and errands

The host records each message's sender on the connection: `window`,
`paired_device` (with its device id), `socket`, or `internal`. A client never
supplies its own authority in a message payload. Free text supplied with an
`AnswerStuck` tell keeps that connection’s sender,
including while waiting for capacity. Generated quiet notices from Changes,
Reviews and IssueChanges, and structured question-answer summaries, remain
system input: they report a decision rather than authorizing another action.
New RPC calls are refused to a socket until the contract marks them
`SocketAllowed` (ADR-048).
Permission answers and widening rules remain the person's calls: from
ADR-097's second phase an agent's `change_settings` loosens what asks only
where it names the person's own message in the turn, recorded by its
sender as any asked-for tool's word is.

Each delivered turn records `person`, `news`, or `system` as its origin.
`Sessions.send` accepts an explicit `origin: 'news'` for a quiet wake.
`ToolAccess` exposes `byPerson`, `origin`, `turnId` and the person's message
ids, resolved from the live delivery on every call. The `TurnStarted.byPerson`
signal also retains shown messages for the stall watch; it is not tool
authorization. A session's old messages, a socket's visible message, and a
caller-supplied `byPerson` cannot authorize
a new action. `read_turn` gives the agent the same facts.

`Errands` owns durable ordered steps. `keep_errand` requires a person's
message in the live turn and keeps its exact words and id, each tool and its
semantic arguments, target, head, target branch, task and waits. Kept, paused,
resumed and completed errands leave lines in the thread. Task cards show the
open wait, and fresh coordinator and lead briefs include the open records.
`read_errands` reads the complete steps. Resuming records the fresh message
separately, preserving the original request. An objection uses `pause_errand`;
only fresh word can resume or cancel. The shared change sweep reports a day
without news, or a `required-check-missing` wait whose `since` marks an hour
after the other checks finished, at most once a day. The news watch can read
`errand_steps.waits` and must call `Errands.news(id)` on every poll change
touching an errand’s targets. This refreshes the no-news clock only; it does
not inspect targets or end errands. The news task must also wake the owning
thread for a fresh read when another writer pushes or a target closes, merges
or leaves its queue. Until that watch is connected, those changes are detected
only by the next attempted step, and the no-news clock runs from keep/resume.

An acting tool declares `kind: 'asked-for'` and supplies an `AskedAction`
instead of an ordinary call. The shared tool server owns its authorization,
fresh read and mutation receipt. It accepts a person's message id from this
turn or an exact open errand step in this thread. Steps run in order. A read
reporting an objection pauses the errand; another writer, a changed target
branch or someone else settling the target ends it. A head that moved is
refused, except an errand's head moved by the task's lead or Althar, which the
action receives from that fresh read. A tool binding a branch must return
that branch in its read: omitting it refuses this attempt and leaves the
errand open.

The same tool, target, head, branch and semantic request share a serialized
receipt across messages, errands and sessions. Include an observed task
revision or operation generation in the request where the same operation may
legitimately recur. An action may fail with `ActionNotPerformed` only with
positive proof it neither happened nor remains in flight (such as a host’s definite refusal).
That receipt is failed and permits retry after another fresh read. Every other
`ToolRefused` from the action is conservatively treated as a lost answer.
A lost answer or `{ pending: true, answer }` stays uncertain. Only a read proving it done confirms it; only `absent`, positive
proof it neither happened nor remains in flight, permits another attempt.
A confirmed receipt repairs an interrupted completion and its chat line
without acting again. This foundation is shared by every host and agent; the
first acting tool on it is the merge, below.

## Merging on the person's word

`merge_pull_request` (`MergeLine.ts`) merges any of the project's pull
requests, in any of its repositories, at the head the coordinator read and
in a way the repository allows. Every merge is an errand kept from the
person's message, with one step, `merge`, so "merge it once it's green" and
"merge it" are the same call:

- **The host's own queue** (GitHub's merge queue on the branch, Bitbucket
  Cloud's, GitLab's merge trains): the step puts it there at its head, and
  it is done once a read shows it merged. There is no slot of Althar's.
  Bitbucket Cloud's merge call is what puts one in its queue, and takes no
  head, so the head is read just before. A queue that sends one back for a conflict hands it to the task's lead
  rather than putting it in again.
- **Everywhere else, Althar's line:** one slot for each repository and
  branch, in the order the person asked; their "merge it now" (`now`) goes
  first and waits only for a merge already in flight. The step that holds
  the slot is brought up to date with the branch's head, by a merge, and
  waits for green there; then it merges, with auto-merge as its merge where
  the host has it (GitLab, Data Center from 8.15). It holds the slot until a
  read shows the merge landed; the next starts from the branch's new head.
  A step whose checks fail, whose merge conflicts, or that Althar can't
  bring up to date (a protected branch, an account that may not push), steps
  out of line until they pass or its head or the branch moves; a conflict or
  a refused push is said to the task's lead.
  A merge the host refuses (a review it needs, a merge check) pauses its
  errand, said so, and the next goes ahead. A branch is brought up to date
  three times at most, someone else writing to the target in between, then
  its errand pauses for the person.
- **Althar's sweep** (every 30 seconds, and at once after a merge call) does
  only what can be undone: it brings the slot's branch up to date by a merge,
  the connectors' `updateBranch` that `update_branch` uses too (GitHub's
  update-branch; elsewhere a merge in a copy of Althar's own, pushed plainly,
  never forced; where it can't, a fork the account may not push to, a push
  or the host's own update refused,
  the step steps out of line and it is said, once, to the lead too; a host
  that didn't answer is tried again after a few minutes, and only said). For each step that can't be undone, a merge or a
  queue, or settling one that landed, closed or moved, it wakes the
  coordinator with news naming the errand and step, and the coordinator's
  turn takes it through `Errands.execute`, which reads again before it acts.
- **Who moved a head:** the very head Althar's update made, as read back
  after it, or one the task's lead pushed, carries the errand on; anyone
  else's push ends it, even one on top of Althar's update, as the person
  asked to merge what they saw.
- **A branch it merged into** is watched for an hour after: a failed check at
  its head is said in the chat and heard as news, "Main is red", which is how
  a write by someone else between the last read and a merge landing shows.
- **What it keeps:** the errands, and the line's own notes (what each step
  did, what it said) as observations of subject `merge_line`, so a restart
  keeps the line. What each server supports is read when first used, kept
  for an hour, and read again once a call is refused.
- `leave_queue`, under the project's lock, pauses a pull request's errand in
  Althar's line, takes it out of the host's queue or train (Bitbucket
  Cloud's too), and turns its auto-merge off: it can be undone, so it needs
  no word. Where the host won't, it says so, with the link.

```mermaid
sequenceDiagram
  participant P as Person
  participant C as Coordinator
  participant L as Merge line
  participant H as Host
  P->>C: "Merge #12 and #14 once they're green"
  C->>L: merge_pull_request(#12, head, message)
  L->>L: keep errand, read: first in line, green, up to date
  L->>H: merge (or auto-merge, or enqueue)
  C->>L: merge_pull_request(#14, head, message)
  L-->>C: 2nd in line, behind #12
  H-->>L: sweep reads #12 merged, main moved
  L->>C: news: errand #12, step merge
  C->>L: merge_pull_request(errand, step): done
  L->>H: sweep brings #14 up to date (a merge)
  H-->>L: green at the new head
  L->>C: news: errand #14, step merge
  C->>L: merge_pull_request(errand, step)
  L->>H: merge #14 at the head that went green
```
