# Tasks

What a task is and what kinds there are; how a task asks the person
something, goes back to work and ships again, waits to be settled, and takes
the fast lane when it's small; the plan and review settings; and what agents
hand back. Reviews have their own document, [reviews.md](reviews.md), and
where a task works has [workspaces-and-runs.md](workspaces-and-runs.md).

**Replaces:** ADR-020,
ADR-021,
ADR-034,
ADR-035,
ADR-051,
ADR-087,
ADR-088,
ADR-102.

## What a task is

A task is a conversation with an agent, its lead, together with the parts
it has taken on. There is one primitive, the task, and no separate
temporary chat, prototype or document type. A task is long-lived: the person
keeps talking to it after its plan ends, and nothing it can reach leaves its
lead's work unshippable.

**The direction (the person's note of 13 October), built in November.** A
task is a loose container: a conversation, plus parts that attach and change
at any time. Each part has one job, so removing one means one thing:

| Part | What it holds | In the parts row |
|---|---|---|
| **Workspace** | Where the work happens: a copy, a worktree or Local, with its branch and what it works toward. One for each of the task's changes in each repository, and one at each pull request it reviews | Always, with what runs there |
| **Checked by** | Who reviews the task's own work, and when: before it ships, or after it merges | Where there is a reviewer |
| **Reviewing** | Pull requests the task reviews, each with its drafted review | Each pull request reviewed |
| **Outputs** | Pull requests it opened or attached, its issue, its pictures and files | Each one |
| **Access** | What the lead may run in that code, read from who wrote it: Read only, Runs safely or Trusted | Only for an outside author's code |

A task's header shows its parts in a row. Each acts through what the window
already does: Merge accepts (on a stacked change, "Merge PR #714, then PR
#715"), Post it posts a draft, a failing check asks the lead to fix it,
Remove takes a settled task's folder, a folder's row moves a running task
between a worktree and Local or points it at another branch, and each
helper at work has Stop. Add takes on a pull request, opened or attached;
what only the lead can take on is asked of it in the person's words. The
person can change a task's team at any time.

## Changing parts

- **The person** changes parts from the parts row and the task's menu:
  moving, pointing elsewhere, Run it, Save as preset, Move to Scratch.
- **The lead and the coordinator** change them at once, on the person's word,
  any task's, the lead's own included (the person's note of 12 November:
  every part changes at any time, up or down, by telling the lead or the
  coordinator, in plain words or by voice, and is never refused or detoured),
  with a reason, with `add_part`, `change_part` and `remove_part`, which they
  share: a worktree taken where a copy stands (its branch made where it
  stands, so nothing is lost on a detached head), another change, a review, a
  pull request followed; a workspace moved or pointed at another branch;
  Scratch or the board; Checked by put on, changed or taken off (`checked_by`,
  a review under way stopping); the ending (`ending`: here, its branch, a
  draft or a ready pull request; an open draft is marked ready, and one open
  where it goes back to its branch is closed, its branch staying; no host
  turns a ready one back into a draft, so the next opens as one); another
  preset's parts at once (`preset`), its lead staying; a review dropped; a
  pull request no longer followed. `change_lead` changes its lead's model
  and effort, and its reviewer, on a lead's own task too. Each says what it
  did in a line of the task's thread.
- **Two moves are the person's word alone:** running an outside author's
  code (Run it, and Stop running it, [reviews](reviews.md#run-it)), and
  removing a review whose draft was never posted, which would lose it.
- **Removing a running task's workspace** drops that change: what it hadn't
  committed is committed first ("Work in progress, as its change was
  dropped"), its folder goes and its branch stays. A task's only worktree
  moves down to a copy, its branch keeping its work.
- **A move that changes the lead's folder waits for its turn to end:**
  between a worktree and Local ([workspaces and
  runs](workspaces-and-runs.md#moving-a-running-task)), and a rebase onto a
  new target. Every other change is made at once.
- `make_it_a_change` stays, for a quick task: adding a worktree, Checked by
  and an ending at once. On any other task (a prototype, a chat planned as
  one) it gives the same review and ending in place, as `change_part` with
  preset Change does, and Ship then reviews it and opens its pull request.
- **The task menu's Make it a change** does that in one press for a task
  that ends with no pull request: a prototype, a chat, a quick task
  (`ShapeTask`).

## A task holds as many changes as it needs

A change is one line of work with its own branch, worktree and pull request,
which ships and is reviewed on its own (`workspaces.name`, one row per
change in each repository, unique per branch). Whether work is one change
or several is the lead's call where the person hasn't said.

- **`start_change`**, for the lead and the coordinator, starts one at once,
  on a branch and worktree of its own beside the first's, from what the task
  works toward, toward another branch, or **stacked** on another change:
  branching from its branch, its pull request going into it. The thread
  marks it as a step of the work ("New change · Lane heights, on
  althar/lane-heights."), and the lead's brief lists every change's folder.
- **Ship ships each change waiting in a Ship of its own,** the bottom of a
  stack first, the next starting once the one before is over: each reviewed
  on its own, its review reading and marking only that change's worktree, so
  the others' marks stay where their last review left them. A change's own
  Ship (its row's, or `ship_task` with `change`) ships it with what waits
  beneath it in its stack. A change whose branch carries commits that wait
  for Ship on the change below is held with them, worked out from git before
  each push.
- **The thread stamps a row** for each change of several as it ships
  ("Shipped · Lane heights, 2 commits to PR #714") and merges ("Merged ·
  Lane heights into main"), as it does for one started. A turn's line says
  where its commits went once the task has several ("Worked for 4m · 2
  commits to Lane heights"): each change's head is read as the turn starts.
- **The card says one sentence across them:** what's alike counted ("Both
  ready to merge", "Waiting for checks on all 3"), else the most pressing
  named ("Lane heights: checks failing"), merged and closed ones left out
  while any is open; a mark for each at its foot, beside "3 changes", in the
  colour of what it means (violet waits on the person, cobalt checks
  running, red failing, green merged, grey the rest).
- **The header's parts list every change:** its name, branch, the change it
  stacks on or waits for, its pull request, whether commits wait for Ship on
  it, and the helper at work on it, with its own Ship.
- **Keep them together** (`join_changes`, and the button on a change's row
  that its lead or the coordinator split) joins two changes before either
  ships: one's own commits are picked onto the other, and its folder goes.
  **Drop it**, on a change the lead's git made, drops it, its branch staying.
- **A change can wait for another to merge** without stacking on it
  (`start_change`'s `waits_for`): both go into the same branch, its row says
  "Waits for Fix main to merge", and once that one merges, what merged is
  brought into it, said in the thread.
- **Merge on a stacked change** merges the one below first, as it stands.
  Once a change merges, each change stacked on it goes into what it went
  into, on the host and in its workspace, said in the thread.
- **The lead's git is followed, not forbidden:** a branch it makes in a
  change's folder becomes a change of the task's, the change that folder
  left keeping its branch and pull request (`away`) until it is worked on
  again; one left detached, or on what it works toward, gets a line. A pull
  request opened outside Althar (`gh pr create`, an MCP server, the
  website) from a change's own branch into what it works toward is that
  change's; one into another base is named in a line and not taken.
- **The task settles once all its changes are done.** "Not done yet" is
  said only once something of it has merged. Outputs groups its pull
  requests by change, and the card counts them ("3 changes").

## Asides

An aside is a chat: a task with a conversation and a copy of the default
branch, and nothing else, kept off the board (`tasks.shelf`, "Scratch" in
the code). It sits beside the coordinator's conversation, as a pill over it:
**Coordinator** first, with Althar's mark, then each aside, the latest
exchange first, a live dot while its agent is at it (`AsideTabs`). Its agent
has the coordinator's tools, and its turns are signed Coordinator too, as
the coordinator's are: an aside is a quick word with the coordinator that
leaves its conversation as it was.

- **Started** with + over the conversation, which turns the coordinator's
  composer to a new aside (`StartTask` with `chat`): the person's words open
  its thread, on the model the composer has picked, with no card in the
  coordinator's conversation. Words the coordinator said, selected, start one
  about them, quoted over the composer and above the person's words. The
  coordinator still starts one at once with `start_task`.
- **Open,** it takes the coordinator's place in the pane: its conversation,
  and the composer every task has, with its own runs over it and its own
  moves, Make it a task and Clear (`AsideMoves`).
- **Made a task,** it moves to the board: by the person's Make it a task,
  from its menu, or by itself once it takes a worktree or an output (a
  branch of its own, a pull request, a drafted review) after it was put
  there, said in its thread. Its pill flies to its card on the board, and
  the coordinator's conversation keeps a line of it ("An aside became a
  task: …"). Nothing moves back by itself; the person can from its menu.
- **Cleared,** it settles, leaves the pills, and ⌘K finds it. Those left a
  week fold into one "N older" pill, which clears them together.
- A call of its that waits on the person still shows in Needs you. With the
  conversation closed, the board keeps the asides behind one chip at the
  head of Up next (`ScratchShelf`), opened in place.

An aside's copy is made without setup: one that only talks never pays for
an install. The setup replays the first time its agent runs a command, or
`run_project`.

## Presets

A preset is a named set of starting parts: where it works, Checked by and
when, its ending, where it sits, its lead and reviewer, and a few lines of
brief (`presets`). Only a start: changing a task's parts never changes it.

- **Built in:** Chat, Change, Small change, Review a PR, and Prototype, led
  by Claude Opus 5.5, with no review, ending with its branch. A prototype may
  later go on as a change in the same task, its pull request ending and its
  review added then, or never: the person decides, so the coordinator and the
  leads never assume either way. On their word it is one move: `change_part`
  with preset Change, or the menu's Make it a change, puts its reviewer on
  and sets its ending as the project's How a task ends says, and Ship then
  runs the review and opens the pull request. A change goes back the same
  way: preset Prototype or Chat takes its review off and its pull request
  away, back to its branch.
- **The plan card's kicker names the preset** its parts are, first: "Change
  · Task board-still". A press on it lists the others, each with what it
  holds; picking one changes the plan's parts to match (`ApplyPreset`): its
  lead and reviewer where the preset names them, Checked by and when, its
  ending, where it works and sits, and its brief added to the task's
  description. A review is offered only the presets that review, and work
  never becomes one. Nothing names the preset once the task starts.
- **The coordinator plans from them:** its brief says to call `list_presets`
  and plan, with `propose_plan`'s `preset`, from the one that fits what the
  person asked: Prototype for a prototype or design directions, Small change
  for a few lines, Chat for a question or a look, Review a PR for a review,
  and Change for the rest; the person's own count too. A lead that drafts tasks
  is told the same. A preset that needs a review and names no reviewer gets
  the plan's own where it is another maker's than the lead's, else the
  strongest model of another maker that can be used, never the lead's own
  model. Leads are named as the agents list their models (Claude Opus 5.5).
- **Save as preset**, in every task's menu, keeps its parts, team and the
  start of its brief.
- **The coordinator offers one:** once the person set up the same parts,
  with the same lead, for two tasks running and no preset has them, its
  thread offers to keep them, once, with a button.
- **Settings** lists them under Tasks, every one of the person's, those kept
  to a project too, with Edit and Remove for their own. Edit opens its row to
  its name, where it works, Checked by, its ending, where it sits, its
  brief, and whether it is kept to the project of the task it was saved
  from; its lead and reviewer come from a task saved again.

## Kinds, read from what a task has

Whether a task ends in a pull request is the person's intent, never a side
effect of the files its lead writes. Its kind is read for each card from the
task's plan, pull requests and review. Nothing stores it, so nothing can
disagree with it.

- **Plain, a quick task.** The coordinator or a lead starts it at once with
  `start_task`, and it has no plan to look over: a question, a quick look, a
  prototype, a release run from this computer. Its plan says it stays here
  (`here`) and ends in nothing. It stays plain whatever its lead writes or
  commits.
- **Review.** It reads someone else's pull request, with nothing of its own
  ([reviews.md](reviews.md)).
- **Change.** Everything else: every planned task, whatever its ending, a
  quick task made a change, and any task with a pull request.

**A task moves toward change, and back, when the person says so.** When they
like what a quick task made, they ask its lead to make it a real thing, and
the lead calls `make_it_a_change` (or `change_part` with preset Change); a
change they want only as its branch, or as a chat, goes back with preset
Prototype or Chat. The task is renamed for what it does now, gets
a review by the model the lead names, and gets an ending: a draft pull
request, or one that is ready for review. A review the person takes over
becomes a change that builds on it. It stays one task, one thread and one
card throughout, and nothing restarts.

**A quick task works in a worktree of its own,** detached at the default
branch's commit and set up as any task's is. It has a scratch folder that git
ignores, for what the lead throws away. Writing in the repository is fine.
Where the lead first leaves new commits or uncommitted changes, Althar makes
the task's branch right there, as the turn ends, so nothing is lost on a
detached head. The branch stays on this computer and the task stays plain.
After `make_it_a_change`, the next `finish_step` goes through the review,
and the run then publishes as any change does, with all the work since the
task started counted as that round's.

**Tasks can be found.** ⌘K (Ctrl+K elsewhere), in a project and on Home,
searches:

- titles and what the person asked;
- the lead's summaries and what it built;
- pull request numbers, branches and the files touched.

The tools' `find_tasks` searches the same.

## The board card

A card opens its task. It says:

- where the task stands, in a word and in its lane's colour;
- its kind: Change, Review, or nothing for a plain task;
- its title;
- one fact: a change's branch, pull request, checks or conflict; a review's
  pull request and findings; or a plain task's pictures or files.

A task with an open call shows once, in Needs you, and its card says the
call's kind and why. A call with no task, such as a question from the
coordinator, is a card of its own.

A card that needs only one press offers it without opening the task: Push,
Merge, Done, Keep for later, and Resolve now for a conflict that is the
person's. Answering a permission or a question still happens in the task,
where its context is.

## Questions to the person

Agents ask the person to choose (Claude Code's AskUserQuestion, Codex's
request_user_input) through ACP form elicitation. A question becomes a call
and an item in its thread, where it is answered. Home, the edge and the
board list it with what it asks.

**A question belongs to the thread, not the session.** It can wait for
hours, longer than the agent's session lasts. While the agent that asked is
still waiting, the answer goes back to it. If that session has gone, the
question stays open and its step waits. The answer is then passed, as a
quiet message from Althar, to the agent next on the thread, which is started
for it. A question is withdrawn only when the agent takes it back, its turn
is stopped, or its task is stopped or abandoned.

Only roles someone answers may ask: the lead and the coordinator. Reviewers,
permission judges and model probes get no way to ask, because a review that
waits on the person holds the task for what is the reviewer's own judgment.

## Rounds: back to work, and shipping again

The board follows what is actually happening.

**The card says Running whenever an agent on the task works.** That means
in a turn, starting, or waiting for a place among the agents at work
([scheduling.md](scheduling.md)), whatever the task was before. A call that
waits on the person still comes first, as Needs you. Once nothing is at
work, the card says what fits what is there now.

**What the person says to a lead after its plan is a turn, not a round**
(a task is a conversation plus parts, below).
It goes to the same session and opens no step: there is no report to give,
no reminder to give one, and no review. The turn's last message is its
answer. What the coordinator passes on from the person counts as theirs. A
lead that calls `finish_step` in such a turn has its summary, evidence and
descriptions kept, and nothing opens. A lead still at its plan's steps takes
the message into the step under way, as before.

**What the turn commits waits for Ship.** As each such turn ends, a worktree
whose head the turn moved is held for Ship (`workspaces.held_at`). The head
each worktree had as the turn began is kept with the turn
(`turn_deliveries.heads`), so this holds after a restart too. From then
until Ship, nothing pushes the branch:

- the person's Push, a lead's `push_to_pull_request` and pushing as the
  lead's turn ends (ADR-072) all refuse it, with ShipRefused;
- failing checks of the pushed head aren't put to the lead, as Ship replaces
  that head, and a conflict waits for Ship's push;
- what people say on the pull request still reaches the lead at once.

The card, the header and Needs you say how much waits, "2 commits not
shipped", with **Ship**, and the task is in Needs you whatever its pushed
head's checks say. Ship (the button, or `ship_task` on the person's word) is
a run of its own with no Implement step. Where the plan has a reviewer before
the work ships, that review runs first and reads only what came after the
commit the last review read, found by its tree, as pushing may have credited
it since. The lead settles what it finds as in any review. Then Ship's ending
sends the commits up: to the open pull request; after the last merged or
closed, in the next ("After #N", on a new branch); where there was none, in
the first, as the plan ends. The hold goes once they're up. A plan with no
reviewer, or whose review runs after the merge, ships at once. A lead that
calls `ship_task` in its own turn ships once that turn ends.

**Bringing the base branch in is never the task's work** (`baseOnly.ts`).
New work is measured by the task's change against its base, from where its
branch forks off it, not by counting commits since the pull request's head. A
merge of main that settled no conflict brings main's commits, which no one
wrote in the task's turns, yet changes nothing of the task's: such commits
are never held for Ship, as a turn's or the person's by hand, and go up to
the open pull request as the lead's turn ends, with no review and no round;
Ship on a hold of only those sends them up the same way. A merge that
settled a conflict, or any commit of the task's own, is new work, as before,
and Ship's review is told how each merge settled with `git show
--remerge-diff`. Sent back by the merge queue for anything but a conflict,
the lead is told an update from main is `update_branch` or the queue, never
the plan's steps again.

**The rounds that are left** are those Althar's own course and
`make_it_a_change` open, and Ship's run. Where a round ends depends on what
it made. New work means new commits in any of the task's repositories, or
uncommitted changes that aren't evidence.

- **Nothing new.** The round closes and the task goes back to where it was.
  A merged task is done again and keeps its settled time.
- **New work, but the turn ended without `finish_step`.** The lead is
  reminded once, and then the round needs the person. If the person gives it
  up, the commits stay on the branch, offered as below.
- **A question.** The task goes to Needs you, and the answer carries the
  round on.
- **New work, finished, and its review passed or settled.** The task is
  ready.
  - With its pull request open, what the round committed is pushed as any
    commit is ([code-hosts.md](code-hosts.md)).
  - With its last pull request merged or closed, the round opens the next by
    itself, as a draft titled "After #N", where the project's rules would
    have opened the first. A card with **Open a new pull request** appears
    only where the lead said it only answered a question (`answered`), or
    where the pull request couldn't open.

The person can skip a round's review from the task's menu, Ship's included.
Only that round loses its review; the next has it again.

**A task has as many pull requests as it needs**, one per repository at a
time.

- **After a merge,** Althar starts a new branch from the default branch as
  the host has it now, named for the task with `-2`, `-3` and so on. It
  cherry-picks the new commits onto that branch, and the worktree moves to
  it.
- **After a pull request was closed unmerged,** the new branch is the task's
  branch as it is, under a new name.

Either way the new branch is pushed plainly, never forced, and the merged or
closed branch isn't touched. Cherry-picking avoids the conflicts that
merging the default branch would bring wherever new work touches lines the
merged work added. A cherry-pick that conflicts stops and names the files,
for the lead to bring the default branch in first.

**Merged with work after it isn't done.** A task is done once each
repository's latest pull request has merged and nothing after them changes
anything. Commits after the last pull request keep it open and ready.
Commits the default branch already has, merged in or cherry-picked under
another hash, count for nothing. The task keeps every pull request. Its
card and header show the latest, with the earlier ones under it.

**Whatever puts a task before the person, the task offers a way out of.**
For a merged task with commits after its pull requests, Abandon leaves those
commits out and settles it as done. The commits stay on its branch, marked
in a ref of Althar's, and only what comes after that mark counts again.

**Across a restart,** a round whose lead was in a turn carries on. One whose
lead's last turn had completed is judged as that turn's end would have been.

## Needs you and settling

**Opening a task moves nothing.** Only the person moves a finished task
on.

**A finished task that isn't a change waits in Needs you,** counted as any
ready task is: on the board, Home, the edge, the tabs and in notifications.
It shows two ways on, in its card's corner and inside the chip that says
where it stands in its header:

- **Done** settles it. It first stops what its agents left running, and a
  task where that won't stop stays unsettled, with a message saying so.
- **Keep for later** takes it out of Needs you as it is. Kept tasks show
  under Kept, beside Settled.

A review with a draft only keeps: it settles once its draft is posted. A
change settles when its pull request merges, or when it is abandoned.

The person can also tell the lead, which has `settle_task` (done, keep or
discard). The composer suggests "Mark this as done". The coordinator settles
with the same tool ([coordinator.md](coordinator.md#moving-a-task)).

**Another turn ends in Needs you.** Writing to a kept task brings it back.
A turn on a settled task stays a turn: the task stays settled, and its
lead's answer waits in Needs you, as below. Only a merged change goes back
to done by itself.

**A reply the person hasn't seen waits in Needs you** (a task is a
conversation plus parts). Where a settled task's lead answers a turn the
person's words began, after they last had it open, its card says "Replied"
(a quick task's, Finished) until they open it, or press Done, which says
they read it. One they watched arrive doesn't: the window marks a task seen
as it becomes ready in front of them. Settling it, by Done, posting its
review or merging, reads what came before; and a lead that settles it as
they told it to answers with that, so nothing waits to be read.

## The small-change lane

Small changes must be fast (the person's note of 6 November). A change of a
few lines is the exception to the usual course of a change:

- **One step, no countdown.** Its plan holds one step, with the lead on a
  light, quick model (Sonnet at low effort, where the agent lists it). It
  names a reviewer, but the review step is skipped before merge. It starts
  at once, with no countdown to read.
- **Reviewed after it merges, in the same task.** Its pull request merges on
  the person's word, as every merge does, and the task settles. Its own
  reviewer then reads what merged, in a thread of the task's, and reports in
  the task's thread ([reviews.md](reviews.md#a-small-change-is-reviewed-after-it-merges)).
  Nothing is posted on the merged pull request, and no second task is made.
  Nothing blocks the merge. By the project's rule, only blocking and major
  findings bring the task back (the default), every finding does, or there
  is no review after the merge; one small change may keep or drop its own
  ([reviews.md](reviews.md#what-the-review-after-a-merge-brings-back)). A
  plan that named no reviewer gets no review after merge, and neither does a
  pull request that was closed unmerged.
- **One card in its thread says what it skipped.** It lists each step with
  its time (Started, Changed a line in …, Checks pass, Merged). It offers
  Merge, which still asks, and **Make it a full task**, which starts the
  review before the merge instead. The card is read from the task as it
  stands, never stored, so it can't go stale.

The trade-off is that a small change merges unreviewed. A finding after the
merge needs a fix of its own. Make it a full task is there for anything the
person wants read first.

**Auto moves a lead's next step to a lighter model of the same agent** when
the plan's tightest window is 90% used or more. A line in the thread says
from which model to which, the share used, the window and when it resets.
Keep turns it back, for the whole task; Undo puts the move back. How models
are picked is in [agents.md](agents.md).

## Plan and review settings

Two settings, under Settings › Tasks › Every task:

- **The countdown before a plan starts on its own:** right away, 10 s, 25 s
  (the default) or 1 minute.
- **When a check finds more:** what happens when the check of a fix reopens
  a finding and the lead settles it again, a fix no review reads
  ([reviews](reviews.md#how-a-review-round-runs)). By default the task goes
  on to its ending once the lead has settled every finding; the other
  choice asks the person. The old "Rounds of review" setting is gone from
  the screen: a fix is checked once at most. What it kept is kept, and read
  by nothing.

Each is read where it applies, not when Althar starts, so a change holds
from the next plan or round without a restart. A plan already counting down
keeps the wait it was given, and its card draws the countdown it has. When a
quiet turn is restarted, and when agents check in, are Althar's to manage,
not settings.

**New-project defaults** seed a project's first rules when the project is
made:

- **What no rule keeps.** By default, allow everything except what can't be
  undone. The other choices are "Ask about more" and "The coordinator
  decides", which is never the default
  ([what-agents-may-do.md](what-agents-may-do.md)).
- **What a usage limit does:** move the work on, wait, or ask.
- **Whether work tries an agent's next account first.**
- **How a task ends:** a draft pull request (the default), one ready for
  review, or nothing.
- **What a small change's review after it merges brings back:** only major
  findings (the default), every finding, or no review
  ([reviews.md](reviews.md#what-the-review-after-a-merge-brings-back)).

Only what differs from the built-in defaults is written. A project made
earlier keeps its own rules, and its rules screen is where they change. The
lead and the reviewer aren't defaults: the coordinator picks them for each
plan from the models that are free ([agents.md](agents.md)).

## What agents hand back

Agents hand back more than words: screenshots, pictures a tool read,
documents they wrote, files they point at, and command output. Althar asks
each agent for command output and normalizes what each one sends.

- **Bytes go to the artifact store, never to a database row.** Files live
  under the profile, named by their SHA-256, and are written and renamed
  into place before their row is committed. The same picture twice is one
  file. A thread item keeps what a picture is (digest, type, size), or why it
  wasn't kept. That keeps the database, its WAL and its backups small, and
  keeps what a command printed, such as a token, out of the canonical record.
- **What is kept, and how much:**
  - A picture up to 20 MB, of a kind the window draws (PNG, JPEG, GIF or
    WebP, told by its bytes).
  - A command's output once it ends: its last 256 KB, cut at a line, with a
    count of the lines before it that weren't kept.
  - Both are marked as possibly holding secrets.
  - A picture behind a link is read only from inside the agent's folders, or
    from a `data:` address.
  - A file is kept by its path alone.
- **Running output isn't written while it runs.** The window gets the last
  400 lines live, and the output is kept when the command or turn ends.
  Claude Code sends its output only at the end.
- **The window reads more when the person looks.** That includes a
  command's whole kept output, and a markdown document the agent wrote, read
  from the worktree as it is now. Once a finished task's folder is removed,
  a document it committed reads from the commit Althar kept. Pictures are
  served by the main process from the store, with a 1,120 px copy for the
  thread, and the window never names a path.

**Not built yet:** sweeping the store. Files whose rows are gone, and old
pictures and logs, stay until mark-and-sweep is built
([07](../architecture/07-persistence-security-and-cloud.md)).

## Helpers

A task's lead starts helpers (`start_helper`, `stop_helper`): another
agent, on any agent and model, its own without one, that works in the
background while the person keeps talking to the lead, and whose result
comes back as a new turn, the same on every agent (ADR-087). It takes a
brief, whole, since a helper reads nothing of the conversation, a name, and
optionally a model, an agent, an effort and the change.

- **Handed a change, it works in that change's worktree,** the only one
  writing there until it reports, so its commits are on the change's branch
  when it's done and nothing needs bringing back.
- **Given `in_copy`, it works in a copy of its own** of that worktree as it
  stands, untracked files too, under `.helpers/` beside the task's folder.
  What it changes there is thrown away with the copy, unless it `writes`:
  then it is committed on its snapshot and kept on
  `refs/althar/helpers/<task>/<helper>`, never pushed, and its result says
  how to bring it in (`git cherry-pick --no-commit`), the lead settling any
  conflict as it does with main. The ref goes once its task settles.
- **It is a session of its own** in a step thread of the task's
  (`helpers`). It reads and works in its folder; it ships, asks and starts
  nothing, and pushes nothing.
- **It takes a place of its own** among the agents at work, apart from its
  lead's and its reviewer's: four of a task's at once, the rest waiting, ten
  at work or waiting, fifty in the task's life, one level deep.
- **Its last message is its result,** once its turn ends and it is done:
  kept on its thread and in the lead's scratch folder, then queued to the
  lead as quiet news, never the person's word, which starts a lead that
  stopped.
- **What goes wrong is its lead's to hear:** a turn that fails on its
  service is tried again after each of a step's pauses (15 s, 1 min, 4 min),
  said on its thread, then the lead hears it couldn't go on, with the models
  it may use now; so does one out of usage, one past its hour, and one whose
  agent stops before it's done. The stall watch stops one that stalls. After
  a restart, one at work carries on, told why. Settling the task stops its
  helpers quietly.
- **The lead's report waits for it:** while one works, the step's watch
  counts it as a turn to come, `finish_step` is refused naming it, and the
  lead's brief lists it. The person stops one from its row in the header's
  parts.
- **The thread shows each as a row of the work,** "Helper · Split the
  migration, on the task's change", which opens in place to what it said
  and ran. The Graph face draws helpers on lanes of their models, in the
  round each started in, and a usage line where several models ran says
  each one's tokens.
- **Each agent's own helpers that would work in the background are off,**
  at its launch, as they hold the lead's turn, lose their result or start
  turns over ACP: Claude Code (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`),
  OpenCode, Codex (`features.multi_agent`), Copilot (`--excluded-tools
  task`), Grok, Mistral Vibe and Antigravity (`start_subagent`). Kimi's
  switch is in the person's own config, and Qwen Code's and Junie's have
  none, so theirs stay, each said in its registry entry (`ownHelpers`). A
  lead's brief says to use its agent's own only within its turn, and
  `start_helper` for the rest.
- **Proven on every agent the tests run,** each as a helper, launched in
  its copy and never its lead's folder, its result coming to the lead; on
  real accounts with `bun run test:agents` before a release.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 9 Nov 2026: what the person says to a lead after its plan is a turn, not a round, and what it commits waits for Ship, which reviews only what came since the last review (a task is a conversation plus parts).
- 10 Nov 2026: a task is a conversation plus parts, built (#739) and folded in from its proposal: the five parts and changing them, several changes in a task and stacks, chats on Scratch, presets, and helpers handed a change (ADR-087's tasks 1 to 5); what it decided and didn't build is under Not built yet.
- 10 Nov 2026: the rest of it built (#739): each change shipped in a Ship of its own with its own review, the card's sentence and marks across changes, the header's row for each, stamped Shipped and Merged rows, where a turn's commits went; Keep them together, Drop it, a change that waits for another, removing a running task's workspace; Stop running it; picking another preset on the plan card, the coordinator planning from presets, editing them in Settings; Scratch's own shelf and a chat's copy made without setup. ADR-087 folded in whole and removed from `proposed/`: helpers in copies of their own, writing ones' commits, places, limits, retries, the hour, restarts, agents' own helpers switched off, and the thread, Graph face and usage by model.
- 11 Nov 2026: chats are asides, pills over the coordinator's conversation with a composer and moves of their own, started there or from the coordinator's words; one made a task flies to the board and the coordinator's conversation notes it; the coordinator's turns are signed with Althar's mark ([Asides](#asides)).
- 12 Nov 2026: commits that only bring the base branch in, as a clean merge of main, are never the task's work: no hold for Ship, no review, no round; they go up to the open pull request (#773's merge of main had started a second Review and Pull request).
- 12 Nov 2026: every part changes either way on the person's word to the lead or the coordinator, the lead's own task included: `change_part` sets Checked by, the ending and another preset's parts at once, `change_lead` acts on a lead's own task, Ship honours an ending of its branch alone, and the task menu has Make it a change; a prototype becomes a change in one move, and a change goes back.
