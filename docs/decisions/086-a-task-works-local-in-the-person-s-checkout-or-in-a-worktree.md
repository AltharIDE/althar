# ADR-086: A task works Local, in the person's checkout, or in a worktree of its own

- **Status:** Accepted; amends [ADR-006](006-worktree-per-task.md)
- **Date:** 2026-11-03
- **Owner:** Repository maintainers
- **Context:** ADR-006 gave every task a worktree of its own and kept "a plain
  branch in the user's own checkout" as a later opt-in. For some projects a
  worktree costs more than it gives (DEV-39). An iOS app's worktree is a new
  path, so Xcode's DerivedData, Swift package resolution and `pod install`
  start cold in each one, and parallel tasks share the Mac's simulators
  anyway. A worktree is code, not a running environment: local services,
  Compose projects and Kubernetes contexts are set up around the person's
  checkout. The Codex app offers both, per thread: Local, in the person's
  project folder, or Worktree, with Handoff to move a thread between them.
  Three directions were prototyped (the checkout as "your checkout", as
  Local, or as a place with a card of its own), and the person chose Codex's
  words and model: Local or Worktree, a project default the coordinator
  overrides per task, and a busy checkout sending the task to a worktree.
- **Decision:**
  - **Each task works in one of two places**, the same for all its
    repositories: **Worktree**, a folder of its own as before (ADR-006), or
    **Local**, each repository's own clone on this device, where the person
    works (`workspaces.kind = 'checkout'`). Worktree stays the default.
  - **The project has a default, and the coordinator chooses per task.**
    The project's General settings say where new tasks start (New tasks
    start in: Local or Worktree, one of its rules, `worksIn`). `draft_task`,
    `propose_plan` and `start_task` take `works_in` (`local` or `worktree`)
    and `works_in_why`, defaulting to the project's; a plan keeps both. The
    coordinator is told the project's default, and its tools say who works
    Local now; it is asked to plan in a worktree while Local is taken, saying
    why, unless the task can wait. The plan card shows the choice beside its
    title, with the coordinator's why or who works Local now, and the person
    can change it until the task's first step starts.
  - **One task holds a repository's checkout at a time,** from when its work
    starts until it is settled and the checkout has gone back. A task
    started Local while another holds it waits, its first step held
    (`hold_reason = 'checkout'`), Up next, after that task; it starts as soon
    as the checkout goes back, looked at again every few seconds. A draft
    doesn't hold it: nothing is made for it until its plan starts, and a
    worktree made for a draft that then starts Local goes, unused. A task
    never holds one checkout while it waits for another. A checkout is the
    folder it is (its device and inode), not a project's repository: the
    same folder added to two projects is one checkout, and a task of either
    waits for the other's.
  - **Althar never switches a checkout with uncommitted changes, and never
    stashes, resets or cleans it.** Taking a checkout, Althar reads it first.
    Clean, on its default branch or with no branch it would leave behind, it
    makes the task's branch at the start it planned and checks it out,
    remembering the branch it was on (`returns_to`), and says so in the
    task's thread. With uncommitted changes, it asks the person (a `checkout`
    call, in the task's thread and Needs you): wait until they are
    committed, or start in a worktree. On a branch of the person's own, it
    asks: check out the task's branch from where tasks start, start the task
    from that branch, or start in a worktree. It asks about one repository's
    checkout at a time, and an answer holds for that checkout only, as it was
    when asked: waiting, while it still has uncommitted changes; checking out
    the task's branch or starting from the person's, while it is still on
    that branch at that commit. A checkout that changed since is asked about
    again.
  - **The checkout goes back when the task is settled.** Settled done or
    abandoned, the checkout is switched back to the branch it was on, if it
    is clean and still on the task's branch, and not until everything of the
    task has stopped: no agent of it left, in a turn or idle, and its
    settling done stopping what they ran (LeftBehind's `stopping`, counted
    from before a task is abandoned or marked done). Until then it is the
    task's, for a task waiting for it too. With uncommitted changes it stays,
    says so in the task's thread, and goes back once they are committed. A
    checkout the
    person switched themselves is left where they put it. A settled task
    opened again whose checkout went back carries on in a worktree of its
    own, on its branch.
  - **A quick task in the checkout has its branch from the start,** made
    when it takes the checkout, so the person's branch never gets its
    commits. It stays a quick task (ADR-035): its branch stays on this Mac.
  - **The person may edit in it while a task works there.** The lead is told
    the folder is the person's own: commit only its own files, by name,
    never switch branch, stash, reset, restore or clean. Git that would throw
    away what isn't committed there (`reset --hard`, `stash`, `clean -f`,
    `checkout -- .`, `restore`) asks, even with everything allowed, as in
    another checkout (ADR-067). The task's card reads "Change · Local", and
    its composer names Local beside the lead's model.
  - **Nothing of Althar's housekeeping touches a checkout.** Folder cleanup
    (ADR-056) never removes it or holds it back, nothing is brought back,
    restart repair leaves it waiting, and the recorded setup (ADR-080)
    doesn't run there: the person's own environment is already set up. Run
    (ADR-044) runs in it. A quick task's scratch folder, which git ignores,
    is made in it, as in a worktree.
  - **Where the choice is made, it says what it gives up:** one task at a
    time, beside the person's own edits.
  - **Handoff comes later:** moving a running task between Local and a
    worktree, as Codex does, keeps its branch and its session; it is
    designed (a Hand off button in the task's bar) but not built. What a
    reopened task does already, moving to a worktree on its branch, is its
    first half.
- **Alternatives considered:**
  - **The checkout as a place on the board,** with a card of its own for who
    is in it and who is next, and the choice made in the repositories' map:
    clearer about the queue, heavier everywhere else, and the person chose
    Codex's simpler model.
  - **Waiting by default when Local is taken:** keeps each task where it
    was planned, but leaves work standing; the coordinator choosing a
    worktree and saying why keeps work moving, and waiting stays one press
    away on the plan card.
  - **Stashing the person's changes, or a temporary commit:** quick, and
    exactly what surprises people. Asking costs one answer.
  - **A choice per repository:** a task across several repositories works
    in one kind of place, and a project is where the person thinks about
    how they work. A repository without a clone here can't be Local, and is
    said so on the plan card.
  - **Telling the person's edits apart from the lead's by watching files:**
    the lead's own edits are known to its session; a file both touched is
    ambiguous either way. Left to the lead's instructions for now.
- **Trade-off:**
  - No parallel work in the checkout: a second Local task waits or goes to a
    worktree.
  - The person's own edits share the folder: a commit can take in a file
    the lead shouldn't have, which the person sees in its pull request.
  - The checkout stays on the task's branch until it is settled, so the
    person can try it in their own tools first, and works on another branch
    meanwhile only by settling the task or in a worktree of their own.
- **Revisit when:**
  - Handoff is built: moving a task between places keeps its branch, its
    session and its thread.
  - Agents report which files they wrote: the person's edits can be told
    apart and shown.
  - People ask for the choice per repository.
