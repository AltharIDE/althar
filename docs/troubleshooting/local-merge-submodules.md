# Submodules and merging a task here

Merging a task into the default branch on this machine moves the default
branch, and its checkout's files, but never a submodule's checkout, even with
`submodule.recurse` set. Where the merge changes the commit recorded for a
submodule, the submodule stays where it was until you run
`git submodule update`.

## A submodule the merge leaves alone

Althar doesn't look inside it. Changes not committed there, a different
commit checked out, or a submodule git can't read at all don't stop the merge,
which leaves it exactly as it is. The same goes for a submodule the merge
adds, where the checkout already has a folder of that name.

## A submodule the merge moves

Before merging, Althar reads each submodule whose recorded commit the merge
changes, if it is checked out. The merge is refused, and nothing moves in any
repository, if that submodule:

- has changes not committed to files it tracks (files git doesn't track there
  don't count: the merge never touches them),
- isn't at the commit the default branch records for it (left behind by an
  earlier merge, say: run `git submodule update`), or
- can't be read. The refusal gives the submodule's path and everything git
  said.

To see the full diagnostic yourself, run these read-only commands with the
paths from the refusal:

```sh
git -C /path/to/checkout/path/to/submodule rev-parse HEAD
git -C /path/to/checkout/path/to/submodule status --porcelain --untracked-files=no --ignore-submodules=dirty
```

What to repair depends on what they say, and on any uncommitted work there.
Merge again once both succeed.
