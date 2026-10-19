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
  - **Three kinds, never stored.** Whether a task ends in a pull request is
    the person's intent, never a side effect of the files its lead writes
    (decided 14 October). A **plain** task is a quick task: one the
    coordinator starts at once with `start_task`, whose plan says it stays
    on this Mac (`here`) and ends in nothing, with no pull request of its
    own. It stays plain whatever its lead writes or commits, branch or not,
    until the person asks its lead to make it a change. A **review** reviews
    someone else's pull request and has no work of its own. A **change** is
    everything else: every planned task, whatever its ending (one that
    merges here when it is accepted has no pull request to end in), a quick
    task made a change, and any task with a pull request. A docs pull
    request is a change. The runtime reads the kind for each card from the
    task's plan, pull requests and review; nothing writes it, so nothing can
    disagree with it. A quick task started before its plan said `here` is
    read as a change, as it was once it had a branch.
  - **A task only moves toward change, when the person says so.** As they
    try something with a quick task's lead and like it, they ask it to make
    it a real thing; the lead calls `make_it_a_change`, which renames the
    task for what it does now, adds a review by the model it names, and
    gives it an ending: a draft pull request, or one ready for review. A
    review the person takes over becomes a change that builds on it. It is
    one task, thread and card throughout: nothing restarts.
  - **A card has nothing to press.** The whole card is one button that
    opens the task, where a permission is answered, a question answered,
    and the lead told what's next. The card says where the task stands in a
    word, in the lane's colour, then its kind (Change, Review; nothing for a
    plain task), its title, and at most one card in the card and one fact:
    a change's branch or pull request, its checks or a conflict; a review's
    pull request and its findings; a plain task's pictures or files, or else
    its branch, where its lead wrote in the repository.
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
  - **A plain task is a quick task until the person asks its lead to make
    it a change.** What the coordinator starts with `start_task` (no plan to
    look over: a question, a quick look, a prototype, a release run from
    this Mac) works in a worktree of its own, detached at the commit its
    default branch is at, set up as any task's is
    ([ADR-023](023-althar-runs-the-project.md)), with a scratch folder git
    ignores for what its lead throws away. Nothing of it leaves this Mac.
    Writing in the repository is fine: where its lead first changes it,
    with new commits or changes not committed that aren't evidence it
    handed, Althar makes the task's branch right there, as the lead's turn
    ends or as it calls `finish_step`, with that work on it, so nothing is
    lost on a detached head: the same folder, the same lead and session.
    That keeps the work safe, and nothing more. The branch stays on this
    Mac, the task stays plain (Finished, then Done once the person settles
    it, [ADR-050](050-a-finished-task-waits-for-the-person-to-settle-it.md)), and its
    thread says so ("This task's work is on a branch of its own now, …,
    which stays on this Mac"). When the person asks to turn it into a real
    change, its lead calls `make_it_a_change`: the task is renamed, its plan
    takes the review and the ending and no longer stays here, and so does
    the run under way, or a round of work opens with them where its last
    run had ended ([ADR-034](034-a-task-goes-back-to-work-and-ships-again.md));
    its branch is made then where it has none. The thread says so ("This
    task is a change now: reviewed by …, it opens a draft pull request when
    it's done"), and the coordinator hears it in its news. The lead's next
    `finish_step` goes through the review, and then the run publishes as any
    change does, that round too, with all the work since the task started
    counted as the round's. With no branch there is nothing to ship, and a
    lead that changed nothing finishes with its summary alone.
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
    moment a quick task was made a change or a review was taken over, and
    the card would say one thing while the task did another.
  - **A quick task that writes becomes a change by itself** (as built first,
    13 October). A prototype whose lead wrote in the repository got its
    branch, became a change and opened a draft pull request once its host
    was connected (PR #162): the person never asked for one. Writing is how
    a prototype is made; turning it into a change is the person's decision,
    and the lead, which they are talking to, is who carries it out.
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
  - **A worktree on a branch for every task, as before.** It costs a branch
    per question, and a card that offers a pull request for work that will
    never be one.
  - **A plain task on a read-only copy, moved to a worktree when its lead
    asks (`need_worktree`), in a fresh session briefed from the thread.**
    The lead would lose its own context, and its folder, with what it had
    running there, exactly when the work turns into a change; and a lead
    that writes without asking would go unseen. A worktree with no branch
    keeps both, and what the lead did, not what it asked, decides.
  - **No install for a plain task.** Its lead's quick look often runs the
    project's tests or tools, which fail without one in a sandbox that
    refuses the package manager's folders outside the worktree.
- **Trade-off:** The kind changes from plain to change only when the person
  asks for it, through the lead; the card, the thread and the new title say
  so. A quick task's branch can hold commits that never leave this Mac, and
  nothing reminds the person they are there but its card and its row. A
  plain task still costs a worktree and its install, as any task does. Its
  branch is made at the end of the turn that wrote, not as the file is
  written, and work a lead leaves outside its scratch folder, a screenshot
  it hasn't handed yet, gets it one. A review in reader mode can't run the
  pull request's tests; its lead reads the checks the host ran instead.
- **Related:** the triage checkpoint (PR #116's exploration) will show on a
  running card's top line, which takes any word; DEV-91 (merging once
  checks pass) will be a change's state, not a kind.
- **Revisit when:** a task's output can't be read from what it has (a
  release that publishes somewhere Althar can see, for instance); people
  ask for a kind the three can't say; or reviews come in faster than people
  ask for them, and an inbox earns its place.
