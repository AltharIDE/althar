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

Every session of it gets the same brief, whether it starts as the project
opens, after a relaunch, on another agent or in a handover (below): its role,
the project, the notes, what the repositories tell agents, every open task,
the ten finished last, its errands, and the conversation, the last of it word
for word and the earlier part in short. Only how much is word for word
differs. The brief is written while the agent starts, so the person's first
words wait for neither twice.

**What the repositories tell agents goes in the brief.** The coordinator's
agent loads no settings file from a repository, so no hook or permission of
the repository's reaches it, and its `AGENTS.md` and `CLAUDE.md` didn't
either. Althar reads them from the coordinator's copies instead: regular
files inside the copy only, never a link, with an import on a line of its
own put in place once, each cut at 10,000 characters and all at 20,000. They
say how the code is laid out and how the team works; the coordinator still
changes no code, and its role, the notes and the person's word come first.

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

## Compaction and session recovery

The coordinator keeps the same conversation and session as its context fills.
If the agent compacts on its own, Althar carries on with the agent's summary.
At 80% of the window, Althar sends the agent's own Compact command while the
coordinator is idle, including when a late usage update reports that it is
full. The command runs by itself between turns, and queued messages follow
in order. A failed automatic request leaves the session available for the
next turn.

After compaction the next ordinary turn gets the coordinator's role and
current Althar records alongside the agent's summary. The records include the
project overview, notes, repository instructions, open and recently finished
tasks, and open errands. The full thread remains available through
`read_thread` and in the window.

If the agent has lost its session, Althar starts it afresh on the same account,
model and effort. The replacement receives its role, the project records, the
last twelve messages within a 16,000-character budget, and a bounded excerpt
of the earlier conversation. What is queued goes with the first turn. Althar
says in the thread when it starts a session afresh. Plans, drafts and running
tasks are stored independently of the session.

See [Agents](agents.md#keeping-context-small) for the lead's threshold and the
person's Compact command.

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
- **Done is for a task that isn't a change.** A change is done when its
  pull request merges ([tasks.md](tasks.md#needs-you-and-settling)). **Keep
  for later is for any task** with no pull request of its own open: a
  prototype or a chat that ends on its branch keeps as a quick task does.

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
- 18 Nov 2026: every session of the coordinator starts from the same brief, not only a handover's: it gained what the repositories tell agents (their `AGENTS.md` and `CLAUDE.md`), the tasks finished last and the earlier conversation in short, and is written while the agent starts.
