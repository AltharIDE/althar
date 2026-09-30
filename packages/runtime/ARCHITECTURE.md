# @charrette/runtime — Architecture

The runtime of [docs/architecture/02](../../docs/architecture/02-desktop-runtime.md): the composition root that owns the store, agent sessions and their processes. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the desktop app's utility process (`apps/desktop`), over the API; the command-line client (`apps/cli`), in its own process.
- **Dependency direction:** depends on `@charrette/contracts`, `@charrette/domain`, `@charrette/persistence-sqlite`, `@charrette/provider-adapters` and `effect`. It imports nothing from Electron.

## What it holds

| Module | What it does |
| --- | --- |
| `Runtime.ts` | Composes the store, this launch and the services; `envelope` makes a person's command |
| `Instance.ts` | Records this launch, finds or creates the device and its actors, and reconciles before anything starts |
| `reconcile.ts` | Settles what an earlier launch left: stops its processes if they are provably its own, and marks sessions, turns and requests |
| `Projects.ts` | Opens folders as projects; creates tasks, their threads and their worktrees |
| `Sessions.ts` | Starts, supervises and stops agent sessions; delivers the thread's input as turns and records them |
| `Permissions.ts` | Records permission requests and decisions; asks the person what the rules keep for them |
| `rules.ts` | The MVP's rules: everything allowed except the always-ask list. Commands are read as a shell would split them |
| `threads.ts` | Turns agent events into thread items; writes the thread as text for a brief |
| `Live.ts` | What is happening now, for clients that watch, with each message's text as far as it has come |
| `Queries.ts` | What a client's screens show, read from the store: projects, tasks, and a task's thread with its live session and the calls waiting |
| `Api.ts` | The API of `@charrette/contracts`, served over a port: handlers, and the change feed and streaming text as one `Watch` stream |
| `Folders.ts` | Folders the person chose, by grant: the app's main process allows them, and the window opens them by grant |
| `words.ts` | What went wrong, in the words the window shows |
| `git.ts` | The git commands the runtime runs itself |

## Principles

- **Accepted, then acted on.** Input is committed to the thread's queue, with its user message, before anything is sent; a turn is recorded as delivered, with the prompt it sends, before the prompt goes out. After a crash, a delivered turn may have acted, so it is marked uncertain, never repeated. A prompt the agent refuses puts its input back in the queue.
- **Every session starts from a brief** (ADR-005), the first on a task too: the task, its worktree and base, the plan, what changed since the start and what isn't committed, and the thread so far. A switch starts the new agent first and stops the old one only once the new one is ready, so a switch that fails leaves the old agent working; the brief is written after the old one stops. Start, switch and stop on one thread run one at a time, and the store keeps one live session per thread.
- **No I/O inside a transaction.** Git and agents run between transactions. A task's worktree is added after the task is committed, and its workspace marked ready or failed after git finishes.
- **The runtime's own git** runs with the repository's hooks off, fetches before a task starts so it starts from the default branch as origin has it, picks a free branch and folder when the planned ones exist, and records remote URLs without the credentials they may carry. The default branch is origin's, or the usual name, never whatever the person has checked out.
- **Every change of state is recorded with its revision.** Rows move on with `change`, which bumps the revision; facts go to the record with `fact`. Session states move only along the lifecycle in `@charrette/domain`.
- **Thread items are what the person reads.** An agent's message is one item, placed when its first chunk arrives and written every couple of seconds or kilobytes as it grows; a tool call is one item, updated as it runs. Updates reach clients through the change feed without adding facts to the record. A failure to record one event doesn't stop the runtime reading the rest of the turn.
- **Permission decisions are recorded before they are sent,** with the option the adapter will send. A failed decision is a rejection. A question to the person is withdrawn when the turn is cancelled or the agent goes.
- **Processes are owned.** A process is recorded as launching before it is spawned, then with its pid, OS start time and environment digest. Stopping a session ends its turn first, then its process group, and records both. Reconciliation stops an earlier launch's process group when its leader is the process recorded (pid and OS start time both match), or when the leader has gone but the group lives on, since a pid isn't reused while its group exists; what an agent left running, such as a dev server, stops with it. A worktree a crash interrupted is marked ready or failed.
- **One runtime per profile.** The store holds the database in exclusive locking mode, so a second runtime on the same profile fails to open it (`DatabaseInUse`) instead of reconciling live sessions away.
- **Clients read, then watch.** A query returns a projection shaped for a screen, with the change-feed cursor it read at, taken before its rows. `Watch` says which record changed after a cursor (from the change feed, read every 150 ms), with the thread it belongs to, and what an agent is still saying, at most every 80 ms; a client reads again what shows it.
- **A client's command ids are the commands' ids.** Commands with receipts in the store (opening a project, creating a task, sending, answering) answer a retry from the receipt, even after the thing they did has moved on. Session commands, which start and stop processes outside any transaction, are answered from memory for the launch.
- **Errors reach a client in words.** A failure goes out as `ApiError`, with the runtime's error tag as its reason and a sentence from `words.ts`; anything the person can't put right also goes to the log with its whole cause.
- **Sign-in is checked at most once a minute,** unless a client asks again: each check starts the agent's own status command.
- **The thread says when an agent goes.** One that exits on its own, one that can't start, and one a restart stopped each leave a line in the thread saying so.
- **Services capture what they need.** Each service's methods return effects with no requirements, so the adapter can call `Permissions.decide` from its own fibers.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the runtime against in-memory and temporary databases, temporary git repositories and the scripted fake agent, in process and as a process; gated at 90% of lines and branches.

## Gaps

- **No workflow graph yet.** Sessions run on a task's thread directly, not as node attempts of a run; controller generations are always 1 and not yet fenced.
- **Session commands have no receipts in the store.** A retry within a launch gets the first one's result; across a restart, the session is gone anyway.
- **Rules read commands, not what they do.** A script that writes outside the worktree isn't caught by the rules; the agents' sandboxes are the boundary (Codex's and Claude's). OpenCode has no sandbox yet.
- **Briefs are text in the first prompt,** not artifacts, and there are no Charrette MCP tools yet for the part that doesn't fit.
- **Sessions are not loaded after a restart;** a lost session stays lost, and the person starts a new one.
- **Raw protocol capture** is not written to its bounded file yet.
- **Questions the agent asks** (ACP elicitation) are cancelled; they don't become attention requests yet.
