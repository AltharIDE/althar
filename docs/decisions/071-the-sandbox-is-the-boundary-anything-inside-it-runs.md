# ADR-071: The sandbox is the boundary: anything inside it runs

- **Status:** Accepted
- **Date:** 2026-10-29
- **Amends:** [ADR-019](019-coordinator-judges-permissions.md),
  [ADR-057](057-a-lead-works-outside-its-sandbox-through-althar-s-tools.md),
  [ADR-058](058-the-coordinator-is-a-trusted-reader-in-copies-of-its-own.md),
  [ADR-067](067-allow-everything-asks-only-before-what-can-t-be-undone.md)
- **Owner:** Repository maintainers
- **Context:** Althar decided by reading each command (`rules.ts`) and let
  through only what it could prove harmless. Real agents write loops,
  `$(…)`, heredocs, Python and variables. Claude Code sends whatever
  its own parser can't follow to Althar, even when it would run inside its
  sandbox, and Althar's reader couldn't follow it either, so it asked or
  refused. The person found Althar timid. In the 14 days to 2026-10-29,
  leads and the coordinator met 103 asks and refusals (and review steps 9
  more, below), read from the person's store:

  | Who | Asked or refused | Why | Times | Outside the sandbox | Everything allowed | The person allowed | Worked around |
  | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
  | Lead | Asked | A script in a heredoc (`python3 - <<'EOF'`) | 27 | 4 | 15 | 26 | – |
  | Lead | Asked | Deleting or moving outside the worktree | 13 | 8 | 13 | 13 | – |
  | Lead | Asked | A path the rules can't resolve (`rm $d`, `mv "$f"`) | 12 | 0 | 5 | 12 | – |
  | Lead | Asked | A substitution (`$(…)`) | 7 | 1 | 2 | 7 | – |
  | Lead | Asked | Dropping a stash entry | 7 | 0 | 7 | 7 | – |
  | Lead | Asked | git in another checkout (`git -C … checkout`) | 7 | 7 | 7 | 7 | – |
  | Lead | Asked | A loop (`for … do`) | 5 | 0 | 1 | 5 | – |
  | Lead | Refused | Changing the code host (`gh api`) | 2 | 0 | 0 | – | 2 |
  | Lead | Refused | Naming where keys are kept | 1 | 0 | 0 | – | 1 |
  | Coordinator | Refused | `git tag`, `git fetch`, `git pull` in its copies | 5 | 0 | – | – | 5 |
  | Coordinator | Refused | A substitution (`f=$(…)`) | 5 | 0 | – | – | 4 |
  | Coordinator | Refused | A program off the readers' list (`for`, `awk`, `gh`) | 5 | 0 | – | – | 5 |
  | Coordinator | Refused | A variable set for a command | 3 | 0 | – | – | 3 |
  | Coordinator | Refused | `$((…))`, `<(…)` | 2 | 0 | – | – | 2 |
  | Coordinator | Refused | Writing to `$TMPDIR` | 1 | 0 | – | – | 1 |

  The person allowed 77 of the 78 cards; the last was withdrawn. 58 of
  the 78 were for commands Claude Code would have run inside the sandbox
  anyway. All 21 of the coordinator's refusals were inside its sandbox, and
  it worked around 20, in the same turn (a later call of its completed).
  Each of those refusals was then explained in a turn of its own, after the
  reply, so the coordinator posted a second reply in the person's chat.
  Review steps were refused 9 times, all worked around. They keep their
  rules (below).
- **Decision:** the OS sandbox is the boundary, not the command reader.
  - **Where a session's sandbox holds its shell commands, what it holds
    runs without being read.** Claude Code's lead, where its sandbox can
    start (macOS; Linux with bubblewrap and socat that start a namespace,
    outside a Flatpak), now doesn't start without it (`failIfUnavailable`),
    so what Althar lets through unread runs in it. The coordinator's has
    held it since ADR-058. A request is held when it is a shell command that
    doesn't ask to leave the sandbox (`dangerouslyDisableSandbox`, for a lead)
    and starts as none of the commands that run outside from the start
    (`excludedCommands`). It is allowed in every mode, for a lead in its
    worktree and temp folders, and for the coordinator in its copies,
    loops, `$(…)`, heredocs and scripts included. The registry says which
    sessions are held (`AgentDefinition.holds`). The rules decide it with
    `decideInside` (`packages/runtime/src/rules.ts`).
  - **What still holds inside:** the project's own words. A command or a
    kind it never allows, where the line plainly is one, is refused, and a
    command it asks about asks. What it can't read runs, even while Never
    lists something. No one reads the keychain or git's stored passwords,
    whose service a Mac's sandbox still reaches. Keys and sign-ins stay
    unreadable by the sandbox's deny list, not by reading the words. The
    coordinator's edit tools stay denied, and its copies and mirror
    (ADR-058) keep it from the person's repositories.
  - **What crosses meets the rules as before:** a command that runs or asks
    to run outside the sandbox, an edit outside the task's worktree, a host
    it asks for. With everything allowed, only ADR-067's irreversible kinds
    ask; in every other mode, the rules as they stand.
  - **What can't be undone is stopped where it happens, at git.** Every
    lead's git takes its hooks from a folder of Althar's (`core.hooksPath`
    by the environment, `pushGuard.ts`). Its `pre-push` stops a push to the
    default branch, a push over commits the remote has that this one
    doesn't (a force push), and deleting a branch that isn't the task's.
    Its `reference-transaction` stops deleting such a branch here, or moving
    one so it loses commits. Whatever ran it, a script or a loop, it says
    what it stopped and to run it plainly, outside the sandbox, so Althar
    asks the person. Each hook then runs the repository's own, from its own
    `core.hooksPath` or its git folder. When the person allows a request the
    rules read as one of these, the session gets a pass for two minutes,
    which the hooks let through. Writes outside the worktree are stopped by
    the sandbox itself.
  - **A refusal says why in the refused call itself,** for an agent that
    reads it there (`PermissionMeanings.reasonInBand`). Althar's patch of
    claude-agent-acp hands the SDK the reason sent in the answer's `_meta`
    (`althar/refusal`) as its deny message. So no turn follows the reply to
    explain it, and no second reply lands in the coordinator's chat. Codex
    and the rest are told after the turn, as ADR-019 says.
  - **Every ask and refusal is counted by its kind** (`tallyKindOf`): one
    of the project's kinds, what the rules can't read, a command the project
    named, credentials, the code host, what a reader may not do, and the
    rest. The kind goes on the decision (`decisions.kind`, migration 0049)
    and on the card (`counted`). The project's rules say, under "Last 14
    days", how each kind went: how often it asked and was allowed, was
    refused, and was worked around (`tally.ts`). A kind that mostly gets
    worked around can be dropped.
  - **Where there is no sandbox Althar holds,** today's rules stay: on
    Windows, in a Flatpak, on Linux without bubblewrap and socat or where
    they can't start a namespace, for Codex (which asks only to go beyond
    its own sandbox already), OpenCode and the rest, and for a review's
    lead, which reads someone else's code. Git's guard holds for every
    lead, everywhere.
- **Alternatives considered:**
  - **Reading more of the shell** (#410, the coordinator's loops, and #411,
    allow-everything going ahead with what it can't read, both on
    2026-10-29). Each script read is one more case. Where a sandbox holds
    the command, reading it says nothing the sandbox doesn't, so their
    reading holds only where none does. #410's refusal that goes with the
    next prompt stays, for agents that don't read a refusal in the call.
  - **The coordinator judging what crosses.** A judgment is up to a minute
    of waiting on every command, a disturbance of its own.
  - **Catching pushes by reading scripts for `push`.** That reads words, not
    what happens. The guard sees the refs git actually sends.
- **Trade-off:** inside the sandbox a lead may run anything the sandbox
  lets it: install into its worktree, start servers on localhost, reach the
  hosts it was given. A Mac's sandbox reaches the keychain's service, so a
  credential helper told to run inside it could read what that helper
  stored. Althar refuses that where it reads the words, but a script could
  hide it, as it could before. The guard holds against a mistake, not an
  agent set on getting past it: one that changes its environment or git's
  config gets past it. With everything allowed, a script that asks to run
  outside the sandbox is read as before.
- **Checked:** on this Mac on 2026-10-29 (`tests/agents/boundary.test.ts`),
  a Claude Code lead with everything allowed ran a python heredoc that
  edited its worktree, `cp $TMPDIR/…` and a `for` loop with `$((…))`, with
  no card. Its `git push origin HEAD:main`, plain and from a Python script,
  was stopped by the guard, and a script's write to the person's checkout
  and a read of `~/.ssh` failed at the sandbox. The coordinator ran a `for`
  loop of git reads, `$((n+8))` and `f=$(…)`, each allowed as inside its
  sandbox. Its python heredoc writing outside its folder, and `touch` in
  the person's checkout, failed there, and it posted one reply. `ps` showed
  each command under `sandbox-exec`.
- **Revisit when:** an agent loses work through what its sandbox held, or
  through a push the guard let by; Althar can tell before a session starts
  that a sandbox will start on Windows; Codex's or OpenCode's sandbox can be
  held as Claude Code's.
