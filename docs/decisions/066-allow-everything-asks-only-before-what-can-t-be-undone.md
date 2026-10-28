# ADR-066: Allow everything asks only before what can't be undone

- **Status:** Accepted
- **Date:** 2026-10-28
- **Amends:** [ADR-043](043-allow-everything-is-one-switch-for-a-project-or-a-task.md)
- **Owner:** Repository maintainers
- **Context:** ADR-043's amendment (DEV-69) kept everything that could lose
  work or a secret asking with everything allowed: the floor. The floor
  also stops the coordinator answering, and there it is right, but with
  everything allowed it held more than the person meant. They kept getting
  cards in a project set to allow everything, asking "why do I keep
  getting permission requests when I allowed the bypass anything?". Popping
  or dropping a stash, letting git forget what it keeps to recover lost
  work, and reading a `.env` the task doesn't own can all be got back or
  lose nothing for good. The person decided that allowing everything
  should ask only before what can't be undone from the task.
- **Decision:** the floor has a narrower part, what is **irreversible**,
  and only that asks with everything allowed, on a project or on a task.
  - **Still asks with everything allowed:** a push to the default branch,
    or deleting it; a force push, `+ref` and `--mirror` included; deleting
    a branch that isn't the task's, here or on the remote, `--prune`
    included, or moving or renaming one by force; changing, deleting or
    moving away what's outside the task's worktree, another checkout above
    all, the person's own; git that could throw away work in another
    checkout; removing a worktree that isn't the task's; and a push, `cd`
    or command Althar can't read where it could be one of these.
  - **Goes ahead with everything allowed:** `git stash` in the task's
    worktree, `clear`, `drop` and `pop` included; pushing tags, every
    branch, or a pattern of branches (which already went ahead);
    `git reflog expire`, `git gc --prune=now`, `git prune` and the like;
    reading a `.env` outside the task's worktree.
  - **What holds as before:** Never still refuses any of it, and while
    Never lists anything a command Althar can't read is still refused.
    No one reads keys and sign-ins, whatever the switch says. In every
    other mode (allowed as the rest, the coordinator decides, ask me) the
    whole floor holds as it did: the coordinator never answers it, and it
    asks unless the person always allows its kind.
  - **A card that still asks says why in one line**, such as "A force
    push asks even with everything allowed: it can throw away commits on
    the remote." Each irreversible kind's reason now ends with why it
    can't be undone, in every mode.
  - In the code, `Kept` carries `irreversible` beside `floor`
    (`packages/runtime/src/rules.ts`): each rule is marked once where it is
    found, `'floor'` or `'irreversible'`, so the other modes read the floor
    and allowing everything reads only what is irreversible.
- **Alternatives considered:**
  - **Dropping the floor from those rules outright.** One marker fewer,
    but the coordinator would then judge popping the person's stash or
    reading their `.env`, which it never has.
  - **A list of rule ids allowing everything asks about.** The kinds are
    broader than the floor (`outside` holds both writing a file in `/tmp`
    and `rm -rf` of the person's checkout), so the line has to be drawn per
    request, where the rules find it.
- **Trade-off:** the stash is shared by every checkout of the repository,
  so with everything allowed an agent may pop or drop an entry that is the
  person's or another task's; the person chose that over a card for it. A
  `.env` the task doesn't own can be read, so what it holds may reach the
  agent's provider.
- **Revisit when:** people lose a stash entry or a secret to a task with
  everything allowed, or want a kind that can't be undone to go ahead too.
