# The coordinator

What the coordinator is, what it may do, where it reads the code, how its
conversation survives a full context, and how it moves tasks and clears its
chat. How it is built is in [04](../architecture/04-coordinator.md).

**Replaces:** ADR-004,
ADR-031,
ADR-058,
ADR-086,
ADR-101

## Always on

Every project has one coordinator. It talks with the person about the
project, plans work, starts tasks, directs their leads and keeps track of
where everything stands. It is always on. No switch, setting or mode turns
it off, in any project. Its session starts when the person talks to it, or
when news it acts on wakes it.

Tasks don't have to go through it. The person can start one from the board
or the composer, and a lead can start one too. That makes the coordinator
something tasks don't wait on. It doesn't make it optional.

Merging two tasks into one isn't something it does, for now.

## An agent session that Althar briefs

The coordinator is an ordinary agent session over ACP, on any agent the
person has, and it switches agents the way a lead does: the new agent takes
over the whole thread. It runs on the person's plan, so its model matters for
cost.

Althar keeps the thread. The agent's session can be thrown away, because it
is rebuilt from a brief that Althar writes from its own records
([agents.md](agents.md)). The conversation the person scrolls is Althar's
record, not the session's.

## One pool of tools, shared with leads

The coordinator and every lead share one pool of tools: Althar's MCP server,
the person's own MCP servers, and the person's skills
([the-persons-setup.md](the-persons-setup.md)). Leads can start tasks, and
the coordinator can read and move tasks the way a lead can. The only things
kept apart are a lead's own task and worktree, and the coordinator's edit
tools, which stay denied (see below).

Its tools do what the person can do in the window: read the project and its
tasks, draft and plan tasks, start them, order them, message leads, move
tasks, and act on the code host as the person's account can
([code-hosts.md](code-hosts.md)). Each tool goes through the same service as
the button it stands for, so it is validated, recorded and idempotent, and it
never goes beyond the person's own authority.

## It directs leads and changes no code

The coordinator directs leads. It can message any lead, read any task's
thread and diff, and stop, restart or settle a task. It can do anything the
person can do in the UI.

It doesn't change code. A change is always a task, with a lead, a branch, a
review and a record, and a change made in the coordinator's throwaway copy
would have none of those. That rule is for tidiness, not for safety. So its
edit tools stay denied, and what it finds that needs a change becomes a task.

## Its copies of the repositories

The coordinator reads code in copies of its own, never in the person's
checkout or a task's folder.

- **One copy for each of the project's repositories**, in a folder Althar
  owns, detached at the default branch. Each copy is a repository of its
  own, and Althar makes its git folder again for every turn. The copy
  borrows the person's repository's objects to read, and its only remote is
  a bare mirror of the person's refs, which Althar keeps beside the folder
  and only Althar writes, with the index the copy was last checked out
  with, so checking it out again compares rather than rewrites every file.
- **As each turn ends, Althar fetches the project's remote** into the
  person's repository, mirrors those refs and makes the copies fresh, while
  the person reads and writes, so the next turn goes out at once. A turn
  that comes before that is done waits for it; one with copies older than
  15 minutes, or that a turn may have written in since, has them made fresh
  first. So the coordinator's own `git fetch` brings the remote as of its
  last turn, and its `git fetch`, `git tag` and anything else it writes stay
  in the copy, which is thrown away. Althar's own git never reads what it
  leaves there: links left in a copy's place are removed, never followed.
  Making them before each turn cost 4 to 7 seconds in a large repository,
  before the model saw the person's words (12 Nov 2026).
- A project with no repositories gets an empty folder.

**Its commands go by the project's rules,** the person's Never and Ask
included, as a lead's do, and a visible irreversible one asks the person.
It reads ordinary files anywhere; secret files and the keychain stay
refused.

- **Where Claude Code's sandbox starts** (macOS, and Linux outside a
  Flatpak), its commands run in it, writing only to its folder and temporary
  files, with the network open and localhost bindable; of the Unix sockets
  only the SSH agent's is let through. It loads the skills the person picked,
  but no settings file or hook from the repository. macOS's sandbox refuses
  the pipes `<(…)` opens, so any command may ask to run outside it, and the
  same rules decide: a read runs, a visible write outside its folder is
  refused.
- **Codex** runs in its ordinary workspace sandbox.
- **Where no sandbox holds it** (OpenCode, and Windows), a command runs
  unless it visibly writes outside its folder. Scripts, variables, loops and
  process substitutions aren't refused for being unreadable.

A refusal is explained in the same turn, with the command and its reason,
never held for the next message. It may install and run tests in its
copies; a change to code is still a task.

## Handover before its context fills

The coordinator's conversation is one long thread. Agents compact their own
context at a moment of their choosing, into a summary of their own, and a
decision the person made only in conversation may not survive that. So
Althar hands the coordinator over itself.

- **At 80% of its context** (`HANDOVER_AT`), between turns, never in one,
  Althar starts a fresh session on the same agent, account, model and effort,
  and stops the old one. What the person says in the meantime waits for the
  fresh session.
- **The fresh session is briefed from Althar's records,** not the raw
  thread:
  - its role and tools;
  - a line saying it took over;
  - the project overview and the project's notes;
  - every open task, with where it stands, who leads it and what waits on
    the person, and the newest 25 tasks with their plan and their lead's
    last report;
  - the last twelve messages, word for word.

  It reads anything earlier with `read_thread`, a part at a time.
- **The person sees one quiet line** in the thread, and the whole
  conversation stays theirs to scroll.
- **Nothing Althar owns moves.** Plans counting down, held plans, drafts and
  running tasks belong to Althar, not to the session, and carry on.
- **A handover that fails leaves the old session going,** compacting by
  itself, and Althar doesn't try again for that session. Neither does it hand
  over where the brief would take 40% or more of a fresh context.

A task's lead is handed over the same way, once its context is full ([agents.md](agents.md)).

## The project's notes

A project keeps notes: decisions the person made in conversation that the
code doesn't show. Each is a sentence or two on one line, of at most 300
characters, and a project keeps at most 40.

The coordinator keeps, lists and drops notes with its tools, and its brief
tells it to keep one whenever the person decides something like that. Every
brief it gets carries them, and so does the project overview. The person
sees them in the project's settings, rewords one, or drops one that no longer
holds.

Notes are current decisions. Where an older document disagrees with one, the
note wins.

## Moving a task

The coordinator and leads move tasks with the same tools, each the person's
own button:

- `stop_task`: Stop, or, given a turn, only Interrupt;
- `hold_task`: Hold, on a plan that is counting down;
- `restart_task`: Start for a held plan, Resume for a stopped task, Reopen
  for a discarded one;
- `settle_task`: Done, Keep for later, or Discard.

Each acts at once, in any turn, because each can be undone. Each says so in
a line in two threads, the coordinator's and the task's, with why or with the
person's words. A move that no longer applies where the task stands does
nothing and says so, as a second press would.

- **Discarding deletes nothing.** It abandons the task: the task's plan is
  declined, its calls are withdrawn and its agents stop, while its worktree
  and branch stay. The folder goes only as workspace clean-up allows
  ([workspaces-and-runs.md](workspaces-and-runs.md)).
- **Done and Keep for later are for a task that isn't a change.** A change
  is done when its pull request merges ([tasks.md](tasks.md#needs-you-and-settling)).

**Automations are the exception.** Resuming one or running one now spends
the person's plan while they may be away. So it acts at once only in a turn
the person's own message started, and otherwise asks on a small card they
press. That card is one of the asks kept on purpose
([what-agents-may-do.md](what-agents-may-do.md)).

## Clearing its chat

The coordinator's thread only grows, so the person can clear it, in two
ways of different weight. Both are under one question, "Clear chat", and
neither is a button's default: the kind is chosen first, then done with its
own button. Enter and Escape never forget.

- **Clear only the view.** The thread starts from here. The session and its
  context are untouched (Compact frees context). The thread shows
  "Cleared · Show earlier · Undo" at its top. The mark belongs to the
  thread, so every window and every reload agrees. Nothing is deleted:
  `read_thread`, a handover's brief and the agent's own memory still reach
  everything before the mark. It is asked from a "Coordinator" bar above the
  thread, and with `/clear` in the composer, which isn't sent to the
  coordinator.
- **Forget the conversation too.** This is red, and says it can't be
  undone. The session ends, and every item of the thread is deleted except
  those still open, so nothing can reach them afterwards. A "Fresh session"
  line follows, and the next message starts a session briefed from the
  notes, errands and tasks. It is asked from "Clear chat…" in the context
  ring's foot, beside Compact.

Both keep:

- open tasks, with their errands and plans;
- drafts and issue changes waiting to be filed or applied;
- questions and asks waiting for an answer;
- the notes and the board.

After either, the coordinator says nothing on its own. Its first word answers
the person's next message.

## Permission requests

The coordinator answers no permission request by default. A project can
pick "The coordinator decides" as its rules' mode, and then the coordinator
judges asks in fresh read-only sessions. It is never the default, and it
isn't being extended to more agents ([what-agents-may-do.md](what-agents-may-do.md)).

## Changes

- 8 Nov 2026: written from the ADRs under Replaces.
- 8 Nov 2026: the limits sweep (#696) built: the coordinator's commands go by the project's rules, reach the network and read ordinary files anywhere.
