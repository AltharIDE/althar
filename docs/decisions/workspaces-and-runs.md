# Workspaces and runs

Where a task's work happens on disk, the branch it works toward, how its
folder is set up and cleaned away, and how Althar runs the project and
stops what was left running. How the pieces are built is in
[01](../architecture/01-concepts-and-project-model.md) and
[03](../architecture/03-agent-runtime-and-auth.md#setting-up-a-worktree).

**Replaces:** ADR-006,
ADR-022,
ADR-023,
ADR-044,
ADR-056,
ADR-066,
ADR-068,
ADR-080,
ADR-090,
ADR-091,
ADR-093,
ADR-096

## Where a task works

Each task works in one of two places, the same for all its repositories:
**Worktree**, a folder of its own, or **Local**, the person's own clone on
this computer. Worktree is the default. A project's General settings say
where new tasks start ("New tasks start in"), and the coordinator can choose
the other per task (`works_in` and `works_in_why` on `draft_task`,
`propose_plan` and `start_task`). The plan card shows the choice and why, and
the person can change it until the first step starts. Where the choice is
made, it says what Local gives up: one task at a time, beside the person's
own edits.

### Worktree

A task gets one git worktree per repository, shared by its lead, its steps
and any agent that takes over. Worktrees sit in a visible folder with
readable names and no spaces, `~/Althar/<project>/<task>/<repository>`
(`ALTHAR_WORKTREES` moves the root). "Open in editor" opens the task's
folder, so a task across several repositories opens as one workspace.
Althar's own data stays in its profile folder.

Why a folder of Althar's own: the person's checkout stays untouched, and
parallel tasks never collide. Inside the repository, editors, watchers and
test runners would see every worktree; in a hidden app folder they are hard
to find, and the macOS profile path has a space that some build tools
mishandle.

### Local

Some projects cost more in a worktree than they gain: an iOS app's caches
start cold in every new path, and local services are set up around the
person's checkout. So a task may work Local, in each repository's own clone
(`workspaces.kind = 'checkout'`).

- **One task holds a checkout at a time,** from when its work starts until it
  is settled and the checkout has gone back. A second task started Local
  waits, its first step held (`hold_reason = 'checkout'`), Up next, and
  starts as soon as the checkout frees. A draft holds nothing. A checkout is
  the folder itself, so the same folder in two projects is one checkout. The
  coordinator is told who works Local now and is asked to plan in a worktree
  meanwhile, saying why, unless the task can wait.
- **Althar never switches a checkout with uncommitted changes, and never
  stashes, resets or cleans it.** Clean and on its default branch, Althar
  makes the task's branch, checks it out and remembers where it was
  (`returns_to`). With uncommitted changes it asks the person (wait until
  they're committed, or start in a worktree). On a branch of the person's
  own it asks: the task's branch from where tasks start, start from the
  person's branch, or a worktree. An answer holds only while the checkout
  stays as it was when asked.
- **The checkout goes back when the task is settled,** once nothing of the
  task still runs: switched back to the branch it was on, if it is clean and
  still on the task's branch. With uncommitted changes it stays, says so,
  and goes back once they are committed. A checkout the person switched
  themselves stays where they put it. A settled task opened again carries on
  in a worktree, on its branch. Removing a project gives its checkouts back
  the same way.
- **The person may edit while a task works there.** The lead is told the
  folder is the person's: commit only its own files, by name, and never
  switch branch, stash, reset, restore or clean. Git that would throw away
  uncommitted work there asks even with everything allowed
  ([what agents may do](what-agents-may-do.md)). The card reads
  "Change · Local".
- **A quick task in the checkout gets its branch from the start,** so the
  person's branch never takes its commits.
- **Althar's housekeeping leaves a checkout alone:** folder cleanup never
  removes it, nothing is brought back into it, and the recorded setup doesn't
  run there, since the person's environment is already set up. Run runs in it.

### Moving a running task

The Handoff: a running task moves between a worktree and Local, between its
lead's turns, with its branch and its conversation, from its folder's row
in the header or the lead's `change_part`. One change of a task is Local at
a time.

- **To Local:** what the worktree hadn't committed is committed on the
  task's branch first. Then, once the person's checkout is free (no other
  task holds it) and clean, it switches to the task's branch, remembering
  where it was (`returns_to`), and the worktree folder goes; the branch
  stays. On a branch of the person's own, it asks first ("switch it, or stay
  in the worktree"), and their answer holds while the checkout is as they
  saw it.
- **To a worktree:** clean and still on the task's branch, the checkout goes
  back where it was; already on another branch, the branch is free. Then a
  worktree takes the branch, set up as any is. With changes not committed,
  which are the person's, the move waits and the task carries on in Local.
- **What holds a move** is kept on the workspace (`moving_to`), said once in
  the thread and on the folder's row ("Moves to a worktree once Board.tsx is
  committed"), and tried again every few seconds, the lead's turn ending
  first; the person can call it off.
- **The conversation carries on:** the lead's next turn starts a fresh
  session in the new folder, handed the work so far, since an agent's
  session can't follow its folder.

Every Local rule above stays: Althar never switches a checkout with
uncommitted changes, never off a branch of the person's own without asking,
and never stashes, resets or cleans it.

[ADR-103](proposed/103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md)
proposes pinning Local to a named computer's checkout and adding remote
worktrees.

## The branch a task works toward

Each task works toward a branch in each of its repositories
(`workspaces.toward`): it starts from it, its pull request goes into it, and
it is kept current with it. Null means the default branch.

- **The project's "Work toward"** is the default for new tasks, one branch
  per repository (`repository_bindings.work_toward`), chosen from the branches
  of the remote tasks start from (a fork's upstream, where its work goes
  there). It is picked beside Run at the top of the project: the branch
  picked there is Work toward, and Run's own copy runs it. It is in General
  settings too. The coordinator's brief names it, and its copies follow it.
- **A single task can point elsewhere** (`toward` on `draft_task`,
  `propose_plan` and `start_task`), until its first step starts. The plan
  card's last row says it ("Open a draft PR into release/0.8.0"), and the
  board's card shows "→ release/0.8.0" only where it isn't the default.
- **Everything follows the target:** the start, the pull request's base,
  bringing the branch up to date, `update_branch` and the merge line, the
  conflict check, the checks the lead compares against ("broken on
  release/0.8.0"), the done check of a task with no pull request, and the
  diff, Changes and Outputs' base.
- **A task's target is protected as the default branch is:** a push straight
  onto it is refused, saying it is the branch the work goes into.
- **A branch the remote lacks can be made from any branch list** by typing
  its name (`CreateBranch`): made on the remote tasks start from, from its
  default branch, pushed by Althar and never forced; one that exists already
  is left as it is. Made from a plan card, the plan is held first, so its
  countdown can't start it toward the old branch.
- **Local follows the same rules:** a Local task makes its branch from its
  target in the person's checkout, never over uncommitted changes.

**A running task changes its target at any time,** from its folder's row
or the lead's `work_toward`, between its lead's turns:

- **Nothing pushed yet,** its branch is rebased onto the new target. A
  conflict stops the rebase, names the files and hands it to the lead.
- **Pushed,** the open pull request can't change its history: its own
  commits are cherry-picked onto a fresh branch from the new target, named
  with `-2`, whose pull request opens into it. The old one is left open,
  followed no more, for the person to close; its branch isn't touched. A
  conflict leaves everything as it was, and says which files.
- **Held for Ship,** the fresh branch stays on this computer, held as the
  old one was, and only Ship pushes it and opens its pull request.
- **The review's mark moves with the commits:** each commit a move rewrites
  is kept beside its copy, so the next review reads only what came since the
  last.

Putting a merged fix on another branch is a task toward that branch. Release branches the coordinator makes are in
[code hosts](code-hosts.md).

## Setting up a task's folder

A fresh worktree has nothing installed. Nobody writes setup config: the
first lead in a repository works it out, and Althar replays it.

- **The first lead records the setup.** Where a repository has no setup
  recorded, the lead's brief asks it to get the folder ready first (its
  dependencies, what its tools download, the ignored files it needs from the
  person's checkout, such as `.env`) and to record what worked with
  `record_setup`: the files to copy and the commands to run. Althar copies
  the files in at once and keeps the setup on the repository
  (`recorded_setup`). Every later lead is asked the same until one records
  it.
- **Althar replays it in every later task's folder,** itself, outside any
  sandbox, as the folder is made and before the lead's first turn. It copies
  the files from the person's checkout, never over what the worktree has,
  then runs the commands one after another until one fails. It runs in the
  person's login shell, as Althar's own process, for ten minutes at most,
  once per worktree. The card says "Installing dependencies" while it runs,
  and the thread keeps what it printed, folded.
- **Where none is recorded yet,** Althar runs the lockfile's install
  (`bun install --frozen-lockfile`, `pnpm` and `yarn` alike, `npm ci`), which
  never changes the lockfile. A setup line kept earlier with
  `set_run_command` is still read, after a recorded one.
- **A setup that fails never holds the task up.** The lead starts, told what
  failed and the end of what it printed, and is asked to get the folder ready
  and record the setup that works, which replaces the old one.
  `install_dependencies` runs the setup again on the lead's request, never a
  command it names.
- **Secret files are copied** like any other file the setup names, because
  the person asked for it. The lead can read the checkout already.
- **The person can see and change it** in the project's settings, under
  Running: a tab per repository, its commands and the files copied, as
  numbered lines typed in place. A change there replaces what the lead
  recorded. Nothing has to be written there.
- **A lead's sandbox writes to its tools' caches,** so Electron's build,
  Playwright's browsers and Bun's packages download inside it. One list
  (`toolPlaces.ts`) holds each tool's caches on a Mac and on Linux, never
  where keys and sign-ins are kept.

No host list limits where a lead's commands reach: Claude Code's and
Codex's sandboxes reach every host. Not built yet: Codex's leads don't get
the tools' caches as places to write.

A setup runs repository code unasked, outside any sandbox, as a run of the
project does. That is the trade for a folder that gets ready with nobody
over it.

## Finished tasks' folders

A worktree of a JavaScript project can take 2 GB or more, so finished
tasks' folders go after a wait, and come back when the task needs them.

- **A task is finished once it is in Settled:** done or abandoned. A merged
  task with commits after its pull request isn't.
- **The wait is the person's choice** (`folder_wait`), in Settings › Work on
  this computer, "Remove finished tasks' folders". **Smart** is the default:

  | Task | Wait |
  | --- | --- |
  | A review | Right away |
  | A merged change | 3 days |
  | A done quick task | A week |
  | An abandoned one | 2 weeks |
  | Any, below 10% of the disk free | Sooner, oldest first, until 15% is free |

  Or one wait for all (a day, a week, a month), or only on Clean up. The wait
  runs from the latest of: when it settled, when its screen was last opened,
  and when its folder was last opened from Althar. A sweep runs two minutes
  after Althar starts and every hour.
- **What goes:** the folder, its review copy (`.review/<task>`), and the
  task's folder once empty. The branch stays, and the folder's last commit is
  kept under `refs/althar/kept/<workspace>`. The thread says so in a line
  ("Folder removed 3 days after the task finished · 2.3 GB").
- **What holds a folder back:** uncommitted changes; an abandoned change
  whose commits were pushed nowhere; something running from it or setting it
  up; being opened from Althar today; or git not being able to say what's in
  it. This is asked again just before it goes, under the same lock that
  bringing it back, opening it and running take.
- **Coming back.** A task whose folder went still shows its diff, commits and
  committed documents from the kept commit, and its screenshots from the
  artifact store. Its folder comes back at the same path before anything
  needs it: an agent starting, opening in an editor, a run, or reopening. It
  is set up again, which costs about a minute, and its header says
  "Bringing its folder back" until it is ready. Something else at that path
  is never taken or removed.
- **The Settings row** shows the disk as one bar, with what's held back and
  what could go now. Its list says why each folder is held, and offers
  Remove. Clean up takes what nothing holds, and says what it freed.
- **It is housekeeping:** nothing in Needs you, no notifications.

Off by default was turned down because nobody would turn it on.
Right-away removal was turned down because a merged task is often run or
followed up in the next days.

## A worktree whose link broke

A worktree and its repository name each other: the worktree's `.git` file
names its git directory under the repository's `.git/worktrees/`, and that
directory's `gitdir` file names the worktree back. Moving either side, as a
profile moved from the Flatpak to a native build does, breaks the link, and
every git command in the folder fails with `fatal: gitfile does not point to
a valid repository` while `git worktree list` still shows it healthy.

- **Althar repairs it by itself**, for a task's worktree or its review copy
  (`.review/<task>/<repository>`) whose `.git` file names no git directory,
  one that isn't there, or whose record names another place. It runs `git
  worktree repair <folder>` from the main checkout of the repository the
  worktree was made from.
- **When:** as Althar starts, for every worktree it keeps that isn't
  cleaned, and the first time git's own `fatal:`/`error:` line in a worktree
  says its link broke. That command runs once more, only after a repair that
  finished while it ran. A repository's broken worktrees are repaired and
  recorded together, as git repairs them together.
- **Judged by the link, not git's exit code:** git can exit 1 having
  repaired it; what counts is whether the link reads right afterwards.
- **Never another worktree's record.** Records are named by folder name
  (`<name>`, `<name>1`, …), and a prune frees a moved folder's name for the
  next worktree, so a moved folder's `.git` can name another task's record.
  Before running git, Althar finds the record the repair would join the
  folder to, and repairs only where it names this folder or one that isn't
  there, and isn't on a branch other than the task's (for a review copy, on
  no branch). Otherwise it changes nothing and says why.
- **What it records:** a `workspace.repaired` or `workspace.repair_failed`
  fact, one line in the task's thread ("Folder link repaired", "…, and its
  review copy's"), and an INFO line in the log.
- **What it never does:** move, remove, reset or prune anything. Where git
  can't repair a folder, or the repair would take another's record, the
  folder stays as it is and the thread says so with a way out: the task's
  commits are on its branch and the folder can be moved aside and added back;
  a review copy can be removed, as the next review makes it again; an old
  profile's copy can be removed. Git's line comes after, redacted, and goes
  to the log. A failure is recorded, said and logged once, not at each
  start. A worktree whose folder is missing is left to "its folder isn't on
  this computer".

Asking first was turned down: the repair only rewrites two pointer files to
what they must be, and the task can't work until it's done. `git worktree
prune` and adding again was turned down, as prune drops what the worktree
held but hadn't committed.

## Running the project

Althar runs the project itself, with no agent: running it needs no model,
and a lead's sandbox would get in the way.

### What a project runs

A project keeps a list of things to run, in the person's order, the first as
its default. Each runs in one of its repositories and has a name and a
command. One with no command of its own is the repository's own way to run,
worked out from the repository until one is kept: its package.json's dev
script, else start or serve, with the package manager its lockfile names;
else a Procfile's web process; else a Makefile's dev, run or serve target.

Agents keep it current, since they make the changes that move it:
`set_run_command` keeps a repository's own way, `keep_run` adds or drops one
by name, and `run_project` runs one by name, or the default without one. The
list shows who said how: worked out, the person, the coordinator, or an
agent. It is kept in the store (`runnables`).

Before a run, a copy with nothing installed is set up first.

### Run and where it runs

- **A press on Run opens its list.** Nothing runs until a line is picked.
  The button always says **Run**, then, behind a thin rule, how many failed
  (red), else how many run, else a spinner while one starts or fetches.
- **Each line keeps its state in place:** Run at rest; starting or fetching;
  running, with where it answers, how long it has run, and Stop; "Exited 1"
  in red with Run again and Clear; or why a fetch failed, with Try again.
  What runs comes first, in an order fixed as the list opens. A list longer
  than eight opens on a field to search. Adding something to run (typing a
  command, picking a package.json script, or asking the coordinator) and
  editing the list sit at its foot.
- **In a task, Run runs in the task's worktree.** There is nowhere to pick.
- **On the project, where Run runs is picked beside it,** as a branch
  switcher: the default branch (Work toward), a task's worktree, or a pull
  request or branch the remote has. It stays picked, per project, on this
  computer. In its list, each place names what runs there, and what failed in
  red.
- **Several run at once, one of each in a place.** Runs of Work toward share
  their repository's copy, beside the coordinator's, made fresh as a run
  starts where nothing of that repository runs from it.
- **Althar owns the process:** its own (purpose `run`), in a process group of
  its own, with the Linux session's display and bus where a desktop app
  needs them. It stops when the person stops it or Althar quits. Runs are
  kept in memory, and none outlives Althar.
- **A run's address opens beside the conversation,** where it has one
  ([desktop app](desktop-app.md)), else in the person's browser.

### Running a branch or a pull request

A branch or pull request picked beside Run is fetched as something runs on
it, not as it is picked. Althar fetches it with its own sign-in (`Fetches.ts`)
and makes a copy of its own, detached at that commit, in the project's
`.runs/<run>`, and runs there. There's no task, no agent and no local
branch, and the person's checkout is untouched. The copy goes when the run
does.

- A pull request from the repository's own branch is fetched into
  `origin/<branch>`. A fork's comes from the host's ref (`refs/pull/N/head`,
  `refs/merge-requests/N/head`) into `refs/althar/pull/N`.
- The picker lists the remote's open pull requests (the newest fifty, and a
  search beyond that), then its branches. A number it didn't list still runs
  that pull request. An unknown branch is refused with the names like it.
- The pill and card name it ("PR #12 · feature/x"). Run again fetches afresh.

A worktree per run was turned down because it writes the person's
`.git/worktrees`, which outlives a crash. A task per run was turned down
because it puts a card on the board for what is only a look.

### Where runs show

A run is said in three places that share one state, so they agree:

- **Run's list,** above.
- **The pill over the composer.** A task's lists what its lead left running
  and the task's runs, one row each: name, address, how long it has been up,
  and Stop. The coordinator's lists the project's runs of no task ("Run on
  main", a branch or a pull request). A run and a process a lead left running
  are never merged into one row, even on the same address. The running time
  is the whole reminder; the pill doesn't nag.
- **The run's card** in the thread it was asked for in: where it runs, the
  command, its address as a link, its uptime and Stop, and, once over, how it
  ended, with Run again. A run that Althar's restart ended is marked stopped.
  Its output lives here. `run_project` waits up to 30 seconds for the
  address, so the coordinator's reply can link it, or say how it ended.

Where a run answers is read from the first local address it prints. One that
answers nowhere (an app's window, a watcher) is taken as starting for ten
seconds, then as running with no address.

## Fetching for leads

A lead asks Althar to fetch a branch, a tag or a pull request
(`fetch_from_remote`) into its task's repository, whose refs its worktree
shares. Althar fetches with its own sign-in, says the commit it got, never
pushes, never moves a lead's branch, and never hands over a credential. A
lead with the person's own code-host sign-in may fetch with that instead
([what agents may do](what-agents-may-do.md)), but `fetch_from_remote` is
the preferred way when a fetch fails for credentials.

A branch an agent makes from a remote's tracks nothing
(`branch.autoSetupMerge=false`), so `git switch -c x origin/x` never writes
`.git/config`.

## What agents leave running

A lead starts things that outlive the tool call: a dev server, a test
watcher. Althar asks agents for them (the `asyncTasks` capability, which
Claude Code and Codex report) and keeps only commands, in memory, for as
long as the session lives.

- **A row says what it is and where it answers:** its name, its address,
  the last meaningful part of its command (`vp dev`), and how long it has
  run. The whole command shows on hover, and what it printed is one click
  away.
- **Where one answers** is read for its first ten minutes from the first
  local address its output prints, and from the TCP ports its processes
  listen on (`lsof`, `ss` or `netstat`). An address from a port stands until
  the output says one.
- **Stop asks the agent to stop it;** Clear removes one that ended. Ended by
  itself, it stays, saying how, until cleared.
- **The task shows them over its composer,** beside the pull requests it
  listens to (Running and Listening). Stopping Listening means nothing said
  on that pull request reaches the thread after.
- **Closing a session stops everything it left running first.**

OpenCode reports none of this, so its leads show nothing they leave running.

## Settling stops everything

Every way a task settles goes through one place (`LeftBehind.settled`): a
merge, marking done, abandoning, leaving out commits after a merge, a review
posted. In the background, for at most four minutes, it stops:

- every agent on the task (lead, steps, reviewer) once its turn ends, and
  what each left in the background first;
- the task's runs;
- every process outside Althar's own tree whose environment carries the
  task's mark (`ALTHAR_WORK`), with all it started: TERM to it and its group,
  then a kill three seconds later.

What wouldn't stop is one line in the thread. Marking done never waits on
any of it.

**A command an agent left running stops with everything it started**
(`stopping.ts`), however it is stopped: the shell that holds the command's
output file is found with `lsof`, and its tree and group are stopped with
it. A dev server or Storybook no longer outlives its command.

**What Althar lost track of is swept by its mark,** twenty seconds after it
starts and every five minutes after: a process carrying a settled task's or
a removed project's mark stops, and so does an agent left idle a minute on a
settled task. A process with no mark, or a mark this store doesn't know,
such as another Althar's, is never touched.

Reopened, a task's agents start again on demand. A run started on it after
it reopened stays. A settled task's folder is held only by what was started
from it after it settled.

On Windows there are no marks to read, no process groups and no `lsof`, so
settling stops the agents and runs Althar tracks. Codex gives no output file
for a command, so what it left running is stopped through it alone, and the
sweep finds the rest.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 8 Nov 2026: the limits sweep (#696) opened every sandbox's network.
- 8 Nov 2026: Althar repairs a worktree whose link to its repository broke (#654).
- 10 Nov 2026: a running task moves between a worktree and Local, and changes the branch it works toward at any time (a task is a conversation plus parts, [tasks](tasks.md#changing-parts)).
