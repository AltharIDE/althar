# ADR-034: A task goes back to work whenever its lead does, and ships again

- **Status:** Accepted
- **Date:** 2026-10-13
- **Owner:** Repository maintainers
- **Context:** A task is a long-lived piece of work the person keeps talking
  to, but its course ended with its plan. Once its steps had run and its pull
  request merged, the task was `done` for good, and talking to its lead
  again changed nothing about it. In DEV-58 (PR #142) the slider design the
  person and the lead agreed on never reached the pull request, which merged
  without it. The person went back to the task and asked for it, and the
  lead built and committed it, but the card stayed Settled while it worked,
  `finish_step` was refused because no step was open, and the commit could
  reach no pull request: a task had one, and there was no way to open
  another. The lead had to tell the person to "open a new PR for the
  branch", which Althar can't do. The board froze where the plan ended,
  and the work the person asked for was stuck.
- **Decision:** the board follows what is actually happening, and nothing a
  task can reach leaves its lead's work unshippable.
  - **The card says Running whenever an agent on the task works:** in a
    turn, starting, or with a turn waiting for a place among the agents at
    work on this machine ([ADR-032](032-agents-at-once-on-this-machine.md)),
    whatever the task was: ready, stopped, merged or settled. A call waiting
    on the person still comes first, as Needs you. Once nothing is at work,
    the card says what fits what is there now, as below; it never goes back
    to an old state blindly.
  - **What the person says to a lead after its plan opens a follow-up
    round.** When a turn of a task's lead delivers the person's own words
    and the task's latest run is over (it passed, failed or was given up;
    not running, and not stopped, which a message resumes as before), Althar
    opens a round: a run of its own, with no plan, whose steps and ending
    are the plan's run's, so a reviewed task's round has a review. Its
    Implement step is under way at once, on the lead's session, and a merged
    task opens again for it (`done → open`). Althar's own messages to the
    lead (what people said on its pull request, its checks, a conflict to
    resolve) don't open one: they have their own course, and the person
    pushes what the lead commits for them. Nor does anything while a
    conflict round is under way. A lead that calls `finish_step` after its
    plan with no step open opens one and finishes it in the same call: that
    round starts where the last run left the task (the nearer of what its
    pull request was last sent and what its last review read, else its
    branch when that run ended), so what the lead committed before it
    reported, as a fix for checks Althar told it of, is the round's, and is
    reviewed as the plan says.
  - **A round is a real round.** It ends as any of the lead's steps does,
    with `finish_step`, its summary and its evidence. With new work, it goes
    on to its review, if it has one, settled as ever. New work is new
    commits in any of the task's repositories, or changes left uncommitted
    that aren't evidence; what was there when the round opened doesn't
    count.
  - **Where a round ends depends on what is there:**
    - Nothing new, when the lead's turn ends without `finish_step`, the
      person interrupts it, or it finishes: the round closes, and the task
      goes back where it was. A merged task is done again, at the time it
      first settled, so it keeps its place among the settled; a ready one is
      ready, a stopped one stopped (the round's run ends as the run before it
      did).
    - New work and the lead's turn ended without `finish_step`: it is
      reminded once, then the round needs the person, as any step. Given up
      there, the task goes back where it was too, and what the round
      committed stays on its branch, offered as below.
    - A question the lead asked: Needs you, as any step, and the answer
      carries the round on.
    - New work, finished (and its review passed or settled): ready. A round
      never publishes by itself. With the task's pull request open, the card
      pushes what the round committed, as it pushed any commit before. With
      its last pull request merged or closed, the card offers **Open a new
      pull request**. With none ever opened, it offers to open one, as it
      did.
  - **The person can skip a round's review,** from the task's menu: the
    round no longer has one, a review under way stops, and a round whose
    lead is done concludes. Rounds follow the plan by default: the next one
    has its review again.
  - **A task has as many pull requests as it needs.** Opening a new one
    works in each of the task's repositories whose last pull request is
    merged or closed and whose branch has commits after that pull request's
    head:
    - after a merge, Althar starts a new branch from the default branch as
      the host has it now (fetched, signed in as a push is, from the
      repository the pull request opens on: for one from a fork into the
      repository it came from, that one's, not the fork's, which doesn't
      have what merged), named the
      task's branch with `-2` (`-3` and on: the first name free here and
      there), and cherry-picks the new commits onto it, merges left out
      since the default branch has what they brought, in the task's
      worktree, which moves to the new branch; its base is now that commit
      of the default branch. Where the lead merged that default branch into
      its own since, the new branch is the task's branch as it is. Where the
      default branch can't be fetched, nothing moves: this Mac's may not have
      what merged;
    - after a pull request was closed unmerged, nothing of the branch is in,
      so the new branch is the task's branch as it is, under a new name.

    Either way the branch is new on the host: it is pushed plainly, never
    forced, and the merged or closed branch isn't touched. The pull request
    opens as a draft, described from what came after the last one (the
    lead's latest summary and description, the round's review, its
    evidence), and linked to the task and its issue as the first was. A
    cherry-pick that conflicts with the default branch stops, puts the
    worktree back on its branch, and says which files, for the lead to bring
    the default branch in first. A push that doesn't go through leaves the
    worktree on the new branch, its commits still offered, and the next try
    takes that branch. Each repository goes by its own pull request: one
    whose pull request is open takes pushes as before, while another opens
    its next. It is refused while the lead's round is under way, and where
    no repository has anything new.
  - **Merged with work after it isn't done.** A task is done once each
    repository's latest pull request has merged (one closed before its next
    merged is history) and nothing after them changes anything. One whose
    branch has commits after the last one's head in any repository stays
    open and ready, offering the new pull request, rather than settling with
    work no pull request has.
  - **The task keeps every pull request,** one external link each, and a
    change set per round. Its card and its header show the latest (the open
    one first, else the most recent) and the earlier ones under it;
    `read_task` and `list_tasks` say each, the latest first, and how many
    commits are in none.
  - **A merged task with commits after its pull requests is never only
    Settled.** One that was done before rounds existed, with work its lead
    committed afterwards, as DEV-58's was, shows as Ready, offering the new
    pull request.
  - **A round counts as any turn does** toward the agents at work on this
    machine (ADR-032): its lead takes a place while it is in a turn, in the
    place its turn asked for, and none between turns, when it waits on the
    person as a lead after its plan always has; its review asks for a place
    as any review.
  - **Across a restart,** a round whose lead was in a turn as Althar stopped
    carries on as any step, its lead told to carry on with what the person
    asked; one whose lead's last turn had completed is judged as that turn's
    end would have been, so one that made nothing new goes back where it
    was.

  The states and transitions, tested in `packages/runtime/tests/rounds.test.ts`, with an
  interrupted round in `changes.test.ts` and a restart after a completed turn in
  `busy.test.ts`; `apps/desktop/e2e/rounds.spec.ts` walks the first and the last in the window:

  ```mermaid
  stateDiagram-v2
      ready: open, run passed (Ready)
      settled: done (Settled)
      round: open, round under way (Running)
      asking: open, round asks the person (Needs you)
      after: open, round passed with new commits (Ready, offering a new pull request)
      ready --> round: the person writes to the lead
      settled --> round: the person writes to the lead (done → open)
      round --> ready: nothing new, from ready
      round --> settled: nothing new, from done (its settled time kept)
      round --> asking: the lead asks a question, or new work and no report after a reminder
      asking --> round: answered
      asking --> settled: given up, from done (its commits offered where in no pull request)
      round --> after: finished with new commits, review passed
      after --> ready: Open a new pull request (a new branch, cherry-picked, pushed plainly)
      ready --> settled: every pull request merged, nothing after them
      ready --> after: a pull request merged with commits after it
  ```

  | From | What happens | To | The card |
  |---|---|---|---|
  | Any, an agent at work | a turn, a session starting, a turn waiting for a place | as it was | Running (Waiting, for a place) |
  | `done`, run passed | the person writes to the lead | `open`, a round runs | Running |
  | `open`, run passed, failed or given up | the person writes to the lead | a round runs | Running |
  | `open`, run stopped | the person writes to the lead | the run resumes, as before | Running |
  | Round, Implement | the lead's turn ends, or the person interrupts it, nothing new | the run before's end; `done` again where it was | as before the round |
  | Round, Implement | `finish_step`, nothing new | the same, with its summary in the thread | as before the round |
  | Round, Implement | the lead asks a question | waits on it | Needs you |
  | Round, Implement | turn ends with new work, no report, twice | needs the person | Needs you |
  | Round, needing the person | Give it up | back where it was, its commits on its branch | as before, or Ready offering a new pull request |
  | Round, Implement | `finish_step` with new work | its review, or the round passes | Running, then Ready |
  | Round, Review | Skip the review | the round passes | Ready |
  | Round, its lead in a turn | Althar restarts | the step carries on after the restart | Running |
  | Round, its lead's last turn completed | Althar restarts | as that turn's end would have it | as above |
  | Passed, last pull request merged or closed, commits after it | Open a new pull request | a new draft on a new branch | Ready, with both pull requests |
  | Passed, pull request open | Push | as before | Ready |
  | Every pull request merged, nothing after | (the host says so) | `done` | Settled |
  | A pull request merged, commits after it | (the host says so) | stays `open` | Ready, offering a new pull request |
  | `done`, commits after its last pull request | (read for its card) | as it is | Ready, offering a new pull request |
- **Alternatives considered:**
  - **A new task for follow-up work.** What the person asked not to be the
    answer: a task is the conversation, and a new one starts without its
    thread, its plan or its pull request's history.
  - **Derive the card from activity alone, with no round.** The card would
    say Running, but `finish_step` would still have nothing to finish, and
    the work still no way out.
  - **A round for every turn of the lead, Althar's own messages included.**
    Each fix of a failing check, or answer on the pull request, would need
    a summary and a review; those have their own course, and the person
    pushes what they commit.
  - **Publish a round's work by itself, as a plan's ending does.** A second
    pull request on a merged task is a bigger step than the first, and the
    person asked to be offered it. Easy to change once people want it.
  - **A new pull request from the merged branch.** After a squash merge its
    old commits aren't in the default branch, so they would show again, and
    pushing to a merged branch is what this must never do. Merging the
    default branch into the task's branch instead conflicts wherever the new
    work changes lines the merged work added, which a follow-up usually
    does; cherry-picking the new commits doesn't.
- **Trade-off:** Any message to a lead after its plan opens a round, a
  question too; one that changes nothing closes again without a word, but
  the card says Running meanwhile, which is what is happening. Cherry-picking
  makes new commits of work that was only on the task's branch, never of
  anything pushed, and a conflict with the default branch is the lead's to
  settle before the new pull request opens.
- **Related:** DEV-93 (switching a task between a prototype and a full plan
  part way) builds on this: a round is a run with its own steps and ending,
  skipping a round's review is the first change to them, and graduating a
  prototype adds a reviewer and publishing to a round in the same way.
- **Revisit when:** DEV-93 changes a round's steps; people want a round to
  publish by itself; or cherry-picks conflict often.
