# ADR-093: A task works toward a branch: the project's Work toward, or its own

> Archived on 8 Nov 2026. What holds now is in [workspaces-and-runs.md § The branch a task works toward](../workspaces-and-runs.md#the-branch-a-task-works-toward); this is the record as it was.

- **Status:** Accepted
- **Date:** 2026-11-04
- **Owner:** Repository maintainers
- **Context:** Every task started from its repository's default branch, and
  much of Althar took main as the branch work goes into: keeping a branch
  current merged main into it, conflicts and "already failing on main" were
  read against main, the lead's push guard protected only main, and Run ran a
  copy of main. A project cutting a release (`release/0.8.0`) needs some
  tasks, or all of them for a while, to start from the release branch and land
  there, while others still go to main. A task's pull request already went
  into the branch it started from (`baseRef`), and the merge line already
  carried each pull request's own target, so most of the work was choosing
  the start and making everything else follow it.
- **Decision:**
  - **Each task works toward a branch, in each of its repositories**
    (`workspaces.toward`): it starts from it, its pull request goes into it,
    and it is kept current with it. Null is the default branch, so every task
    made before keeps going to main, and so does every new task unless
    something says otherwise.
  - **The project has a default for new tasks, "Work toward",** one per
    repository (`repository_bindings.work_toward`, null for the default
    branch). It must be a branch of the remote tasks start from: a fork's
    upstream, where its work goes there, whose branches and default are what
    the setting lists. Tasks already made keep theirs. The coordinator's
    brief names it, so it plans toward it; its copies of the repositories
    and Run's copy follow it too, from that same remote.
  - **It is picked beside Run,** at the top of the project's screen: the
    branch Run's own place runs is the project's one branch, so a branch
    picked there is Work toward too, and Run runs a copy of it; a task or a
    pull request picked there is only where Run runs. The list's foot says
    so. A run going on the old branch's copy keeps going there until it
    stops, the chip saying that branch meanwhile, and the list says the next
    run takes the new one. It is in General settings too. The coordinator's
    composer has no control of its own: asked in words, the coordinator
    points a task elsewhere itself.
  - **A branch the remote doesn't have can be made from any branch list**
    (Run's, the plan card's, General's) by typing its name: `CreateBranch`
    makes it on the code host, on the remote tasks start from, from that
    remote's default branch, pushed by Althar with its sign-in and never
    forced, as `create_branch`; one there already is left as it is and is
    the one the person gets, but a push the host refuses for any other
    reason, a hook or a protection rule, is refused as git said it. The
    person's own click is their word. Made from a plan card, the plan is
    held first, so its countdown can't start it toward the old branch while
    the host makes the new one; it then waits for the person's Start. A plan
    already started and waiting for a free agent offers no branch to make:
    a hold doesn't stop it, so it could start meanwhile toward the old one.
    It is pointed only at a branch the remote has, which changes at once.
  - **A single task can be pointed elsewhere.** `draft_task`, `propose_plan`
    and `start_task` take `toward`; the plan card's last row says it after
    how the work ends ("Open a draft PR into release/0.8.0"), a list of the
    remote's branches as last fetched, its default marked, found by typing.
    It can change until the first step starts. A worktree
    made for the draft then moves, unused, to the new start (`git reset
    --keep`), keeping what its setup made. The board's card says the branch
    quietly ("→ release/0.8.0"), and the task's ⋯ says it first ("Into
    release/0.8.0", copied when chosen), only where it isn't the default:
    not its bar, which keeps to where it stands. `list_tasks` and
    `read_task` say it to the coordinator.
  - **What follows the task's target:** where it starts; its pull request's
    base, on a fork's upstream too when that is where its work goes (a
    target there is a branch of the upstream); the lead's bring-up-to-date
    and its brief ("Its work goes into release/0.8.0"); `update_branch` and
    the merge line, by the pull request's own target; the conflict check and
    "conflicts send a task back to work", here and on the pull request; the
    checks the lead compares against (`read_default_branch_checks` on the
    lead, "broken on release/0.8.0"); a merge here and the done check of a
    task with no pull request; the diff, Changes and Outputs' base; and the
    push of a local merge.
  - **A task's target is protected as the default branch is** (ADR-071):
    the lead's git guard and the rules refuse a push straight onto it,
    saying it is the branch the task's work goes into, and publishing never
    pushes a task's branch onto it.
  - **What stays on the default branch:** Run's copy and the coordinator's
    copies follow the project's Work toward, not a single task's; a task's
    own Run runs its worktree, as ever. The coordinator's
    `read_default_branch_checks` reads the default unless it names a branch.
    The repositories' own rules and conventions are read from where tasks
    start.
  - **Local follows the same rules** (ADR-091): a Local task makes its
    branch from its target in the person's checkout, on the default branch
    or the target without asking, never over uncommitted changes, and the
    checkout goes back to the branch it was on. The target is made a branch
    of the clone's own where it has none, following the remote's, as
    `git switch` would, so a merge here and the look for conflicts here have
    it; nothing is checked out for that.
  - **Release chores are the coordinator's on the person's word only,** as
    merging is (ADR-081): `create_branch` makes a branch on the host from a
    branch, a tag or a commit, pushed by Althar only where the host has no
    such branch as it takes the push (an empty lease), so a branch there
    already, even one made a moment before and behind it, is left as it is; `open_pull_request` opens one from a
    release branch back into the default branch. Both are asked-for tools,
    run only in a turn the person's message started or as an errand's step.
    Putting a merged fix on another branch is a task toward that branch, its
    lead cherry-picking it, with a pull request of its own.
- **Alternatives considered:**
  - **Work toward at the coordinator's composer,** above it or in its row:
    always in sight while planning, but beside Run there was then a second
    branch, and the two read as different things; and over the composer it
    competed with what floats there while work runs.
  - **A plain branch picked beside Run as only where Run runs** (ADR-066):
    kept for pull requests and tasks; a branch run apart from the project's
    one is rare, and its pull request runs it.
  - **Reading the target off `baseRef` alone:** no new column, but a task
    whose fetch fell back to the local branch, or a fork's work bound
    upstream, loses where it goes, and a draft can't be pointed elsewhere
    before its worktree moves.
  - **A target per project only:** simpler, but a fix for the release while
    main moves on is the common case, and needs one task pointed there.
  - **Moving a task that has started to another target:** its commits would
    need rebasing onto the new branch; left for a task of its own.
- **Trade-off:**
  - The branch list is what this Mac last fetched: a branch made on the host
    a moment ago shows once Althar fetches again.
  - A task across several repositories takes one target for all of them; one
    without that branch refuses it.
- **Revisit when:**
  - People ask for a target per repository within a task, or for moving a
    task under way to another branch.
  - Hosts give Althar a way to read a branch list without fetching.
