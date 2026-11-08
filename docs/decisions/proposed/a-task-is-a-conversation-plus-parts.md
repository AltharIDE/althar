# A task is a conversation plus parts, changeable at any time

> A proposal, not built. It would fold into [tasks](../tasks.md),
> [workspaces and runs](../workspaces-and-runs.md), [reviews](../reviews.md),
> [code hosts](../code-hosts.md) and [agents](../agents.md).
> [What this changes](#what-this-changes-in-the-decision-documents) lists
> each section.

- **Status:** Proposed
- **Date:** 2026-11-08
- **Owner:** Runtime and desktop maintainers
- **Amends:** the sections in
  [What this changes](#what-this-changes-in-the-decision-documents), among
  them ADR-035, 072, 091, 093 and 102. This overturns ADR-035's rejection of
  a temporary chat and a shelf for it, as it does
  [`plans/task-as-container.md`](../../plans/task-as-container.md)'s.
- **Context:** On 13 October the person set the direction: a task is a loose
  container, a conversation with an agent plus parts that attach and change at
  any time. The lightest form is a temporary chat on a Scratch shelf off the
  board, and common uses become presets. Since then:
  - #684 added the parts row to a task's header;
  - #689 made the team changeable at any time;
  - #686 added the small-change lane;
  - #663 lets leads start tasks.

  What is left is the model under the row. Today a task's place and target
  freeze at its first step, a review can't run anything, and each kind has its
  own hand-written path to the next (`make_it_a_change`, taking a review
  over). This is phase 5 of
  [capable by default](../../plans/capable-by-default.md#5-the-task-as-parts).
  It takes in phase 4, "Reviews that run things": a review that runs code is
  a review whose workspace moved up, not a path of its own.

  On 8 November the person added a second problem, which the coordinator
  passed on. Althar works well for clear-cut work, but going back and forth
  with a lead is slow and inflexible. A question or a small tweak to a
  finished task starts a fresh session, opens a round with a report to give
  and a whole review, and each fix after the review sets off another whole
  review. With review as a part that runs when work ships, rather than a
  fixed step, the parts model answers that too. The person answered the
  questions behind both on 8 November.

## Decision

- **A task is a conversation with its lead, plus five parts:** Workspace,
  Checked by, Reviewing, Outputs and Access. The team belongs to the
  conversation, and already changes at any time.
- **Every part changes at any time, at once,** by the person, the lead or the
  coordinator, with a line in the thread. Only two moves wait for the person:
  running an outside author's code, and a removal that would lose something.
- **The workspace moves up a step at a time:** none, a copy, a worktree,
  Local. It moves back between a worktree and Local, and down only where
  nothing would be lost. A review that runs code comes from this move.
- **"Run it" on an outside author's code asks how far to trust it:** Run
  safely, the default, or Trust fully. A setting can answer for the person.
- **Clear-cut tasks don't change.** A task sent off with a plan comes back
  reviewed and up as a pull request, draft or ready as its plan says.
- **Talking to a lead is a turn, not a round:** the same session, with no
  step, no report and no review. The turn's last message is its answer.
- **A tweak stays on the task's branch until the person ships it.** Shipping
  is when the review runs: one pass over everything since the last review.
  Then the commits go up.
- **Merge, with commits not shipped, offers two:** Review and merge, or Merge
  now. What Merge now merges is reviewed after the merge.
- **Fixes after a review are checked only where they need it:** a tiny fix
  needs no check, and a bigger one gets one short check by the same reviewer.
  A fix never sets off another whole review.
- **The review after a merge runs in the same task,** which settles as it
  merges and comes back only if the review finds something.
- **A lead starts afresh only when its context is full,** never at a break.
- **Each turn records where its time went,** so "why is it slow" has an
  answer for every turn.
- **Removing a part loses nothing.** Branches, pull requests, findings and
  pictures stay.
- **A temporary chat is a task with a copy and nothing else.** It sits on
  Scratch, off the board, until it takes a worktree or an output.
- **Presets are named sets of starting parts.** Althar ships some, the
  person saves their own from a task, the coordinator offers one when it sees
  a set repeat, and Settings can edit them.
- **The coordinator works out from the person's message** whether it's a
  chat or a task and which preset fits. The person changes it from the
  task's header afterwards, as they change its team.
- **Nothing new stores a task's kind.** Parts are read from the rows that
  already hold them. The [new data](#the-data-model) is small.
- **It is built all together,** once this proposal is accepted.

## The parts

| Part | What it holds | When a task has it | In the parts row |
|---|---|---|---|
| **Workspace** | Where the work happens on disk, per repository: a copy, a worktree or Local, with its branch and the branch it works toward | Every task but one with nothing to read yet | Always, with what runs there |
| **Checked by** | Who reviews this task's own work, and when: before it ships, or after it merges | A change, unless its plan named no reviewer | Where there is a reviewer |
| **Reviewing** | Pull requests this task reviews, each with its drafted review | A review, or any task asked to look at a related pull request | Each pull request reviewed |
| **Outputs** | Pull requests it opened or attached, in any repository; the issue it came from or filed; its pictures and files | As soon as there is one | Each one |
| **Access** | What the lead may run and reach in that code, read from who wrote it | Every task, read from its code's author | Only for an outside author's code |

Each part has one job, so removing one means one thing. "Remove the review"
was ambiguous with a single review part: stop checking my work, or stop
reviewing theirs? Here those are two parts.

**Access shows only where it differs from the team's.** The team's code runs
as everything else does under the project's rules, and the row says nothing
about it (the person's note of 16 October). An outside author's code shows
where it stands: Read only, Runs safely or Trusted.

## Changing parts

- **The person** changes parts from the parts row: Add offers each part the
  task doesn't have, and each part's menu changes or removes it. The change
  is made at once.
- **The lead and the coordinator** change parts at once when the task needs
  it, with `add_part`, `change_part` and `remove_part`, each with a reason.
  For example, a chat whose lead has to write takes a worktree. They share
  these tools, as they share every tool.
- **Every change writes one line in the thread,** saying who changed which
  part and why: "Took a worktree, to write the fix."
- **Two moves wait for the person's own word:**
  - Running an outside author's code ("Run it", below). It is the
    [What stays](../what-agents-may-do.md#what-stays-and-why) line on a
    stranger's code. A lead can suggest it, but never say it.
  - A removal that would lose something, such as a draft review never
    posted. It asks first, on a card.
- **A move that changes the lead's folder waits for its turn to end:**
  between a worktree and Local, and a rebase onto a new target. The lead
  never finds its folder moved under it, and the thread's line says the move
  is waiting. Every other change is made at once, even mid-turn: a copy takes
  its branch where it stands, so a chat's lead that has to write gets its
  worktree without stopping.

`make_it_a_change` and taking a review over go. "Make it a change" is now
adding a worktree, adding Checked by and giving the task an ending, one
part at a time or through a preset. The card's kind label stays, read from
the parts.

## The workspace moves up

```mermaid
flowchart LR
  N["No workspace"] --> C["Copy<br/>at a commit, keeps nothing"]
  C --> W["Worktree<br/>its own branch, kept"]
  W <--> L["Local<br/>the person's checkout"]
```

- **A copy** is a checkout detached at a commit: the default branch's, or a
  pull request's head. It keeps nothing. Today's quick task works in one,
  detached at the default branch, and so does a review, at the pull
  request's head. For the team's own code, the lead can install and run
  things in it. For an outside author's code, Access decides what it may
  run.
- **A worktree** is today's: a folder with the task's own branch, set up
  with the recorded setup, whose commits are kept and can ship.
- **Local** is today's: the person's own checkout, one task at a time.

**Moving up keeps everything.** A copy becomes a worktree by making the
task's branch where it stands. That is today's "a branch on first write",
which stays: where a lead leaves commits or changes in a copy as its turn
ends, Althar moves it up itself, so nothing is lost on a detached head.

**Moving down happens only where nothing would be lost.** A worktree whose
branch has nothing the copy wouldn't have can become a copy again. Otherwise
the way down is removing the workspace, which keeps the branch (below).

**Each repository moves on its own.** A task that reviews a pull request in
one repository and fixes something in another has a copy in the first and a
worktree in the second. Place, a worktree or Local, stays the same for all
of a task's repositories, as it is now.

### Moving between a worktree and Local

This is the Handoff that
[workspaces-and-runs § Local](../workspaces-and-runs.md#local) leaves
unbuilt. A running task moves between turns, with its branch and its
conversation.

- **To Local:** the worktree's uncommitted work is committed to the task's
  branch first. The move then waits, as a second Local task does now, until
  the person's checkout is free and clean. The checkout switches to the
  task's branch, remembering where it was (`returns_to`). The worktree folder
  goes, and the branch stays.
- **To a worktree:** the lead commits its own files by name first, as it
  always does in the person's checkout. Althar commits nothing there, so
  whatever is left uncommitted stays in the checkout as the person's. A
  worktree is made on the task's branch, and the checkout goes back to where
  it was, as it does when a task settles. Where it can't, because it has
  uncommitted changes, it stays and says so.
- **The conversation carries on.** Where the agent can resume its session in
  the new folder, it does. Otherwise the next turn starts a fresh session
  with the thread's handover, as switching the lead does now.
- Every Local rule stays: Althar never switches a checkout with uncommitted
  changes, and never stashes, resets or cleans it.

[ADR-103](103-projects-live-locally-or-on-a-host-and-place-work-in-pools.md)
would pin Local to a named computer's checkout. Moving to Local then means
that computer's.

### Changing the branch a task works toward

- **Before anything is pushed,** Althar rebases the task's branch onto the
  new target between turns. A conflict stops the rebase, names the files and
  hands it to the lead.
- **After a push,** the open pull request can't change its history, so
  Althar does what it does after a merge now. It makes a fresh branch from
  the new target, named for the task with `-2`, and cherry-picks the task's
  own commits onto it. Then it opens a pull request into the new target and
  asks the person whether to close the old one. The old branch isn't
  touched.
- Everything that follows the target, follows the new one: the pull
  request's base, keeping the branch current, the checks compared against,
  and the diff's base.

### Running someone else's pull request

A review that runs code is a review whose workspace moved up, or whose
Access did. There is no separate path.

- **A pull request by the repository's own people** is a member's or a
  collaborator's, on a branch in the repository. Its lead already gets every
  lead tool and the network (the limits sweep, #696). What this adds is the
  workspace: its review starts with a worktree at its head, with the
  recorded setup replayed, so `run_project`, `screenshot` and its tests run
  its code in the sandbox. Any agent may lead it, Codex and the others
  ADR-050 kept from reviews included. The design review becomes this, run
  with the person's skill.
- **An outside author's pull request** starts as a copy, Read only, as it is
  now. None of the repository's settings, hooks or MCP config load, its
  commands reach no network, and only an agent that can be held to reading
  leads it.

**"Run it" is the person's word,** in the thread or from the Access part. It
asks how far to trust the code:

```mermaid
flowchart LR
  R["Read only"] -->|"Run safely"| S["Runs safely"]
  R -->|"Trust fully"| T["Trusted"]
  S -->|"Trust fully"| T
```

- **Run safely,** the default: the copy installs from the lockfile with
  install scripts off. The install reaches only the package registries the
  base branch's config names, never a host the pull request added. Then the
  code's own commands, its tests and its app, run in the sandbox, offline.
  Nothing is copied in from the person's setup, such as `.env`.
- **Trust fully:** the code runs as the team's does, with the recorded setup
  and its files, install scripts and the network. The prompt says so in
  those words.

**A setting can answer the prompt:** "When I say Run it on code from outside
the team": ask each time (the default), run safely, or trust fully. It sits
in Althar's settings, and a project's rules can set their own. The setting
only answers the prompt. The code still runs only once the person says "Run
it".

A project that needs install scripts to run, such as an Electron or
Playwright download, won't fully set up under Run safely. The thread says
what didn't install, and Trust fully is one press away.

## Talking to a lead, and shipping

Most tasks are clear cut, and they work as now: the person sends one off,
and hears of it once it has been reviewed and is up as a pull request. What
changes is going back and forth with a lead, to ask it something or tweak
what it made. That should be as quick as working with the agent on its own.

```mermaid
flowchart LR
  T["The person writes"] --> W["The lead answers,<br/>or tweaks and commits"]
  W --> T
  W --> S{"Ship, or Merge"}
  S -->|"Ship"| R["One review of everything<br/>since the last"] --> P["Pushed"]
  S -->|"Review and merge"| R2["One review"] --> M["Pushed and merged"]
  S -->|"Merge now"| M2["Pushed and merged"] --> A["Reviewed after the merge,<br/>in the same task"]
```

### A message is a turn, not a round

- **What the person says to a lead whose plan is done is a turn** in the
  same session, as is all of a chat. It opens no round and no step, asks for
  no report, and starts no review. The turn's last message is its answer,
  and it already carries everything the person needs (#699).
- **Nothing reminds the lead to report,** and a turn never leaves a task
  Stuck for lacking one. `finish_step` stays for a plan's steps and for
  settling a review.
- **A lead still at its plan's steps** takes the message into the step under
  way, as now.
- **A reply the person hasn't seen** puts the task in Needs you until they
  open it. One they watched arrive doesn't. A question from the lead, or a
  permission it waits on, shows there as now.
- **Althar's own course still opens rounds:** fixing failing checks,
  answering what people said on the pull request, resolving a conflict, and
  Fix it after a review. Those are reviewed as the plan says, and push as
  their turn ends, as now.

### A tweak waits for Ship

- **What the person's turns commit stays on the task's branch,** in its
  worktree or the person's checkout, and isn't pushed. The person tries it
  where it is, with the project running, and asks for more.
- **The header and the card say how much is waiting,** "3 commits not
  shipped", with **Ship**.
- **Shipping is the person's word:** Ship, or "ship it" or "push it" in the
  thread. "Do this and ship it" is the word to ship once that turn is done.
  A lead or the coordinator ships when the person asked it to, as
  `push_to_pull_request` does now.
- **Shipping runs Checked by first:** one review of everything since the last
  review, then the lead settles what it found (below), then the commits go
  up. They go to the open pull request, or to a new one where the last
  merged or closed, or where there was none. A new pull request is a draft or
  ready, as the plan's ending says.
- **A task with no Checked by ships at once.** One whose review runs after
  merge ships at once too, and is reviewed once it merges.
- **The project rule "Push the lead's commits automatically"** keeps pushing
  what Althar's own course commits. What the person's turns commit waits for
  Ship instead. The Push card for a held push stays as it is: it pushes what
  Althar held back, and runs no review.
- **Settling a task with commits not shipped asks first:** Ship, or settle
  and leave them on the branch.

### Merge, with commits not shipped

With nothing waiting, Merge merges as now. With commits not shipped, it
offers two:

- **Review and merge:** one review of the commits waiting. The lead settles
  what it finds, and then they go up and merge. A finding the lead sets aside
  brings the task back to the person before anything merges.
- **Merge now:** the commits go up and merge at once. They are reviewed after
  the merge, in the same task ([below](#after-merge-in-the-same-task)),
  whatever Checked by says.

### The person's words go first

What the person says to an agent already never waits for a place among the
agents at work ([scheduling](../scheduling.md)). What the coordinator passes
on from the person counts as theirs too, so it goes first in the same way.

### A lead's session lasts until it's full

- **A lead is handed to a fresh session only when its context is full:**
  before a turn, once it's past 200,000 tokens or 80% of its window,
  whichever comes first. A break hands nothing over, at any size.
- **So coming back to a task after a pause carries on the conversation,**
  with all the lead knows of the work. Nothing starts afresh, rebuilds a
  brief or reads its files again.
- **The cost:** after a pause longer than its prompt cache's life, the next
  message reads the whole context at full price. The context ring shows the
  size, and Compact stays one press away, as now.
- **A reviewer keeps one session across a review,** as now. That is what
  lets it check fixes (below).

### Where a turn's time goes

**Each turn records where its time went:**

- waiting for a place;
- starting or handing over the session;
- the agent's own work, and the tools it ran.

A ship adds its review and its checks. The turn's line in the thread shows
the total, and opening the line shows the parts. The task adds up all its
turns. A slow turn then says what made it slow.

## Checked by: a task's own review

Checked by holds the reviewer, which is changed where the team is, and when
the review runs:

- **Before it ships,** the default for a change. The review runs as work
  leaves the person's hands. A plan that ends in a pull request ships at its
  end, so its review runs there, as now. After that, each Ship reviews
  everything since the last review. A prototype or an exploration whose plan
  ends without a pull request is reviewed only once the person ships it.
- **After it merges:** the small-change lane, and what Merge now merges.
- **No Checked by:** no review, as for a chat, or a plan that named no
  reviewer.

**The person can run a review at any time:** Review on the Checked by part,
or "review it" in the thread. It reads everything since the last review, and
ships nothing.

**One review covers everything since the last.** Althar keeps, per
repository, the commit each review read up to, and the next one reads from
there: every tweak since, in one pass.

"Make it a full task" on a small change moves its review to before it ships.
Removing Checked by stops a review under way, as Skip the review does.

The task's own reviewer gets a copy it can install in, with the recorded
setup replayed, plus `install_dependencies` and `run_project`. It runs the
task's tests and build before it reports. It still only reads the task's
work: it changes nothing in the task's worktree.

### Fixes are checked by the same reviewer, only where they need it

A fix no longer sets off another whole review.

- **The reviewer's session stays open** while the lead settles its findings.
- **A tiny fix needs no check:** its commit changes ten lines or fewer, all
  in the file its finding named. Althar reads that from the diff.
- **A bigger fix gets one short check.** The same reviewer, its copy moved to
  the fixes, reads only them, against its findings, and says whether each is
  settled. A finding it reopens goes back to the lead once more. That second
  fix isn't read again.
- **The pull request lists the fixes nobody re-read:** the tiny ones, and any
  second fix. A task whose fixes were all tiny or checked keeps its seal.
- **The "Review rounds" setting goes,** since a check is never more than one
  pass. "When rounds run out" keeps its job for a finding the check
  reopened: carry on, or ask the person.

A fresh reviewer for each check, if it's ever wanted, would be a setting
later (the person, 8 November).

### After merge, in the same task

```mermaid
flowchart TD
  M["The pull request merges"] --> S["The task settles"]
  S --> R["Its reviewer reads what merged, in the same thread"]
  R -->|"nothing found"| Q["A line in the thread, nothing else"]
  R -->|"findings"| N["Back in Needs you: Fix it or Leave it"]
  N -->|"Fix it"| F["A round: the fix goes out as After #N"]
  N -->|"Leave it"| D["Settled again; the findings stay in the thread"]
```

This covers a small change, and what Merge now merged on any task.

- **The task settles as it merges,** and leaves the person's plate at once.
  Its reviewer reads a copy at the merged commit, in the task's own thread.
  There is no second task and no second card.
- **If the review finds nothing,** the thread gets a line, with no
  notification and nothing in Needs you.
- **If it finds something,** the task comes back to Needs you with the
  findings and two ways on:
  - **Fix it** opens a round. The lead gets the findings, and its fix goes
    out as the task's next pull request, "After #N", as any round after a
    merge does now.
  - **Leave it** settles the task again. The findings stay in the thread.
- **Nothing is posted on the merged pull request.** The fix's pull request
  says what it fixes.
- **Settling spares this review.** "Settling stops everything" gets one
  exception: the after-merge review's reviewer and its copy run until the
  review ends, and the sweep leaves them alone until then. Everything else
  the task ran stops as it does now. If Althar restarts mid-review, the
  review starts again.
- A fast-lane pull request still carries no seal. A plan that named no
  reviewer, and a pull request closed unmerged, get no review after merge, as
  now.

## Reviewing: pull requests a task reviews

- **Any task can review a pull request:** a change can review a related one,
  and a review can open a pull request of its own by taking a worktree. A
  task can review several.
- **Each pull request reviewed brings its own workspace and Access:** a copy,
  or a worktree for the team's, at its head.
- **Its draft is the person's to post,** as now: from the card, on their
  word in the thread, or by the team-review setting. An outside author's
  draft always waits for them.
- **A task whose only parts are its reviews settles once its drafts are
  posted,** as a review does now. A task with a change of its own settles
  when that merges. A draft still unposted then keeps the task in Needs you
  until the person posts it or drops it.

## Removing a part loses nothing

| Removed | What stays | What goes | Asks first when |
|---|---|---|---|
| **Workspace** | The branch, here and on the remote; Local's checkout goes back as on settling | The folder, after its uncommitted work is committed; what runs there stops | Never: Althar commits nothing in the person's checkout, and says what it left |
| **Checked by** | Findings already filed, in the thread | A review under way stops; no seal | Never |
| **Reviewing** | The thread, and any posted review | Althar stops following that pull request | Its draft was never posted |
| **A pull request, from Outputs** | The pull request, open on the host | Althar stops following it | Never: closing it is a separate move, on the person's word |
| **A picture or file, from Outputs** | The item in the thread | It leaves Outputs and the pull request's screenshots comment | Never |

Access isn't removed. It moves back when the person says "Stop running it":
what runs stops, and the copy is Read only again.

## Chats and Scratch

This overturns ADR-035's and `plans/task-as-container.md`'s "no shelf".

- **A chat is a task with a conversation and a copy of the default branch,**
  and nothing else. It has no plan, no countdown and no Checked by. It starts
  at once.
- **It sits on Scratch, off the board's lanes.** Scratch lists chats by
  their latest exchange. It opens in place from the board, as one chip at
  most, and never as a sidebar ([DESIGN.md](../../../DESIGN.md)). Its look is
  settled by a prototype first.
- **A chat never waits in Needs you for being finished.** Its questions and
  permission requests still show there, as every task's do.
- **It moves to the board as soon as it takes a worktree or an output,**
  including a draft review, and says so in its thread. Nothing moves back to
  Scratch by itself. The person can move a task either way.
- **Chats stay until the person clears them.** Clearing settles a chat, and
  ⌘K (Ctrl+K elsewhere) still finds it. Writing to it again brings it back
  to Scratch. Its copy goes after the usual wait for finished folders, and
  comes back when the chat needs it
  ([finished tasks' folders](../workspaces-and-runs.md#finished-tasks-folders)).
  The copy is made without setup, and the setup replays the first time the
  lead runs something.

## Presets

A preset is a named set of starting parts. It holds a workspace, Checked by
and when, an ending (a draft pull request, one ready for review, or none),
where the task sits, a lead and reviewer or "the coordinator picks", and a
few lines of brief. A preset is only a start: the parts are what a task has,
and changing them never changes the preset.

- **Built in:**
  - Chat
  - Change
  - Small change
  - Review a PR
  - Prototype, led by Claude Opus 5.5 at an effort set by its size (the
    person's notes), reviewed only once it ships
- **Save as preset,** from any task's menu, takes its parts, team and the
  first lines of its brief.
- **The coordinator offers one.** When it sees the person set up the same
  parts more than once, it offers a preset on a card, with a name and what it
  holds. Nobody has to write one.
- **Settings has a page to edit them.** Nobody has to use it.

Presets are the person's, in Althar's settings, and work in every project.
One saved from a task can be kept to that project.

## How a task starts

- **The coordinator works out from the person's message** whether it's a
  chat or a task, and which preset fits. There is no switch in the composer.
  A message that wants a conversation of its own with an agent starts a chat
  at once. One that wants work done gets a plan, whose card names the preset.
  The coordinator still answers itself what it can answer in a line or two.
- **The person changes it afterwards** from the task's header, where a chip
  names the preset, as they change its team. Picking another preset there
  changes the parts to match, under the rules above, so nothing is lost.
- **Tasks that start without going through the coordinator,** from the board
  or from a lead, start as Change unless whoever starts them names a preset.
  The coordinator is always on either way.

## What the board, Needs you and the thread show

- **The board** holds every task but chats. A card's kind is read from its
  parts:
  - **Change:** it has a branch of its own, or a pull request it opened or
    attached;
  - **Review:** it reviews a pull request, with no branch of its own;
  - **nothing:** anything else, such as a prototype.

  "Local" and "→ release/0.8.0" show where they apply, as now. A card with
  commits not shipped says how many.
- **Needs you** is unchanged, but for three things: a chat doesn't wait
  there for being finished, a reply the person hasn't seen waits there until
  they open it, and a settled task comes back when its after-merge review
  finds something.
- **The thread** gets a line for each part change, and each turn's line
  shows where its time went. The header's parts row keeps what #684 built,
  adds Checked by, and adds Access where it shows. A chip names the preset,
  and Ship shows when commits are waiting.

## The data model

There is no parts table, and no stored kind. Each part is read from the rows
that already hold it.

| Part | Read from |
|---|---|
| Workspace | `workspaces` rows, whose `kind` gains `copy` beside `worktree` and `checkout`. Today's review copy (`addReadCopy`) and a quick task's detached worktree both become one. No row means no workspace |
| Checked by | The plan's review step and its reviewer, which gains `when`: before it ships or after it merges. The small-change lane's "skipped before merge" becomes "after it merges" |
| Reviewing | The reviews of pull requests in `Reviews.ts` and their `review_drafts`, now any number per task |
| Outputs | Change sets and `repository_changes`, attached pull requests, the task's issue, and the artifact store, all as now |
| Access | The reviewed code's author, read from the host as now, plus a `trust` the person's "Run it" sets: `read`, `safe` or `full` |

What is new:

- **`tasks.shelf`,** `board` or `scratch`: set by the preset, moved to the
  board by Althar when a task takes a worktree or an output, and moved either
  way by the person.
- **`tasks.preset`:** the preset a task started from, for the header's chip
  and for Save as preset. Nothing reads it for behaviour.
- **`when` on the review step and `trust` on a reviewed pull request,** as
  the table says.
- **The commit the last review read up to,** per task and repository. The
  next review reads from it. Commits not shipped need nothing new: they are
  the branch's commits past where Althar last pushed it, which it already
  keeps.
- **Each turn's timings:** waiting for a place, starting the session, the
  agent's work and its tools, plus a ship's review and checks.
- **One event per part change** (`TaskPartAdded`, `TaskPartChanged`,
  `TaskPartRemoved`), with who made it (the person, the lead or the
  coordinator) and why. The thread's line is read from it.
- **Presets** are data in Althar's settings. The built-in ones live in code.

**Migration:** today's kinds need none, since they are already read from
these rows. Every existing task sits on the board. Read copies made before
this aren't rows: they work as now until they are cleaned, and new copies
are rows. A task's last review reads up to its branch's head as it stands,
so what was reviewed before this isn't reviewed again. The "Review rounds"
setting is dropped.

**The tools:**

- `add_part`, `change_part` and `remove_part` replace `make_it_a_change`, for
  leads and the coordinator alike.
- `start_task`, `propose_plan` and `draft_task` gain `preset`. `works_in` and
  `toward` stay, and `change_part` changes them later.
- `review_pull_request` starts a task from the Review a PR preset. Any other
  task adds a review with `add_part`.
- `ship_task` ships on the person's word, as Ship does.
- "Run it" is not a tool. It is only ever the person's.

## Building it

The person's choice (8 November): this proposal ships first, and then all
of it is built together, rather than in slices that each ship on their own.
Within that build, recording each turn's time goes in first, so the rest can
be measured against today's turns.

It is done when:

- a question to a finished task's lead is answered in the same session, with
  no step, review or handover, and its turn's line shows where the time went;
- a tweak, tried in the person's running project, ships with one review of
  only what changed since the last;
- a review's bigger fix is checked by the same reviewer in one pass, and a
  tiny one by none;
- the person's design-review skill posts on a colleague's pull request, run
  in a worktree at its head;
- "Run it" runs an outside pull request's tests offline;
- a small change's review after merge runs in its own task and thread;
- a chat on Scratch takes a worktree and moves to the board;
- a running task moves between a worktree and Local, and changes the branch
  it works toward;
- a preset is saved from a task, and the coordinator offers one.

## What this changes in the decision documents

| Section | Today | With this |
|---|---|---|
| [tasks § Kinds](../tasks.md#kinds-read-from-what-a-task-has) (ADR-035) | Kinds read from what a task has. No temporary chat and no shelf | Kinds read from its parts. Chats sit on Scratch |
| [tasks § Rounds](../tasks.md#rounds-back-to-work-and-shipping-again) | The person's words to a finished lead open a round with the plan's steps and review. No report means a reminder, then the person | A turn, with no step, report or review. Its commits wait for Ship |
| [tasks § The small-change lane](../tasks.md#the-small-change-lane) and [reviews § A small change is reviewed after it merges](../reviews.md#a-small-change-is-reviewed-after-it-merges) (ADR-102) | A merged small change is reviewed in a task of its own | Reviewed in the same task, which settles as it merges. So is what Merge now merges |
| [reviews § How a review round runs](../reviews.md#how-a-review-round-runs) | A fix that changed code sets off another whole round, up to the "Review rounds" setting | Tiny fixes aren't checked, others get one short check by the same reviewer, and the setting goes |
| [reviews § Reviewing someone else's pull request](../reviews.md#reviewing-someone-elses-pull-request) (ADR-050, ADR-097) | An outside author's code is only read, and a team's is read in a copy | "Run it" asks Run safely or Trust fully, and a team's runs in a worktree |
| [code-hosts § A lead's commits go up as its turn ends](../code-hosts.md#a-leads-commits-go-up-as-its-turn-ends) (ADR-072) | Every turn's commits push as it ends | What the person's turns commit waits for Ship. Althar's own course pushes as now |
| [code-hosts § Attaching a pull request a task didn't open](../code-hosts.md#attaching-a-pull-request-a-task-didnt-open) (ADR-052) | One change set per repository | Unchanged, but where a task reviews several pull requests |
| [workspaces-and-runs § Local](../workspaces-and-runs.md#local) (ADR-091) and [§ The branch a task works toward](../workspaces-and-runs.md#the-branch-a-task-works-toward) (ADR-093) | Fixed at the first step | Change at any time |
| [workspaces-and-runs § Settling stops everything](../workspaces-and-runs.md#settling-stops-everything) | Everything the task ran | All but an after-merge review |
| [agents § Keeping context small](../agents.md#keeping-context-small) | A lead starts afresh at a break past 80,000 tokens | Only when its context is full |
| [what-agents-may-do § What stays](../what-agents-may-do.md#what-stays-and-why) | Running a stranger's code waits for the person | Still, and their word picks how far to trust it |

## Risks and open questions

- **Moving to Local beside the person's own edits** is the move that needs
  the most care. It waits for a free, clean checkout, and Althar never
  commits, stashes or switches anything of the person's.
- **A changed target can conflict.** The rebase and the cherry-picks stop
  and hand the conflict to the lead, as a conflict with the default branch
  does now.
- **A warm session costs more per message** once its prompt cache has
  lapsed. Each turn's record shows what it cost, and Compact stays one press
  away.
- **Work can sit unshipped,** on a branch only on this computer. The card
  says so, and settling asks first.
- **"Tiny" is a rule of thumb:** ten lines, in the finding's file. It can
  let a wrong one-line fix through, so the pull request names each one for a
  reader to look at.
- **An after-merge review keeps working on a settled task.** It spends usage
  after the person has moved on, and needs its exception to the sweep tested
  across a restart.
- **A stranger's lockfile** can point at a git host or a tarball address.
  Run safely fetches from the registries alone, so such entries don't
  install, and the thread names them.
- **The coordinator will sometimes guess wrong** between a chat and a task.
  Parts changing at any time makes that cheap to fix from the header.
- **Scratch grows** until the person clears it. Whether it offers to clear
  chats untouched for a while is left to the prototype.
- **Open:** whether a task should ever have a workspace in one repository at
  Local and in another in a worktree. For now place stays one choice for the
  whole task.

## Alternatives turned down

- **A `task_parts` table.** One read instead of several, but it stores
  something that can disagree with the rows, which is what ADR-035 avoided.
- **A separate path for reviews that run code.** It would be a second
  mechanism for what a workspace's move already does, and two places to keep
  an outside author's code from running.
- **One Review part for both jobs.** It reads naturally, but "remove the
  review" would mean two different things.
- **Pushing a tweak as its turn ends,** as now. The pull request would carry
  work nobody reviewed, and every push sets off the checks. The person drew
  the line at shipping (8 November).
- **Drawing the line by a change's size.** A guess at size is wrong both
  ways. Shipping says what the person means.
- **Reviewing every round of a reviewed task,** as now. It is what makes a
  tweak slow.
- **Always reviewing before a merge.** Every merge would wait. **Never
  waiting** instead would put larger unreviewed work on the default branch
  before anyone read it.
- **A whole new review, or a fresh reviewer, for each fix.** It reads
  everything again and builds its context again. The reviewer that filed the
  findings already knows them.
- **Starting a lead afresh at a break,** as now. It is the cold start the
  person runs into most.
- **Keeping the separate review task after merge.** It means two cards for
  one change.
- **Keeping the task open until its after-merge review ends.** It keeps one
  card, but merged work would sit on the board for the person to wait out.
- **Removing a part undoing it on the host,** by closing the pull request or
  deleting the branch. It is tidier, but loses work without asking.
- **Keeping Local frozen after the first step.** It is safer for the
  person's checkout, but "at any time" would then not hold for the one place
  people move to most.
- **A Chat or Task switch in the composer,** or preset chips in it. Either
  is one more choice on every message, for what the coordinator can work
  out.
- **Built-in presets only, or presets written in Settings first.** The first
  can't capture the person's own uses. The second goes against nobody writing
  config (the person's note of 31 October).
- **"Run it" as always full trust,** or always offline. The first runs a
  stranger's install scripts with the network on one word. The second only
  works where the packages are already cached.
- **Building it in slices that each ship,** the first draft's order. The
  person chose to build it all together.
- **Merging two tasks into one** stays out (the person's note of 7
  November).
