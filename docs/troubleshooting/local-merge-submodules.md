# Submodules and merging a task here

Before merging a task into the default branch on this machine, Althar reads
the status of the checkout that has the default branch, and of every
initialized submodule in it.

## When a submodule can't be read

If git fails to read the status of the checkout or of any submodule, the merge
is refused and nothing moves in any repository: the default branches and the
task's branches stay where they were, and the task stays open. The refusal
gives the checkout's path and everything git said, including the path of the
submodule that failed, for example:

```text
fatal: 'git status --porcelain=2' failed in submodule vendor/library
```

To see the full diagnostic yourself, run these read-only commands, with the
checkout's path and the submodule's path from the refusal:

```sh
git -C /path/to/checkout status --porcelain --untracked-files=no --ignore-submodules=none
git -C /path/to/checkout/vendor/library status --porcelain=2 --untracked-files=no --ignore-submodules=none
```

What to repair depends on what they say, and on any uncommitted work there.
Merge again once both succeed.

## When a submodule counts as changes not committed

Althar reads status with `--ignore-submodules=none`, and checks each submodule
on its own too, so a submodule's `ignore` setting, at any depth, doesn't hide
changes in it. The merge is refused as busy if a submodule has changes not
committed, or isn't at the commit the default branch records for it.

Merging here moves the default branch's record of each submodule but never
updates the submodule's own checkout, even with `submodule.recurse` set. After
a merge that changes a submodule, its checkout stays where it was until you
run `git submodule update`, and until then the next merge here is refused as
busy.
