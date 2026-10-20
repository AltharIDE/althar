# Cleaning up finished tasks' folders

> **Temporary.** The decision for DEV-143, before anything is built. Once it
> is built, the lasting part becomes an ADR (amending ADR-006 and ADR-020)
> and this file goes.

Written 20 October 2026. The prototype of the directions is in the task's
scratch folder (`.althar/scratch/folders`), on the real app with the tests'
fake client.

## Why

Althar never removes a task's folder. It says so on purpose
(`Tasks.ts`, architecture 01: "It never … removes their worktree"), so
disk use only grows. An `althar` task's folder takes 2.0–2.5 GB, almost all
of it `node_modules`. This Mac has 132 of them under `~/Charrette/althar`,
and its disk is 93% full with 31 GB free. The store already expects a
clean-up: `workspaces.state = 'cleaned'` and `cleaned_at` exist and nothing
writes them.

## The decision in one line

A week after a task settles, Althar removes its folder. This is on by
default, with one switch in Settings › Work on this Mac and a Clean up now
beside it. The branch stays. The folder comes back by itself when the task
needs it. A folder holding work that exists nowhere else is never removed.

## 1. What counts as finished

| Option | Verdict |
| --- | --- |
| Only merged changes | Too narrow: prototypes, research and abandoned work keep their folders forever |
| A closed or merged pull request | No: a closed PR's task may still be under way |
| **What is in Settled** | **Recommended** |
| Settled and Kept for later | No: keeping is the person saying "not yet" |

**Recommendation:** a task is finished when it is in Settled. That means
done or abandoned, with `settled_at` set, in phase `settled`. It covers:

- merged changes;
- abandoned tasks, whatever became of their PR;
- quick tasks (prototypes, chats, research) the person marked Done;
- reviews once posted and settled.

It leaves out:

- **Kept for later** (phase `kept`).
- **Anything still under way, ready or waiting.**
- **A merged task with commits after its PR.** `Queries.ts` keeps it
  `ready`, not settled.
- **A task gone back to work (ADR-034).** It is open again, so it isn't
  settled.

It is one rule the person can already see: what is in Settled is finished.

Folders that go with their task:

- the reviewer's copy, `.review/<task>`;
- a review task's read-only PR copy. It is a standalone repository that
  borrows objects, not a worktree, so it is deleted rather than
  `git worktree remove`d.

The project's own `.coordinator` and `.run` folders are never touched.

## 2. When

| Option | Verdict |
| --- | --- |
| Right away, as it settles | Too eager: a merged task is often run, checked or followed up in the next days, and each of those would pay a setup |
| **A week after it settles** | **Recommended, on by default** |
| When the disk runs low | Good as a safety net, but on its own it acts at the worst moment and surprises (prototype C) |
| Only when the person asks | Nobody remembers until the disk is full (prototype B) |

**Recommendation:**

- **Automatic, a week after the task settles.** The week runs from the
  latest of three moments: it settled, the person opened its task, or they
  opened its folder in an editor.
- **Clean up now, for the rest.** For when space is needed today.
- **On by default, existing installs included.** The protections in §4
  are what make that safe. Off by default would mean it is never turned
  on, which is how the disk got here. The customizability research had it
  off; I'd turn it on.
- **The first sweep is the big one.** On this Mac it would take most of the
  132 folders, so the release notes say so.
- **No setting for the number of days.** Nobody needs to tune it, and Clean
  up now covers "I need room today".

## 3. What is removed

- **The folder, and everything in it:** `node_modules`, build output,
  caches, copied `.env` files and `.althar/scratch`. Removed with
  `git worktree remove --force` after the checks in §4, then
  `git worktree prune`.
- **Not the branch.** A ref costs nothing. It is how the folder comes back
  and how its diff stays readable, and deleting it is the person's call.
  Superset and Conductor keep branches by default too. Review snapshot
  commits, today reachable only from the `.review` copy's `HEAD`, get a ref
  of their own so git doesn't collect them.
- **Not shared caches** (bun's or pnpm's global store). They are the
  package manager's, and they are what makes coming back fast.
- **Nothing running.** A folder with something running is left alone, not
  stopped (§4). What an agent left running already stops when its task
  settles.

**Kept first, so the task still reads whole.** Today the task view reads
some things live from the folder:

| What | Today | Before removal |
| --- | --- | --- |
| Diff | `diffs.ts`, empty without the folder | Kept as a patch artifact: `repository_changes.patch_artifact_id` exists and is never written. Or read from `base_commit..branch`, which needs no folder |
| Documents the thread links to | Read live; ADR-020 says they go with the worktree | Copied into the artifact store |
| Files the lead handed back | Read live | Copied into the artifact store |
| Screenshots, command output | Already in the artifact store | Nothing to do |

Then the workspace is marked `cleaned` with `cleaned_at`, and the thread
gets one Althar line.

## 4. What is never touched, and how Althar tells

A folder is left alone, and listed with why, when:

- **It holds work that exists only there:** changes not committed, or new
  files not ignored (`uncommittedFiles`, `git.ts`). Commits not pushed are
  *not* a reason to skip it: they are on the branch, which stays.
- **Something runs from it:** a run (`Launches`), an agent's session or
  the commands it left running, or a setup under way.
- **It is kept for later, or going back to work.** Neither is settled. A
  round that opens while a removal runs waits for it, through a lock per
  task.
- **It was opened recently:** within the week (§2). Opening a task's
  folder in an editor isn't recorded today (`OpenInEditor` writes
  nothing), so it needs an `opened_at` beside `seen_at`.
- **Git can't say what is in it.** If the status read fails, the folder is
  left alone (Orca and Superset do the same).
- **Althar didn't make it.** Only paths in `workspaces` under the worktree
  root are touched.

How Althar tells:

- **No notification and no Needs you.** It is housekeeping.
- **The Clean up now dialog lists each folder it leaves alone, with why**,
  and on request the folders it removes, with their sizes.
- **A folder left alone is tried again the next day.**
- **Each removed task's thread says what went:** "Removed its folder a week
  after it merged, to free 2.3 GB. It comes back when you write here, open
  it or run it."
- **Settled rows don't change.** There is nothing for the person to do
  about a folder that is gone.

**Later, if skipped folders pile up:** save their uncommitted work to a
hidden ref before removing, as Conductor and Codex do, so those folders
can go too.

## 5. Coming back

**Recommendation:** on demand, without a button.

- **What brings it back.** Writing to the lead (a new round, ADR-034),
  Open in, Run, pushing, and reopening an abandoned task.
- **How.** Althar first puts the folder back at the same path, from:
  1. the local branch;
  2. else the remote branch;
  3. else the PR's head or merge commit.

  Then it runs setup again, and only then does what was asked.
- **What the thread shows.** "Bringing its folder back from althar/…",
  then the setup line it already has, then the lead's turn.
- **Code to reuse.** Reopening an abandoned task already restores a folder
  (`Tasks.reopen`). Two places need extending:
  - **Done tasks.** `Tasks.ts` refuses to reopen one today.
  - **The lead's session.** `Sessions.loadThread` requires a ready
    workspace and never puts one back.
- **Meanwhile, reading needs nothing.** The conversation, Outputs, the
  diff, the screenshots and the documents all read without the folder
  (§3). The task view looks as it did; only the thread's line says the
  folder went.
- **No Restore button.** The composer, Open in and Run are already the
  ways in.

## 6. Setup cost

**Coming back reruns setup.** For `althar` that is the checkout plus
`bun install` from a warm cache, probably 30–60 seconds (not measured
yet). That is acceptable because a week's grace makes it rare, and the
thread shows it happening.

**Reusing installs between folders is worth doing, but separately.** For
example, an APFS clone of the main checkout's `node_modules`, as Orca's
`sharedDirectories` does. It would speed up every task's start, not only
coming back. It isn't needed for this.

**Disk sizes need an honest figure.** bun clones files on APFS. So `du`
overstates a folder, and removing one frees less than `du` said. The
dialog says "about"; after removal, Althar measures the volume's free
space and says what was really freed.

## 7. How others do it

| | When | Removes | Protects | Coming back |
| --- | --- | --- | --- | --- |
| Superset | When you delete a workspace; a teardown script first | Folder; branch only if ticked | Blocks on uncommitted work unless forced | Restore re-creates it and reruns setup |
| Orca | When you delete; suggests "inactive" ones (archived and idle 7 days, or idle 30) | Folder, then `git branch -d` | Uncommitted, pinned, running, unpushed | None |
| Conductor | On archive; optional archive on merge | Folder; branch optional | Saves uncommitted work to a ref first | Unarchive |
| Codex app | On archive, or past 15 worktrees | Folder | Pinned, running, marked permanent; snapshot first | Offers to restore the snapshot |
| Cursor | Past 25 worktrees or a size cap, on a timer | Folder, even with changes or open | Little; a known source of complaints | Chat only, not the folder |
| Claude Code | After `cleanupPeriodDays`, for subagent worktrees | Folder and branch, if clean | Changes, unpushed, locked, not its own | None |

Superset and Orca were read in their source; the others through their
docs.

**Copy:**

- Remove the folder and keep the branch.
- Fixed protections, with no settings.
- One time-based backstop rather than a count.
- Coming back re-creates the folder and reruns setup.
- Touch only folders Althar made.
- Later: save uncommitted work to a ref first.

**Don't copy:**

- Cursor's silent removal by count or size.
- Settings sprawl: three clean-up settings, script overrides, a review
  screen for clean-ups.
- A "delete the branch" checkbox.
- Symlinked `node_modules`.
- Teardown scripts. Nothing above needs one; add one when a project
  asks.

## 8. Where the setting lives, and the docs

**App-wide, in Settings › Work on this Mac.** The disk is the Mac's, and
the setting sits beside keep awake and agents at once. It is one switch,
"Remove finished tasks' folders", on. Under it, set in, "Settled this week
· 6 folders take 14 GB · Clean up now".

**No setting per project.** The research put it in the project's Running
("Where its work goes"). But nobody makes this choice per project, and
each project would add a setting. The project's Worktrees row could show
its size later (prototype B), but that isn't needed now.

**The docs:**

- **A new ADR:** "A finished task's folder goes a week after it settles;
  its branch brings it back".
- **ADR-006 and architecture 01.** Their "never removes" passages change.
- **ADR-020.** Documents no longer go with the worktree.
- **The comment in `Tasks.ts`.**
- **The glossary.** "Task folder" is the word on screen.
- **The release notes.** They mention the first sweep.

## The prototype

`.althar/scratch/folders`, at http://localhost:5393/. The bar at the
bottom switches the direction (keys 1–4, ←/→) and goes to each place.

| Direction | The setting and Clean up now | A folder that went | Coming back |
| --- | --- | --- | --- |
| Today | Nothing | Never goes | n/a |
| **A · After a week** | Switch in Work on this Mac; Clean up now set in under it | Thread line; card unchanged | Automatic, shown in the thread |
| B · When you ask | None; Clean up in the project's Running › Worktrees, and at the head of the Settled lane | Thread line; settled row says "folder removed" | Same |
| C · When space runs low | Switch in Work on this Mac; the load meter's peek gets a Disk line with the task folders' part and Clean up | Thread line | Same |

**Pick: A.** C's disk line in the load meter is worth keeping in mind
as a later addition.

## Open

- **The real cost of coming back.** Time a restore plus setup on
  `althar`.
- **Space actually freed** on APFS, against what `du` says.
- **Whether to make room early when the disk runs low.** That would add
  C's behaviour as a backstop, with no setting of its own.
- **Removing a project for good** (open questions, "Removing for good")
  can reuse this.
