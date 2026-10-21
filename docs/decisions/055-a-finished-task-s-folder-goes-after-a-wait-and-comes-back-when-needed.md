# ADR-055: A finished task's folder goes after a wait that suits how it ended, and comes back when the task needs it

- **Status:** Accepted
- **Date:** 2026-10-21
- **Owner:** Repository maintainers
- **Context:** Each task has a worktree folder of its own
  ([ADR-006](006-worktree-per-task.md)), set up with its repository's
  install. For `althar` that is 2.0–2.5 GB a task, almost all of it
  `node_modules`. Althar never removed one, so disk use only grew. One Mac
  had 132 task folders and a disk 93% full. The store had a `cleaned` state
  and a `cleaned_at` column for workspaces, and nothing wrote either.
  Removing a folder by hand broke the task's view: its diff, the documents
  its agent wrote and its code panel read the folder itself. Only reopening
  an abandoned task could put a folder back; a merged one could not come
  back at all. The decision and its prototypes were worked out in the
  task for DEV-143.
- **Decision:**
  - **A task is finished once it is in Settled.** That means done or
    abandoned, with `settled_at` set. A merged one with commits after its
    pull request isn't: it waits in Needs you. Kept for later isn't, and
    neither is a task gone back to work
    ([ADR-034](034-a-task-goes-back-to-work-and-ships-again.md)). A
    removed project's folders stay, as removing it says.
  - **Its folders go after a wait, as the person chooses** (`folder_wait`
    in `settings`). **Smart**, to start:

    | Task | Wait |
    | --- | --- |
    | A review (its copy has nothing of the person's) | Right away |
    | A merged change | 3 days |
    | A done quick task | A week |
    | An abandoned one | 2 weeks |
    | Any, below 10% of the disk free | Sooner: the oldest go first, until 15% is free |

    Or one wait for all: a day, a week or a month. Or only when the
    person cleans up. The wait runs from the latest of three moments: it
    settled, its screen was last opened (`seen_at`), or its folder was
    last opened from Althar (`tasks.opened_at`). A sweep runs two minutes
    after Althar starts, every hour after, and at once on a new choice
    (`FolderCleanup.ts`).
  - **What goes:** the folder, with everything in it, the reviewer's copy
    beside it (`.review/<task>`), and the task's folder once it is empty.
    The branch stays. The folder's last commit is kept under
    `refs/althar/kept/<workspace>`, and nothing of it goes until it is.
    The workspace becomes `cleaned`, with `cleaned_at`, only once nothing
    of the folder is left; one that stays counts as one that couldn't go,
    and is tried again. Its thread says so as a line across it (a notice
    with the role `folder`): "Folder removed 3 days after the task
    finished · 2.3 GB". An idle lead held on the task stops first.
  - **What is held back.** A folder is held back where:
    - it has changes not committed;
    - it is an abandoned change whose commits were pushed nowhere. A quick
      task is never pushed, and its branch keeps its commits, so this
      doesn't hold one;
    - something runs from it, or is starting to, or it is being set up
      again;
    - it was opened from Althar today;
    - git can't say what is in it.

    Where several hold it, the gravest shows: running, then what would be
    lost (changes not committed, what git can't read, commits pushed
    nowhere), then opened today. Clean up skips a held-back folder too.
    What holds a folder is asked again just before it goes, under the
    lock that bringing it back, opening it and starting a run take
    (`withFolder`), so nothing that happens after the folders are chosen
    is lost. The person can still remove one by hand, but not while
    something runs from it; Remove says first what goes with it, or what
    stays, and sends what it said: where more would be lost by then, the
    folder stays and the list reads again (`ChangedSinceSeen`).
  - **Coming back.** A task whose folder went reads as it did:
    - its changed files, their diff and its commits, from the kept commit
      in its repository (two commits, never the person's working tree);
    - a document its agent committed;
    - its screenshots and command output, which were in the artifact
      store already.

    Its folder comes back, at the same path, before anything needs it:
    - before an agent starts on the task, as a session loads its thread;
    - before it opens in an editor or the code an agent named opens;
    - before it runs;
    - as it is reopened.

    It comes back on its branch, else detached at the kept commit; a
    review's copy is made again. Something else at its path is never
    taken for it, nor removed: it doesn't come back, and says so. It is
    set up again, an abandoned task's too, and Run waits for that however
    it came back. Its thread says "Folder back from its branch". Its
    header's chip says "Bringing its folder back", in blue, until it is
    set up. A removal and a return wait for each other (`withFolder`), and
    a removal waits for the task's thread to be quiet (`Sessions.quiet`).
  - **Where the person sees it.** One row in Settings › Work on this Mac,
    "Remove finished tasks' folders", with the choice at its end.
    - **Under it:** this Mac's disk as one bar, with what is held back
      in a paler cobalt and what could go now hatched.
    - **The legend:** it opens a compact list, one line a folder: what
      Clean up takes, then, below a hairline, what is held back, each with
      why and its own Remove.
    - **Clean up:** it takes what nothing holds, whatever its wait, and
      says what it freed, measured on the disk after (`du` overstates
      folders whose installs share blocks).
    - **Nothing in Needs you, and no notifications:** it is housekeeping.
- **Alternatives considered:**
  - **Right away, as a task settles:** a merged task is often run,
    checked or followed up in the next days, and each of those would pay
    a setup.
  - **Only when the person asks:** nobody remembers until the disk is
    full. It is still one of the choices.
  - **Only when the disk runs low:** it acts at the worst moment and
    surprises. Smart includes it as a backstop.
  - **Off by default, or per project:** off, it would never be turned
    on. Nobody makes this choice per project, and the disk is the Mac's.
  - **Deleting the branch:** a ref costs nothing, and it is what a folder
    comes back from.
  - **A dialog before Clean up:** nothing it takes is lost for good.
  - **A Restore button:** the composer, Open in and Run are already the
    ways back.
  - **Copying installs between folders:** worth doing for every task's
    start, separately.
  - **Teardown scripts, a count limit, settings per kind:** settings
    sprawl, as in Superset, Cursor and Orca.
- **Trade-off:** coming back reruns setup, about a minute for `althar`,
  and the thread and header say so while it does. A document an agent
  never committed, and everything git ignores, such as
  `.althar/scratch`, go with the folder. Sizes are measured in the
  background, so the first look at Settings may say "Measuring…".
- **Revisit when:** held-back folders pile up; then save their
  uncommitted work to a hidden ref before removing them, as Conductor and
  Codex do. Also revisit when people ask to keep a kind's folders longer
  than Smart's wait, or when installs are shared between folders.
