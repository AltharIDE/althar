# ADR-045: A task can be attached to an open pull request it didn't open

- **Status:** Accepted
- **Date:** 2026-10-17
- **Owner:** Repository maintainers
- **Context:** A task followed only the pull request Althar opened for it, or
  adopted from its own branch: the host was asked for one open from a branch
  of the task's own name. In Althar's own repository, tasks opened their pull
  requests on the fork (ninemate/althar #3 to #10) before the project sent
  them upstream (the fork's `change_target`); those were closed, and the real
  ones were opened on AltharIDE/althar (#185, #199, #203 and on), each from
  the fork's branch. Each task still followed its closed fork pull request:
  its lead's `read_pull_request`, `reply_on_pull_request` and
  `push_to_pull_request` couldn't reach the upstream one, and nothing heard
  its reviews, checks or conflicts. Publishing again took the closed one for
  merged-or-closed (ADR-034) and opened a second pull request on a `-2`
  branch. A new task couldn't take one over either: its branch is rarely
  called as the pull request's is (its slug taken, or that branch checked out
  in another worktree, so it becomes `-2`). And `find_pull_requests` listed
  only the fork's, so the coordinator never saw the upstream ones.
- **Decision:** the person, or the coordinator, attaches a task to an open
  pull request by its link or number, and from then on the task follows it
  as one Althar opened.
  - **Which:** by its link, one on the task's repository or on the one its
    fork came from; by its number, where the repository's pull requests open
    (upstream, for a fork that sends them there). Only an open one. Its
    branch must be on the repository the task pushes to (the fork, else the
    repository itself), as GitHub's reading of it says: one on someone else's
    fork is refused, since Althar can't push there. One another open task
    follows stays that task's.
  - **Its branch:** where the task's branch already has that pull request's
    head, it stays as it is. Where it doesn't, nothing changes until the
    person says to start it there: then the head is fetched, the branch is
    moved onto it under its own name, and the task's own commits since it
    started that aren't in the head go on top, one by one, as a next pull
    request's do (ADR-034). Where they conflict, the worktree has what isn't
    committed, or the lead is at work in it, it stays as it was, and says
    why. Where it was is kept under `refs/althar/before-attach/`.
  - **The record:** a change set of no run (`change_sets.run_id` may be null
    now, migration 0034: a drafted task has no run yet), a repository change
    for the task's worktree with that pull request's link and head, and its
    external link, listening, whose snapshot keeps the pull request's own
    branch (`source`) and that it was attached (`attached`). What the task
    followed before in that repository isn't listened to any more; the card
    shows the open one, and the earlier ones under it, as ever.
  - **Following it:** listening, the card, the lead's tools, the Push button,
    a conflict round and the checks Althar sees through all go by that link,
    as for one Althar opened. Each push goes to the pull request's own
    branch, by its name on the host, whatever the task's branch is called
    here (`git push <url> <local>:refs/heads/<source>`).
  - **Publishing** pushes the task's branch there as a plain push, so only as
    a fast-forward; where it wouldn't be one, it says so, as the Push button
    does, and nothing is forced. It reads the pull request again, and opens
    nothing: an attached pull request is never taken for one to open again,
    so no `-2` branch is made for it.
  - **Where:** the task's menu has Attach a pull request…, which asks for the
    link, then, where it must, whether to start from its head and what that
    keeps. The coordinator has `attach_pull_request(task, pull_request,
    start_from_head)`, which asks the person before it starts a branch over,
    and `draft_task` takes a `pull_request`, so a task drafted to answer a
    review starts on its head. `find_pull_requests` lists, for a fork that
    sends its pull requests upstream, that repository's first, and says
    which task follows each.
- **Alternatives considered:**
  - **Rename the task's branch to the pull request's.** Simple, but the name
    is often taken here (another worktree has it checked out), and a branch
    renamed under a running lead is a branch it no longer finds.
  - **Find the upstream pull request by the fork's branch automatically.**
    `findChange` does that for the task's own branch already; it can't for a
    pull request opened from another branch, and guessing which one a task
    meant would attach the wrong one silently.
  - **Force-push to the pull request's branch.** It would replace commits
    someone else pushed there; the project's rules keep force pushes for the
    person (ADR-013), and the Push card's Replace already does it with their
    word.
  - **Keep the attachment on the task alone, written to the record at its
    first run.** A drafted task would follow nothing until its plan starts,
    and every reader of the record would need a second place to look.
- **Trade-off:**
  - **One pull request per repository of a task:** attaching another stops
    listening to the one before there.
  - **A branch on someone else's fork isn't attached,** even where its
    author allows maintainers to push.
  - **Where a host can't say which repository a pull request's branch is on**
    (all but GitHub, for now), it is taken as on the repository the task
    pushes to; a push elsewhere fails as git says.
- **Revisit when:**
  - A task should follow a pull request it only reviews, or one on a fork it
    doesn't push to.
  - Detaching is wanted, beyond Stop listening.
