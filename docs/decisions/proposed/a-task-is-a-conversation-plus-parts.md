# A task is a conversation plus parts, changeable at any time

> A proposal, not built. It would fold into [tasks](../tasks.md),
> [workspaces and runs](../workspaces-and-runs.md), [reviews](../reviews.md),
> [code hosts](../code-hosts.md), [agents](../agents.md) and
> [what agents may do](../what-agents-may-do.md).
> [What this changes](#what-this-changes-in-the-decision-documents) lists
> each section.

- **Status:** Proposed
- **Date:** 2026-11-08
- **Owner:** Runtime and desktop maintainers
- **Amends:** the sections in
  [What this changes](#what-this-changes-in-the-decision-documents), among
  them ADR-035, 072, 091, 093 and 102, and the proposed ADR-087's helpers,
  which can be handed a change. It builds the Scratch shelf, presets
  and moving a running task, which [tasks § What a task is](../tasks.md#what-a-task-is)
  records as the 13 October direction and lists as not built. Only the old
  ADR-035 rejected a shelf, and that direction overtook it, as it did
  [`plans/task-as-container.md`](../../plans/task-as-container.md).
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

  Later that day the person asked whether one chat could open several pull
  requests, in parallel even, as Claude Code can. A task then held one per
  repository at a time. Offered several changes in one task, a task for
  each, or no change, they chose the first: "As hard as it is, it has to be
  A. People's asks are not always clear cut."

## Decision

- **A task is a conversation with its lead, plus five parts:** Workspace,
  Checked by, Reviewing, Outputs and Access. The team belongs to the
  conversation, and already changes at any time.
- **Every part changes at any time, at once,** by the person, the lead or the
  coordinator, with a line in the thread. Only two moves wait for the person:
  running an outside author's code, and a removal that would lose something.
- **A task holds as many changes as it needs, at once,** in one repository
  or several. Each has its own branch, worktree and pull request, and ships
  and is reviewed on its own.
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
  Then the commits go up. Until then the branch is held: nothing pushes it
  but Ship, Althar's own course included.
- **Merge, with commits not shipped, offers two:** Review and merge, or Merge
  now. What Merge now merges is reviewed after the merge, where the task has
  a reviewer.
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
| **Workspace** | Where the work happens on disk: a copy, a worktree or Local, with its branch and the branch it works toward. One for each of the task's changes in each repository it touches, or a copy before there is a change; and one at each pull request it reviews | Every task but one with nothing to read yet | Always, with what runs there |
| **Checked by** | Who reviews this task's own work, and when: before it ships, or after it merges. Each change is reviewed on its own | A change, unless its plan named no reviewer | Where there is a reviewer |
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
  is made at once. Access is the exception: every task has it, and its menu
  offers only Run it, or Stop running it once the code runs, with no Remove.
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

## A task holds as many changes as it needs

People's asks aren't always clear cut. One conversation can turn into two
fixes, or a fix and a refactor that should go up apart. So a task holds any
number of changes at once, in one repository or several (the person, 8
November).

```mermaid
flowchart LR
  T["One task:<br/>the conversation with its lead"] --> A["Change 1<br/>branch, worktree, #712"]
  T --> B["Change 2<br/>branch, worktree, #714"]
  T --> C["Change 3, stacked on 2<br/>branch, worktree, #715"]
  T -.-> R["Reviewing #698<br/>a copy at its head"]
```

How others do it is in
[several pull requests from one conversation](../../research/several-pull-requests-from-one-conversation.md).
T3 Code, Orca, Agent Orchestrator and Claude Code all let one conversation
hold several pull requests now, T3 Code and Orca only since September and
October, and Paradev's users ask for it. Their bugs come from the same few
places, and the rules below keep clear of each.

Where the rest of this proposal says "the task's branch", it means each
change's. A move between a worktree and Local, a new target, the hold for
Ship and the review's mark each belong to one change.

### What a change is

- **A change is one line of work:** a branch in each repository it touches,
  a worktree for each, the branch it works toward, and its pull requests.
  It is today's change set, which already holds a branch and a pull request
  per repository. A task held one at a time. Now it holds as many as it
  needs, and a task that never splits has one, as now.
- **Each change has its own worktree,** since git lets only one folder have
  a branch checked out. The first keeps today's path,
  `~/Althar/<project>/<task>/<repository>`. The others sit beside it, named
  for their branches, so the task's folder holds them all. The lead's
  sandbox and "Open in editor" already take the whole task's folder.
- **The lead works in all of them,** from the task's folder, as a lead across
  several repositories does now. Its brief names each change, with its
  folder, branch, pull request and what waits. A commit belongs to the
  change whose branch it is on, and the turn's line says which.
- **A change's worktree stays on its branch.** The lead starts a change
  rather than switch branches in one. Where a worktree's branch changed
  anyway, Althar reads it from git as the turn ends and says so, and the
  lead switches back or makes it a change of its own. A worktree that
  carries several branches in turn is where Orca, Paradev and Agent
  Orchestrator showed the wrong pull request.
- **Each pull request is recorded as it is made:** by Ship or
  `open_pull_request`, or by attaching one. Where the lead ran `gh pr
  create` itself, Althar reads the address from the command's output, as T3
  Code does. Althar never finds a task's pull requests by branch name, which
  is Agent Orchestrator's longest-running family of bugs.

### Starting and splitting

- **A change starts at once,** on the word of the person, the lead or the
  coordinator, with a line in the thread: "Started a second change,
  `althar/rename-setting`, toward main, to keep the rename apart." The person
  asks for one ("split this into two pull requests", "fix that too, but
  separately"), or the lead starts one when the work falls apart into two.
- **It branches from what it works toward:** the default branch, or another
  of the task's changes, which stacks it on that one. Its pull request then
  targets the change below. When that one merges, Althar retargets the one
  above to what the merged one worked toward, as changing the target does
  ([below](#changing-the-branch-a-task-works-toward)). Keeping a stack
  current brings the target into its bottom change, and each change above
  takes the one below it.
- **Splitting work already made** moves only what hasn't shipped. The lead
  makes the new change and carries the commits or files across, with git,
  as it would by hand. A pull request's pushed history is never rewritten,
  as now.

### Each change ships and is followed on its own

- **Each change has its own hold for Ship, its own review mark, and its own
  pull request, checks and seal.** Ship on a change ships that one. "Ship
  it" in the thread ships what the person was just working on, and the lead
  asks which in a line where that isn't plain. "Ship them all" ships every
  change waiting, each with its own review.
- **Each pull request is followed on its own:** the checks of its head, what
  people say on it, and its conflicts. What Althar's course brings for
  several at once, such as failing checks on two, reaches the lead as one
  turn that names each change and pull request. It is never a turn for each
  pull request, as T3 Code's was, and never "your pull request", as Agent
  Orchestrator's was.
- **Every line in the thread, card and message to the lead names the change
  it is about,** and every push, review and merge names its pull request.

### Working on several at once

- **The lead hands a change to a helper**
  ([ADR-087](087-a-lead-starts-helpers-on-any-agent-in-copies-of-their-own.md),
  proposed) to work on in the background, while the person keeps talking to
  the lead. The helper works in that change's worktree, and is the only one
  writing there until it reports. So its commits are on the change's branch
  when it's done, and nothing needs bringing back. It still pushes nothing:
  the change ships with Ship, after its review.
- **Why there:** every product read runs parallel branches as children with
  a worktree each, and none of them brings the work back by itself. Giving
  the helper the change's own worktree does the same, without a second
  conversation for the person to follow.
- **This amends ADR-087,** whose helpers each work in a copy of their own,
  with commits the lead takes in. That stays for a helper given no change.
- **Until ADR-087 is built,** the lead works on its changes one turn at a
  time, or starts a task for one, as leads can now.

### When one merges

- **A change is done when its pull request merges or closes,** or all of
  them, for a change across repositories. Its worktree goes after the usual
  wait for finished folders, and the task, its session and its other
  changes carry on. A merge never ends a turn, a helper or what runs. Claude
  Code removed a session's worktree when its first pull request merged, and
  Agent Orchestrator stopped following a worker's other pull requests.
- **Before each push, Althar reads the pull request's state.** Where it
  merged a moment ago, the commits go to a new change, "After #N", as a
  round after a merge does now, rather than to the merged branch.
- **The task settles once all its changes are done,** and no draft review of
  its waits. T3 Code and Agent Orchestrator settle the same way.

### Local, attaching and the card

- **Local holds one change.** The person's checkout has one branch, so at
  most one of a task's changes works there, and the others in worktrees.
  Moving a change to Local is how the person tries it in their own checkout,
  and it follows the rules of the move ([below](#moving-between-a-worktree-and-local)).
- **Attaching a pull request adds a change** that follows it. The task no
  longer stops following the one before.
- **The card keeps one fact.** With one change it is as now. With several,
  it names the pull request that most needs the person, with its state, and
  says how many more there are: "#714 checks failing · 2 more". The count
  stands apart from the state: T3 Code's "+6" beside a green icon read as
  six open pull requests. Its Ship offers each change waiting. The header
  lists every change, with its branch, pull request, checks and commits
  waiting.

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
worktree in the second. One that fixes something and reviews a related pull
request in the same repository has both there, side by side: its own
worktree, and a copy at the pull request's head. Place, a worktree or Local,
is one choice for each change, across its repositories, as it is for a task
now. At most one of a task's changes is Local.

### Moving between a worktree and Local

This is the Handoff that
[workspaces-and-runs § Local](../workspaces-and-runs.md#local) leaves
unbuilt. A running task moves between turns, with its branch and its
conversation.

- **To Local:** the worktree's uncommitted work is committed to the task's
  branch first. The move then waits, as a second Local task does now, until
  the person's checkout is free, and until it is clean, the task working on
  in its worktree meanwhile. Then it follows the whole
  [Local rule](../workspaces-and-runs.md#local), as a task starting Local
  does:
  - on its default branch, the checkout switches to the task's branch,
    remembering where it was (`returns_to`);
  - on a branch of the person's own, it asks first: switch to the task's
    branch, or stay in the worktree. The answer holds only while the
    checkout stays as it was when asked.

  The worktree folder goes once the checkout has switched, and the branch
  stays.
- **To a worktree:** the lead commits its own files by name first, as it
  always does in the person's checkout. Althar commits nothing there, so
  whatever is left uncommitted is the person's. Git lets only one folder
  have a branch checked out, so the checkout lets go of the task's branch
  before a worktree takes it:
  - **Clean, and still on the task's branch:** the checkout goes back to
    where it was (`returns_to`), as it does when a task settles. Then a
    worktree is made on the branch, and the task carries on there.
  - **Already on another branch,** because the person switched it: the
    branch is free, and the worktree is made at once.
  - **With uncommitted changes:** the move waits, and the task carries on
    in Local. The workspace part names what holds it, "Moves to a worktree
    once `Board.tsx` is committed". Althar tries again as each turn ends,
    and the person can call the move off. A settled Local task already
    does this when it's reopened with its checkout still on its branch.
- **The conversation carries on.** Where the agent can resume its session in
  the new folder, it does. Otherwise the next turn starts a fresh session
  with the thread's handover, as switching the lead does now.
- Every Local rule stays: Althar never switches a checkout with uncommitted
  changes, never switches it off a branch of the person's own without
  asking, and never stashes, resets or cleans it.

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
  own commits onto it. Then it pushes that branch, as its own pushes go now,
  opens a pull request into the new target and asks the person whether to
  close the old one. The old branch isn't touched.
- **A held branch stays held.** Where commits wait for Ship, the
  cherry-picks take them along, and the new branch is made only on this
  computer, held as the old one was. Ship pushes it and opens its pull
  request, after its review, and only then asks about the old one, which
  keeps what was pushed until then.
- **The review's mark moves too.** The commit the last review read up to
  becomes its rebased or cherry-picked copy, so the next review reads only
  the task's own commits since, not the new target's.
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
  their turn ends, as now, except while the branch is held for Ship
  ([below](#while-the-branch-is-held)).

### A tweak waits for Ship

- **What the person's turns commit stays on the task's branch,** in its
  worktree or the person's checkout, and isn't pushed. The person tries it
  where it is, with the project running, and asks for more.
- **The branch is then held for Ship.** From the end of a person's turn
  that leaves commits past where Althar last pushed, until Ship, nothing
  pushes the task's branch but Ship. A push sends the whole branch, so this
  is the only way the person's commits stay down: anything Althar pushed
  past them would carry them up.
- **Commits the person makes by hand** in the task's folder hold it too.
  Althar records the branch's head as each turn ends, and commits past that,
  when the next turn begins or before Althar next pushes, are the person's.
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
  what Althar's own course commits while the branch isn't held. The Push
  card for a held push stays as it is: it pushes what Althar held back, and
  runs no review.
- **Settling a task with commits not shipped asks first:** Ship, or settle
  and leave them on the branch.

### While the branch is held

Nothing pushes the branch but Ship, so Althar's own course goes as follows:

- **Failing checks start no round.** They are the checks of the pushed
  head, which the ship replaces. The card shows them beside Ship. Ship
  pushes, the checks run on the new head, and a round to fix them follows
  only if they fail again, as now.
- **A conflict with the target is resolved as Ship begins.** The lead
  brings the target in first, as a conflict round does now, so the review
  reads the result.
- **What people say on the pull request** gets its answer at once, as now.
  A change it asks for is committed beside the person's and waits for Ship,
  and the reply says so.
- **Fix it, after a review that ran after a merge,** is the person's word,
  so it ships: the fix goes up with the commits waiting, and Fix it says how
  many it takes along.
- **The Push card,** where code hosts' rules held back a push of Althar's
  own, becomes Ship, since one push would send both.

### Merge, with commits not shipped

With nothing waiting, Merge merges as now. With commits not shipped, it
offers two:

- **Review and merge:** one review of the commits waiting. The lead settles
  what it finds, and then they go up and merge. A finding the lead sets aside
  brings the task back to the person before anything merges.
- **Merge now:** the commits go up and merge at once. They are reviewed after
  the merge, in the same task ([below](#after-merge-in-the-same-task)),
  whatever Checked by's when says. A task with no reviewer gets no review
  after the merge.

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

**One review covers everything since the last.** Althar keeps, for each
change in each repository, the commit its last review read up to, and the
next one reads from there: every tweak since, in one pass. A task with
several changes waiting gets one review for each, which run at once where
there are places.

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
  Its seal names the commit the last pass or check read, and the folded
  review names the tiny fixes after it. A second fix nobody re-read still
  takes the seal away, as code changed after the last pass does now.
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
- **Nothing is posted on the merged pull request.** Today's review after a
  merge is a review task of its own, so it drafts and posts as a review of a
  pull request does. Here it is the task's own review, which reports in its
  thread, as Checked by does before a merge. The fix's pull request says
  what it fixes.
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
  or a worktree for the team's, at its head. It is a workspace row of its
  own, beside the task's own workspace in the same repository
  ([the data model](#the-data-model)).
- **Its draft is the person's to post,** as now: from the card, on their
  word in the thread, or by the team-review setting. An outside author's
  draft always waits for them.
- **A task whose only parts are its reviews settles once its drafts are
  posted,** as a review does now. A task with changes of its own settles
  once all of them are done. A draft still unposted then keeps the task in
  Needs you until the person posts it or drops it.

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

This builds the shelf that [tasks § What a task is](../tasks.md#what-a-task-is)
lists as not built. Only the old ADR-035 rejected it, and the 13 October
direction overtook that.

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
  commits not shipped says how many. One with several changes names the
  pull request that most needs the person, and counts the rest
  ([above](#local-attaching-and-the-card)).
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
| Workspace | `workspaces` rows, whose `kind` gains `copy` beside `worktree` and `checkout`, and which gain `reviewing`: the pull request a row is at, or none for the task's own. Today's review copy and a quick task's detached worktree are rows already, and become copies. No row means no workspace |
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
- **Several open change sets per task.** Each is a change, and its
  `repository_changes` rows hold its branch and pull request in each
  repository, as now: `UNIQUE (change_set_id, binding_id)` stays. Today a
  task's change sets follow one another. Now several are open at once. The
  branch each works toward is its workspace row's `base_ref`, as now, and
  can be another change's branch.
- **`workspaces.reviewing` and a new key.** Today's key,
  `UNIQUE (task_id, binding_id, device_id)`, allows one workspace per task
  and repository on a computer, so neither a second change nor two reviewed
  pull requests in one repository could have one. It becomes two unique
  indexes: one for the task's own workspaces (`reviewing` is null), which
  adds the branch, so each change has its row; and one per reviewed pull
  request. Two indexes, since a null never clashes in a plain unique key.
- **The commit the last review read up to,** on each `repository_changes`
  row. The next review of that change reads from it.
- **The hold for Ship,** on each `repository_changes` row: the head as the
  last turn ended, and whether the branch is held. Commits not shipped are
  those past where Althar last pushed, which it already keeps, while the
  branch is held.
- **`workspaces.moving_to`,** `worktree` or `checkout`: a move between them
  that waits for the person's checkout, until it is made or called off. A
  Local start waits as `preparing` does now, but a running task's row is
  already `ready`, so its move needs a field of its own.
- **Each turn's timings:** waiting for a place, starting the session, the
  agent's work and its tools, plus a ship's review and checks.
- **One event per part change** (`task.part_added`, `task.part_changed`,
  `task.part_removed`, as `record_events` names its types), with who made
  it (the person, the lead or the coordinator) and why. The thread's line is
  read from it.
- **Presets** are data in Althar's settings. The built-in ones live in code.

**Migration:**

- Today's kinds need none, since they are already read from these rows.
  Every existing task sits on the board.
- Each task's latest change set becomes its one change, and nothing moves on
  disk. The review's mark and the hold below go on its rows.
- Rows that are copies today get `kind = 'copy'`: a review's (`access` is
  `read`), and a quick task's that hasn't branched (`kind` and `branched_at`
  both null). Without that, a null `kind` reads as a worktree, and every
  review and quick task would show one. A review's row also gets
  `reviewing`, from the pull request it reviews.
- A task's last review reads up to the commit its last pass read, the one
  its copy was made at, so what was reviewed before isn't reviewed again,
  and commits after it are. Those are fixes after the rounds ran out, or
  work whose review was skipped. A task never reviewed reads from where its
  branch started.
- No branch is held: what exists was pushed, or is held as now.
- The "Review rounds" setting is dropped.

**The tools:**

- `add_part`, `change_part` and `remove_part` replace `make_it_a_change`, for
  leads and the coordinator alike.
- `start_task`, `propose_plan` and `draft_task` gain `preset`. `works_in` and
  `toward` stay, and `change_part` changes them later.
- `review_pull_request` starts a task from the Review a PR preset. Any other
  task adds a review with `add_part`.
- `add_part` with a worktree on a new branch starts a change, with what it
  works toward and a line on why. `change_part` and `remove_part` name the
  change they act on, where a task has several.
- `ship_task` ships on the person's word, as Ship does: one change, or every
  change waiting.
- `create_branch` and `open_pull_request` go at once for a lead and the
  coordinator, with no ask. Neither is on the irreversible list, and the
  person's note of 7 November makes an ask beyond that list a bug.
- "Run it" is not a tool. It is only ever the person's.

## Building it

The person's choice (8 November): this proposal ships first, and then all
of it is built together, rather than in slices that each ship on their own.
Within that build, recording each turn's time goes in first, so the rest can
be measured against today's turns.

It is done when:

- a question to a finished task's lead is answered in the same session, with
  no step, review or handover, and its turn's line shows where the time went;
- one chat opens two pull requests in one repository, each reviewed and
  shipped on its own, with a helper working on one while the person talks
  to the lead about the other;
- the first of a task's pull requests merges, and its other change, its
  session and what runs carry on;
- a `gh pr create` the lead ran itself shows as a change of the task's;
- a tweak, tried in the person's running project, ships with one review of
  only what changed since the last;
- while a tweak waits, failing checks and a comment on the pull request
  push nothing, and the tweak reaches the pull request only with Ship;
- a review's bigger fix is checked by the same reviewer in one pass, and a
  tiny one by none;
- the person's design-review skill posts on a colleague's pull request, run
  in a worktree at its head;
- a change reviews a related pull request in its own repository, with a
  copy beside its worktree;
- "Run it" runs an outside pull request's tests offline;
- a small change's review after merge runs in its own task and thread;
- a chat on Scratch takes a worktree and moves to the board;
- a running task moves between a worktree and Local, and out of Local
  waits while the person's checkout has edits;
- a task changes the branch it works toward with a tweak waiting, and the
  tweak reaches the new pull request only with Ship;
- a preset is saved from a task, and the coordinator offers one.

## What this changes in the decision documents

| Section | Today | With this |
|---|---|---|
| [tasks § What a task is](../tasks.md#what-a-task-is) | Four parts: a workspace, a review, outputs and access. The Scratch shelf, presets and moving a running task are not built | Five, with the review split into Checked by and Reviewing. All three are built |
| [tasks § Kinds](../tasks.md#kinds-read-from-what-a-task-has) (ADR-035) | Plain, review or change, read from a task's plan, pull requests and review. A quick task becomes a change through `make_it_a_change` | Change, review or none, read from its parts. A chat sits on Scratch, and adding parts replaces `make_it_a_change` |
| [tasks § Rounds](../tasks.md#rounds-back-to-work-and-shipping-again) | The person's words to a finished lead open a round with the plan's steps and review. No report means a reminder, then the person. A task has as many pull requests as it needs, one per repository at a time | A turn, with no step, report or review. Its commits wait for Ship. A task has a pull request for each of its changes, several in one repository at once included |
| [tasks § Needs you and settling](../tasks.md#needs-you-and-settling) | A finished task that isn't a change waits there. A merged change is done, and only another round brings a settled task back | A chat doesn't wait there for being finished. A reply the person hasn't seen waits there until they open it, and a settled task comes back when its after-merge review finds something |
| [tasks § The small-change lane](../tasks.md#the-small-change-lane) and [reviews § A small change is reviewed after it merges](../reviews.md#a-small-change-is-reviewed-after-it-merges) (ADR-102) | A merged small change is reviewed in a task of its own, which posts what it finds as any review of a pull request does | Reviewed in the same task, which settles as it merges, and nothing is posted on the merged pull request. So is what Merge now merges |
| [tasks § Plan and review settings](../tasks.md#plan-and-review-settings) | Rounds of review: 1, 2, 3 or 5, and what happens when they run out | The rounds setting goes. "When rounds run out" stays, for a finding the check reopened |
| [reviews § How a review round runs](../reviews.md#how-a-review-round-runs) | A fix that changed code sets off another whole round, up to the "Review rounds" setting | Tiny fixes aren't checked, others get one short check by the same reviewer, and the setting goes |
| [reviews § What a pull request shows of its review](../reviews.md#what-a-pull-request-shows-of-its-review) | No seal where the code changed after the last pass | A seal where every fix since the last pass or check was tiny, and the folded review names them |
| [reviews § Reviewing someone else's pull request](../reviews.md#reviewing-someone-elses-pull-request) (ADR-050, ADR-097) | An outside author's code is only read, and a team's is read in a copy | "Run it" asks Run safely or Trust fully, and a team's runs in a worktree |
| [code-hosts § A lead's commits go up as its turn ends](../code-hosts.md#a-leads-commits-go-up-as-its-turn-ends) (ADR-072) | Every turn's commits push as it ends, and commits the person made by hand go up with the lead's | What the person's turns or hands commit holds the branch, and only Ship pushes it until then. Otherwise Althar's own course pushes as now |
| [tasks § Helpers (proposed)](../tasks.md#helpers-proposed) (ADR-087) | A helper works in a copy of its own, and the lead takes its commits in | It can also be handed one of the task's changes, and works in that change's worktree |
| [tasks § The board card](../tasks.md#the-board-card) | One fact: a change's branch, pull request, checks or conflict | With several changes, how many pull requests, and the state of the one that most needs the person |
| [workspaces-and-runs § Worktree](../workspaces-and-runs.md#worktree) | One worktree per repository | One for each change in each repository, all in the task's folder |
| [code-hosts § Attaching a pull request a task didn't open](../code-hosts.md#attaching-a-pull-request-a-task-didnt-open) (ADR-052) | A task follows one pull request per repository, and attaching another stops following the one before | Attaching adds a change, and the task follows every one |
| [code-hosts § Not built yet](../code-hosts.md#not-built-yet) and [what-agents-may-do § Asking is the person's word](../what-agents-may-do.md#asking-is-the-persons-word) | `create_branch` and `open_pull_request` go only on the person's word | At once, for a lead and the coordinator |
| [workspaces-and-runs § Local](../workspaces-and-runs.md#local) (ADR-091) and [§ The branch a task works toward](../workspaces-and-runs.md#the-branch-a-task-works-toward) (ADR-093) | Fixed at the first step | Change at any time |
| [workspaces-and-runs § Settling stops everything](../workspaces-and-runs.md#settling-stops-everything) | Everything the task ran | All but an after-merge review |
| [agents § Keeping context small](../agents.md#keeping-context-small) | A lead starts afresh at a break past 80,000 tokens | Only when its context is full |
| [what-agents-may-do § What stays](../what-agents-may-do.md#what-stays-and-why) | Running a stranger's code waits for the person | Still, and their word picks how far to trust it |

## Risks and open questions

- **Moving between Local and a worktree beside the person's own edits**
  needs the most care. Into Local, the move waits for a free, clean
  checkout, and asks before leaving a branch of the person's own. Out of
  Local, it waits until the checkout can let go of the task's branch, and
  the task carries on in Local meanwhile. Althar never commits, stashes,
  resets or cleans the person's work, and switches their checkout only as
  the Local rule allows.
- **Several changes in one task touch nearly everything** that took one per
  repository for granted: the workspace key, the hold, the review's mark,
  the card, settling, and every tool that names a task's branch. Every
  product read hit bugs there when it made the same move. The rules above
  name the change in everything, and record each pull request as it is made.
- **A lead can lose track of which folder it's in,** and commit to the wrong
  change. Its brief names each change's folder, and each turn's line says
  which change a commit went to, so the person sees it at once.
- **Each worktree takes disk and a setup.** Several changes in one task
  multiply that. A change's folder goes after the usual wait once it's done.
- **A changed target can conflict.** The rebase and the cherry-picks stop
  and hand the conflict to the lead, as a conflict with the default branch
  does now.
- **A warm session costs more per message** once its prompt cache has
  lapsed. Each turn's record shows what it cost, and Compact stays one press
  away.
- **Work can sit unshipped,** on a branch only on this computer, and a held
  branch's failing checks wait for Ship. The card says so, and settling asks
  first.
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
- **Open:** whether a change should ever have a workspace in one repository
  at Local and in another in a worktree. For now place stays one choice for
  the whole change.

## Alternatives turned down

- **A `task_parts` table.** One read instead of several, but it stores
  something that can disagree with the rows, which is what ADR-035 avoided.
- **One pull request per repository at a time,** as now. It's the simplest
  model, and Paradev keeps it, but its users then split one conversation
  across workspaces to get several pull requests (Paradev #8473). The
  person chose several (8 November).
- **A task for each pull request, started from the chat.** It is mostly
  built already, and Claude Code's Projects work this way. But each one's
  detail lives in a thread of its own, and steering them goes through
  another lead. It stays the way for unrelated work.
- **One worktree that switches between a task's branches.** Two changes
  couldn't be worked on at once, and the project running there would
  change under the person. Every product that does this shows the wrong
  pull request at times.
- **Helpers that bring their work back for the lead to take in,** as
  ADR-087 has it, for a helper given a change. No product read brings a
  child's branch back by itself, and the change's own worktree makes it
  unnecessary.
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
- **Letting Althar's own course push past the person's commits,** as
  code-hosts does now. The person's tweaks would reach the pull request
  before they said Ship.
- **Leaving Local at once, with the person's edits still in the checkout.**
  Sharing the branch between both folders (`git worktree add --force`)
  would let the lead's next commit move it under the person's files. A
  branch of the worktree's own would split the task's work in two, and what
  the person commits next, on the old one, would need carrying across.
- **Keeping the person's commits on a ref of their own,** and pushing
  Althar's fixes past them by cherry-picking. A folder has one head, so the
  lead would fix a state it isn't working in, and a fix made on the tweaks
  may not apply without them.
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
