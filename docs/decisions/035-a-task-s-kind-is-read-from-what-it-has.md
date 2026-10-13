# ADR-035: A task's kind is read from what it has, and its card has nothing to press

- **Status:** Accepted
- **Date:** 2026-10-13
- **Owner:** Repository maintainers
- **Context:** Every task was the same thing: a plan that implements,
  reviews and opens a pull request, in a worktree on a branch of its own.
  What people asked agents for didn't fit it. A question about the code, a
  prototype, a release run from this Mac, or a review of someone else's pull
  request made a branch and an install they never used, and a card that
  offered a pull request that would never come. The board's cards carried
  buttons (Review, Accept, Answer) that did half of what the task's screen
  does, and a task with an open call showed twice: as its card and as the
  call. People asked for temporary chats, a prototype kind, a document kind;
  prototyped, each turned out to be a task with less in it. DEV-96.
- **Decision:** one primitive, the task; its kind is read from what it has.
  - **Three kinds, never stored.** A **change** is a task whose plan ends in
    a pull request (its ending is `draft`, `ready` or `none`), or that has
    commits or a pull request: a docs pull request is a change. A **review**
    reviews someone else's pull request and has no branch of its own. A
    **plain** task is everything else. The runtime reads the kind for each
    card from the task's plan, workspaces, pull requests and review; nothing
    writes it, so nothing can disagree with it.
  - **A task only moves toward change.** A plain task that writes becomes a
    change; a review the person takes over becomes a change that builds on
    it. It is one task, thread and card throughout: nothing restarts, and
    the coordinator retitles it where its title no longer fits.
  - **A card has nothing to press.** The whole card is one button that
    opens the task, where a permission is answered, a question answered,
    and the lead told what's next. The card says where the task stands in a
    word, in the lane's colour, then its kind (Change, Review; nothing for a
    plain task), its title, and at most one card in the card and one fact:
    a change's branch or pull request, its checks or a conflict; a review's
    pull request and its findings; a plain task's pictures or files.
  - **A task with an open call shows once,** in Needs you: its card says the
    call's kind and why. A call with no task, the coordinator's question,
    is still a card of its own.
  - **Finished, then Done.** A plain task has nothing to accept: once its
    lead finishes, it is Finished in its project's Needs you until the
    person opens it, which settles it as Done. Finished isn't on the home,
    the edge or in notifications: it waits for the person, it doesn't call
    them. Writing to a Done task opens a follow-up round, as for any task
    ([ADR-034](034-a-task-goes-back-to-work-and-ships-again.md)).
  - **A review reads, and posts nothing until the person does.** The
    coordinator starts one with `review_pull_request`. Its lead reads a
    read-only copy of the pull request's head that Althar fetched, in
    reader mode, and never runs its code; for a pull request from outside
    (a fork, or an author the host doesn't name a member or collaborator)
    it also has no network. It drafts with `draft_review`: a verdict,
    a summary and comments on lines. The person keeps or drops each comment
    and picks the verdict (never Approve for them on an outside pull
    request), then posts. A setting of their own posts reviews of their
    team's pull requests without asking; outside ones always wait.
  - **A plain task starts on a copy.** A read-only copy of its repositories,
    as the coordinator's folder is, with no branch and no install. When its
    lead needs to change files it asks for a worktree (`need_worktree`), at
    the commit the copy was at, and goes on in a fresh session there, briefed
    from the thread as the coordinator's handover is
    ([ADR-031](031-coordinator-handed-over-before-it-fills.md)). From then it
    is a change: its next round has the project's steps and ending.
  - **Tasks can be found.** ⌘K in a project and on the home searches titles,
    what the person asked, the lead's summaries and what it built, pull
    request numbers, branches and files touched; the coordinator's
    `find_tasks` searches the same.
- **Alternatives considered:**
  - **More primitives: a temporary chat, a prototype, a document.**
    Prototyped as a shelf beside the board. Each was a task with fewer
    parts, and each needed its own way to become a task when it grew, which
    is the common case. A document is a change whose files are prose.
  - **A stored kind, chosen by the coordinator.** It would go stale the
    moment a plain task wrote a file or a review was taken over, and the
    card would say one thing while the task did another.
  - **More kinds: Release, Watch, Prototype.** A release has no output
    Althar can see, so its card could say no more than a plain task's.
    Watching a pull request until its checks pass is a state of a change
    (DEV-91), not a kind. A prototype is a plain task that hands back
    pictures.
  - **Keep buttons on cards.** Every button was a shortcut to the task's
    screen that showed less than the screen does: answering a permission
    without its context, accepting without the diff. One way to act is
    easier to learn, and the board becomes something to read.
  - **A review inbox, fed from the host.** Polling every connected
    repository for review requests is a feature of its own; asking the
    coordinator, or pasting a link, covers what people do now.
  - **A worktree for every task, as before.** It costs a branch and an
    install per question, and a card that offers a pull request for work
    that will never be one.
- **Trade-off:** The kind can change under the person's eyes, from plain to
  change, which is what happened to the work; the card says so, and the
  coordinator's retitle says why. A plain task's lead moving to a worktree
  starts a fresh session, which carries what the thread says but not the
  agent's own context. A review in reader mode can't run the pull request's
  tests; its lead reads the checks the host ran instead.
- **Related:** the triage checkpoint (PR #116's exploration) will show on a
  running card's top line, which takes any word; DEV-91 (merging once
  checks pass) will be a change's state, not a kind.
- **Revisit when:** a task's output can't be read from what it has (a
  release that publishes somewhere Althar can see, for instance); people
  ask for a kind the three can't say; or reviews come in faster than people
  ask for them, and an inbox earns its place.
