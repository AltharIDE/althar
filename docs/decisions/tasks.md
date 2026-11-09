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
ADR-088,
ADR-102.
Proposed and not built:
[ADR-087](proposed/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md) (helpers).

## What a task is

A task is a conversation with an agent, its lead, together with the parts
it has taken on. There is one primitive, the task, and no separate
temporary chat, prototype or document type. A task is long-lived: the person
keeps talking to it after its plan ends, and nothing it can reach leaves its
lead's work unshippable.

**The direction (the person's note of 13 October).** A task is a loose
container: a conversation, plus parts that attach and change at any time.
The parts are a workspace, a review, outputs and access. The lightest form is
a temporary chat, kept on a Scratch shelf off the board, and common uses
become presets.

**As built**, a task's header shows its parts in a row:

- its worktree;
- its pull requests;
- a review it drafted;
- its issue;
- what it runs;
- what it made.

Each part acts through what the window already does: Merge accepts, Post it
posts a draft, a failing check asks the lead to fix it, and Remove takes the
folder. Add takes on a pull request, opened or attached. A part only the lead
can take on, such as a worktree, a review, an issue or a page, is asked of it
in the person's words. The person can change a task's team, its lead and its
reviewer, at any time, not only before it starts.

**Not built yet:** the Scratch shelf, presets, and moving a running task to
another place or target branch, which can only change until its first step
([workspaces-and-runs.md](workspaces-and-runs.md)). These are in
[open questions](../open-questions.md).

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

**A task only moves toward change, when the person says so.** When they like
what a quick task made, they ask its lead to make it a real thing, and the
lead calls `make_it_a_change`. The task is renamed for what it does now, gets
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
([a task is a conversation plus parts](proposed/a-task-is-a-conversation-plus-parts.md#a-message-is-a-turn-not-a-round)).
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

**Another round ends in Needs you.** Writing to a kept task brings it back.
A round on a settled task that makes nothing new no longer drops silently
back into Settled. Only a merged change goes back to done by itself.

**A reply the person hasn't seen waits in Needs you** (a task is a
conversation plus parts). Where a settled task's lead answers a turn the
person's words began, after they last had it open, its card says "Replied"
(a quick task's, Finished) until they open it, or press Done, which says
they read it. One they watched arrive doesn't: the window marks a task seen
as it becomes ready in front of them. Settling it, by Done, posting its
review or merging, reads what came before.

## The small-change lane

Small changes must be fast (the person's note of 6 November). A change of a
few lines is the exception to the usual course of a change:

- **One step, no countdown.** Its plan holds one step, with the lead on a
  light, quick model (Sonnet at low effort, where the agent lists it). It
  names a reviewer, but the review step is skipped before merge. It starts
  at once, with no countdown to read.
- **Reviewed after it merges.** Its pull request merges on the person's word,
  as every merge does. The merge starts a review task of its own, on the
  merged pull request, which posts what it finds as any review does
  ([reviews.md](reviews.md)). Nothing blocks the merge. A plan that named no
  reviewer gets no review after merge, and neither does a pull request that
  was closed unmerged.
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

## Helpers (proposed)

Proposed: [ADR-087](proposed/087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md)
would let a task's lead start helpers in the background, on any agent and
model, each in a copy of its own. The lead would keep talking with the
person and hear each helper's result as a new turn. When accepted, it folds
into this document as a section on a task's helpers, and into
[scheduling.md](scheduling.md) for the place each helper takes. Two of its
rules are kept already in [what-agents-may-do.md](what-agents-may-do.md):
a helper pushes nothing (for tidiness, so the lead stays the one who
pushes), and its counts are cost caps. Built so far: leads have
`list_models`.

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 9 Nov 2026: what the person says to a lead after its plan is a turn, not a round, and what it commits waits for Ship, which reviews only what came since the last review ([a task is a conversation plus parts](proposed/a-task-is-a-conversation-plus-parts.md)).
