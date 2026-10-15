# Tasks whose kind follows what they make, and cards with nothing to press

> **Temporary.** The build plan for DEV-96, not architecture. The lasting
> model is [ADR-035](../decisions/035-a-task-s-kind-is-read-from-what-it-has.md);
> delete this file when the last step ships, and move anything else that
> lasted into the architecture docs.

Decided with the user on 13 October 2026, after prototypes of a shelf of
temporary chats, presets, and several card styles (the prototypes are kept
locally, in `packages/ui/src/prototypes/task-as-container/`, not committed).

## The model

- **One primitive, the task.** No temporary chats, no prototype primitive,
  no shelf. The coordinator starts each task configured; it can reshape
  itself later; everything is on the board.
- **A task's kind is read from what it has, never stored.**
  - **Plain:** a quick task, one the coordinator starts at once with
    `start_task` (a question, a prototype, a release from this Mac, a walk
    through the code), whose plan stays on this Mac (`here`), ends in
    nothing, and has no pull request, whatever its lead wrote.
  - **Review:** it reviews someone else's pull request, and has no work of
    its own.
  - **Change:** everything else: every planned task, whatever its plan's
    end; a quick task the person had made a change; any task with a pull
    request. A docs pull request is a change.
- **A task only moves toward Change, when the person says so.** A quick
  task's lead makes it a change when the person asks; a review the person
  takes over becomes a change that builds on it. One task, one thread, one
  card: nothing restarts.
- **A card has nothing to press.** The whole card opens its task, where a
  permission is answered and the lead is told what's next.

## What each card shows

The card is one button. Its top line says where the task stands in a word, in
the lane's colour (cobalt running, violet needing you), then its kind's word
(Change, Review; nothing for a plain task), then how long. Then its title.
Then, at most, one card in the card and one fact under it:

| | Running | Needs you | Settled (a row, as now) |
|---|---|---|---|
| Change | The step track (calmer: a still bar with a slow sheen), its branch and size, or its pull request | Its pull request and size; the checks (`All 8 checks passed`), or a conflict, warm with an icon (`Conflicts with main in 2 files`) | Merged, PR #143 |
| Review | Their pull request (number, whose, size); `1 finding so far` | Their pull request; **`3 findings`** a little louder, then `1 blocking · request changes` | Posted, with its verdict |
| Plain | `Working`, its title, nothing else | Why it needs you (Question, Stuck, Permission, with the agent's reason), or `Finished`; pictures or files it handed back, small | Done |

- A task with an open call shows **once**, in Needs you: its card says the
  call's kind and why. A call with no task (the coordinator's question) is
  still a card of its own.
- **Finished, then Done:** a plain task that finished and the person hasn't
  opened sits in the project's Needs you as `Finished`. Opening it settles
  it as `Done`. Not on the home, the edge or in notifications.
- Up next and Settled stay rows, with the kind's word where there is one.

## Reviews

- Started by asking the coordinator (`review_pull_request`), or by pasting a
  pull request's link in its composer and asking.
- The lead reads a read-only copy of their head, fetched by Althar. It never
  runs the pull request's code: reader mode, the reader rules. For a pull
  request from outside (a fork, or an author GitHub doesn't name a member or
  collaborator) it also has no network.
- It drafts a review with a tool (`draft_review`): verdict, summary,
  comments on lines with a severity each. The draft is a card in the task's
  thread: keep or drop each comment, choose the verdict (the lead's is a
  suggestion; Approve is never chosen for the person on an outside pull
  request), Post. Nothing reaches GitHub until then.
- **A setting of the person's own** (Settings, not a project's rules):
  "Post reviews of my team's pull requests without asking", off by default.
  Reviews of outside pull requests always wait for Post.
- Posted, the card folds to a line with the review's link; the task settles.

## Plain tasks: no branch first, a branch on first write, a change when the person asks

What was built (14 October 2026), refined with the person from what was
planned here:

- A task the coordinator starts with `start_task` (no plan: a question, a
  quick look, a prototype, a release run from this Mac) is a quick task, and
  plain. Its plan says it stays here (`PlanParameters.here`) and ends in
  nothing. It starts in a worktree of its own with **no branch**, detached at
  the commit its default branch is at, its branch's name planned as any
  task's (`workspaces.branch`) and `workspaces.branched_at` null (migration
  0031). Planned tasks (`propose_plan`) are unchanged: on a branch from the
  start.
- Its setup (ADR-023) still runs, so the project's tools work in its lead's
  sandbox.
- It has a scratch folder, `.althar/scratch/`, whose own `.gitignore`
  ignores everything in it, so git sees nothing there and no tracked file or
  repository setting changes. Its lead's brief says: this task is for trying
  something out, and nothing of it leaves this Mac; throwaway files
  (prototypes, notes, screenshots) go in the scratch folder; writing in the
  repository is fine and stays on a local branch; and if the person asks to
  make it a real change, call `make_it_a_change`.
- **First write keeps the work safe, and nothing more.** Whenever its lead's
  turn ends, and when it calls `finish_step`, a quick task with new commits
  or changes not committed that aren't evidence or scratch gets its branch
  right there (`git switch -c`, carrying both), under the task's lock, so it
  never runs beside publishing it, and nothing is lost on a detached head.
  Althar records `workspace.branched` (`from: null`), says in the thread
  "This task's work is on a branch of its own now, althar/…, which stays on
  this Mac", and reads its card and its search row again. The task stays
  plain: Finished when its lead is done, Done once seen, its branch shown on
  its card and its row. Nothing is pushed and no pull request opens, with
  its host connected or not, and a round of it offers none. The lead keeps
  its session and folder.
- **Made a change when the person asks.** As the person tries what the
  lead made, they may say: I really like this, can we make it a real thing?
  The lead calls `make_it_a_change` with a title for what the change does, a
  reviewer (a model, as `propose_plan` names one; none only where the person
  said so) and a pull request, a draft or ready for review. Its branch is
  made then where it has none; in one transaction the task is renamed
  (`Tasks.rename`, so its card and its search row follow), its plan, the
  plan's run and the run under way take the review and the ending and drop
  `here`, its thread says "This task is a change now: reviewed by …, it
  opens a draft pull request when it's done", and the coordinator's news
  says what it became. A round under way publishes when it is done
  (`PlanParameters.publishes`), with all the work since the task started
  counted as the round's, so all of it is reviewed; where the last run had
  ended and no round is under way, one opens with the new ending. The lead's
  next `finish_step` goes through the review, then the pull request opens.
  The tool is offered only on a quick task not made one yet, and refused,
  with why, on a planned task, a review and one made a change already.
- A quick task started before its plan said `here` is read as a change, as
  it was once it had a branch.
- With no branch there is nothing to ship: the board shows no branch or
  size, and publishing, merging here and pushing refuse or aren't offered.
- "Fix it" on a finished plain task continues the same task: a follow-up
  round (ADR-034) in the same folder, which branches it if it writes, and
  stays plain.

What changed from the plan, and why:

- **The same folder, not a copy.** A copy and a worktree made at first write
  would move the lead to a new folder mid-task: its paths, what it left
  running, and the prototype it was serving would all be somewhere else.
  A worktree with no branch keeps everything where it is.
- **The same session, no `need_worktree` and no handover.** A fresh session
  briefed from the thread loses the agent's own context exactly when the work
  turns into a change. Reading what the lead did, rather than asking it to
  ask, also catches a lead that writes without asking.
- **Setup kept.** The plan said no install; without one, a lead's quick look
  that runs the project's tests or tools fails in its sandbox, which refuses
  the package manager's cache outside the worktree. Correctness wins over
  the install's cost.
- **First write no longer makes a change** (the person's decision, 14
  October). As first built, a quick task that wrote became a change on its
  branch, the coordinator retitled it, and it published as the project's
  changes do: a prototype opened a draft pull request once its host was
  connected (PR #162), which nobody asked for. Whether a task ends in a pull
  request is the person's intent, never a side effect of files being
  written: in the person's words, prototyping, they tell the lead they like
  it and ask to make it a real thing, and the lead renames the task, adds
  the review step, and adds an output, a pull request. So the kind follows
  the plan, not the branch, and the coordinator no longer hears of a first
  write.

## Search

- ⌘K in a project, and on the home across projects: a field and a list of
  tasks; a result opens the task.
- It matches titles, what the person asked, the lead's finishing summaries
  and what it built, pull request numbers, branches, and files touched, with
  SQLite's full-text search, kept current as those change.
- The coordinator gets `find_tasks`, which searches the same.

## Not now

- The triage checkpoint (PR #116's exploration). The running card's top line
  and the task's shape leave room for it.
- Merging once checks pass (DEV-91), as a change's state.

## Order

One branch, one pull request, built in this order, all of it by 14 October:

1. Cards with nothing to press, the kinds, Finished and Done.
2. Reviews end to end, and then held harder after a review: a review's lead
   loads none of the repository's settings, hooks or plugins, has only a
   review's tools, and meets reader rules that judge what runs rather than
   its name. Codex leads no review of someone else's pull request: codex-acp
   can't make it ask before a command its sandbox contains.
3. Search.
4. Plain tasks with no branch, a branch on first write.
5. ADR-035, the glossary, and this plan settled.

## After this

- The task's screen still offers a quick task with a branch the same ways
  to ship as a change (open a pull request, merge here); the person asking
  its lead is the way meant for it.
- Widening a review (run its tests, read the web) and taking a review over as
  a change aren't built.
- A bare `#123` in a project of several hosted repositories asks for the
  link; in a fork's project a bare number may look on the fork.
- Not yet checked against real sessions: Claude Code's sandbox network
  allowlist, OpenCode's environment flags, and a review posted to a real
  GitHub account.
- A person's PATH with relative entries (`node_modules/.bin`) could resolve
  a bare `cat` into the repository; the reader rules can't see that.
