# ADR-067: Allow everything asks only before what can't be undone

- **Status:** Accepted
- **Date:** 2026-10-28
- **Amends:** [ADR-043](043-allow-everything-is-one-switch-for-a-project-or-a-task.md)
- **Amended:** 2026-10-29: with everything allowed, what the rules can't
  read goes ahead; only what they read as one of the kinds below asks
  ([Amendment](#amendment-what-the-rules-cant-read-goes-ahead)).
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
    checkout; removing a worktree that isn't the task's. (A push, `cd` or
    command Althar can't read where it could be one of these asked too,
    until the amendment below.)
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

## Amendment: what the rules can't read goes ahead

- **Date:** 2026-10-29
- **Context:** the person's project allows everything, and their tasks
  still landed in Needs you, asking "Why do all my tasks keep asking me
  for permissions". Of the 57 Permission cards in the week to 2026-10-29,
  47 would still ask under the rules as they stood. Nearly all were what
  the rules couldn't read, not what they read as irreversible:

  | Why it asked, read again by the rules as they stood | Cards | Still asking after |
  | --- | --- | --- |
  | A `python3 - <<'EOF'` script editing files: its body has backticks and the word `push`, read as a command that could push | 14 | 0 |
  | A shell line with `$(…)` and the word `push` elsewhere (`git stash push`, `grep "push"`, a scratch repository's push) | 6 | 1 |
  | A variable the line sets itself (`d=$TMPDIR/x && rm -rf $d`) or a loop's (`for f in …; do mv "$f" …`) | 11 | 0 |
  | A relative path read from the worktree's top while the agent's shell was in a folder in it (`cd ../.. && rm -f sb.log`), or git in a folder that is no checkout | 16 | 1 |

  The other 10 were the stash, which the decision above already lets
  through. Of the 47, the one left in the second row is a push to main in
  a scratch repository under `$TMPDIR`, which the rules can't tell from
  the project's main; the one in the last deletes a file only if the
  command before it in its line fails. Every one was the lead's own
  work: editing the task's files, scratch folders, its own logs.
- **Decision:** with everything allowed, only what the rules **read** as
  one of the irreversible kinds above asks: a plain `git push origin
  main`, `git push --force`, `rm -rf` of the person's checkout, and the
  like, wherever they stand readably in a compound command or outside a
  heredoc's body. What the rules can't tell goes ahead, without the
  coordinator's judge: a judgment adds up to a minute of waiting to every
  command, a disturbance of its own. In the code, `lastingOf`
  (`packages/runtime/src/rules.ts`) leaves out:
  - what the rules can't tell (`Kept`'s `unclear`): a line with `$(…)` or
    backticks naming `push`, a variable, `xargs`, `eval`, a `cd` to where
    they can't tell, and what such a `cd` could lead to (`blind`);
  - the body of a quoted heredoc read by an interpreter of another
    language (`python3 - <<'EOF'`, `node`, `ruby`, `perl`), which is not
    the shell's commands; a shell's (`bash <<'EOF'`, `cat <<'EOF' | sh`)
    is still read;
  - a relative path that leaves the worktree only from its top: an
    agent's shell keeps the folder it moved to from one command to the
    next, so the line is read again from a folder that far inside the
    worktree, and asks only where it leaves from there too.
  In every mode, the rules no longer read as lost what can't be: git in a
  folder that is there but in no checkout fails, and deleting a file that
  isn't there, in a folder that is, deletes nothing. Both are still
  writing outside the worktree.
- **What holds as before:** while Never lists anything, a command the
  rules can't read is still refused, with how to spell it out. No one
  reads keys and sign-ins. In every other mode what the rules can't read
  asks as it did, and the coordinator still never judges it. The lead's
  brief doesn't change: agents use the tools they use.
- **Trade-off:** a script or line the rules can't read could, in
  principle, push to main, force push or delete the person's checkout,
  and with everything allowed it now runs without asking. The person
  accepts that on the presumption that today's agents are competent; what
  a lead does in plain words still asks. `$TMPDIR` and the like are not
  expanded: a path starting with them is already read, and none of the
  week's cards came from one.
- **Revisit when:** an agent does something that can't be undone through
  a command the rules couldn't read, or cards with everything allowed
  climb again.
