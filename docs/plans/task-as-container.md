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
  - **Change:** its plan ends in a pull request (`end` is `draft`, `ready`
    or `none`), or it has commits or a pull request. A docs pull request is
    a change.
  - **Review:** it reviews someone else's pull request, and has no branch
    of its own.
  - **Plain:** everything else: a question, a prototype, a release from
    this Mac, a walk through the code.
- **A task only moves toward Change.** A plain task that writes becomes a
  change; a review the person takes over becomes a change that builds on
  it. One task, one thread, one card: nothing restarts.
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

## Plain tasks: a copy first, a worktree on first write

- A plain task starts on a read-only copy of its repositories (as the
  coordinator's folder is), not a worktree: no branch, no install.
- When its lead needs to change files it asks Althar (`need_worktree`).
  Althar makes a worktree at the commit the copy was at, on a branch named as
  any task's, and hands the lead to a fresh session in it, briefed from the
  thread as the coordinator's handover is (ADR-031). The task is a change
  from then: its next round has the project's usual steps and ending.
- The coordinator retitles it at its next turn (a `rename_task` tool, and a
  line in its news), keeping what the person asked in the thread.
- "Fix it" on a finished plain task continues the same task: a follow-up
  round (ADR-034) whose lead asks for a worktree.

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

One branch, one pull request, built in this order:

1. Cards with nothing to press, the kinds, Finished and Done.
2. Reviews end to end.
3. Search.
4. Plain tasks on a copy, a worktree on first write.
5. ADR-035, the glossary, and this plan settled.
