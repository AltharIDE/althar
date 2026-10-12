# Submodule status failures during a local merge

## The reported case

In the `sznszkmnet` project, accepting a local merge reported:

```text
git status didn't work: fatal: 'git status --porcelain=2' failed in submodule zitadel-iam/zitadel.
```

The user's repository is unavailable in the task's checkout. The investigation
reproduced this exact final Git diagnostic in an isolated repository with an
initialized submodule at `zitadel-iam/zitadel`, by corrupting only that fixture's
submodule index. A second fixture used a submodule within another submodule.
This demonstrates the failure mechanism; it does not establish that the user's
index is corrupt. The original message omits the diagnostic needed to determine
the fault in that repository.

## How the failure reaches the merge

`Projects.readFolder` discovers the opened repository or repositories directly
inside a folder, one level down. It does not recursively discover submodules.
`Changes.mergeHere` selects the task's repositories without pull requests, then
calls `localMerge.planMerge` for every repository before applying any merge.

`checkedOut` asks Git which worktree holds the default branch. Its status must
be checked there, even when the task's separate worktree is clean or has no
initialized submodules. Worktree discovery uses NUL-delimited records so paths
containing quotes, newlines or trailing spaces remain intact.

The preflight's `git status --porcelain --untracked-files=no` can ask Git to
inspect initialized submodule worktrees. Git uses `status --porcelain=2` inside
them; the different porcelain version in the error comes from Git itself.
A nested status failure makes the parent command fail, even with empty stdout.
`git.ts` already preserves the exit failure, checkout directory and stderr in
`GitFailed`. The generic error wording previously displayed only stderr's last
line, losing the underlying diagnostic and, for deeper nesting, inner paths.
The original planning failure already prevented branch updates; the fix makes
that refusal explicit and keeps its diagnostic intact.

## What Althar does now

- Read tracked status with `--ignore-submodules=none`. If the parent appears
  clean, also run this check in every initialized submodule using
  `git submodule foreach --recursive`. A nested repository's own ignore
  settings can otherwise hide changes or errors despite the parent's option.
- Return an `unreadable` plan on any failed status read. Keep the checked-out
  default branch's path and complete stderr, including the failing submodule
  path and underlying Git error. Never retry with ignored submodules or treat
  empty output from a failed command as a clean checkout.
- Refuse the whole local merge before applying any repository's plan. Check all
  destinations again after planning, before even updating a branch that has no
  checkout. An unreadable result leaves the task open and emits no merge-success
  notice.
- Disable recursive submodule updates for both the fast-forward and rollback.
  Gitlinks may change in the parent; submodule working trees stay in place.
  The existing order of ref updates, checkout updates and rollback is retained.
- Keep the existing settled-task and pull-request guards. A settled task's
  branch stays as it is, and a repository with a pull request merges through
  that pull request.

For the same `sznszkmnet` failure, the person should see a refusal explaining that
Althar could not check the default checkout or its submodules and that nothing
was merged, followed by the checkout path and **all** of Git's diagnostic lines,
including `zitadel-iam/zitadel`. Every participating repository's default branch
and every task branch stay where they were. Retrying requires resolving the
reported Git failure; readable but dirty submodules still block the merge.

To obtain the missing diagnostic from the actual checkout, the person or lead
can collect the full output of these read-only commands, substituting its path:

```sh
git -C /path/to/default-checkout status --porcelain --untracked-files=no --ignore-submodules=none
git -C /path/to/default-checkout/zitadel-iam/zitadel status --porcelain=2 --untracked-files=no --ignore-submodules=none
```

These commands diagnose the state; choosing a repair depends on that output and
the person's uncommitted work.

## Verification and limits

Manual Git reproduction in temporary local repositories confirmed:

- Clean initialized nested submodules produced empty successful status.
- A corrupt fixture index produced exit 128, empty stdout and the exact reported
  `zitadel-iam/zitadel` failure, preceded by the useful index diagnostic.
- Ignoring submodules produced empty successful status despite that corruption.
- A nested ignore setting hid dirty state from the parent's strict status;
  explicit recursive module checks exposed the changes and the corrupt index.
- NUL-delimited worktree output preserved a path containing spaces, quotes,
  a newline and a trailing space.

The source and error paths were reviewed, and `git diff --check` passed. No tests
were added or run, and no builds were run: they were not authorized. End-to-end
runtime verification, including multi-repository refusal and rollback, remains
unexecuted. The existing local-merge tests were read, not run. The user's actual
submodule fault still needs its full diagnostic.

Git references: [status options](https://git-scm.com/docs/git-status),
[submodule foreach](https://git-scm.com/docs/git-submodule),
[worktree porcelain format](https://git-scm.com/docs/git-worktree).
