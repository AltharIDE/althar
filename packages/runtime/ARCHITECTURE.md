# @charrette/runtime — Architecture

The runtime of [docs/architecture/02](../../docs/architecture/02-desktop-runtime.md): the composition root that owns the store, agent sessions and their processes. The repository's [ARCHITECTURE.md](../../ARCHITECTURE.md) sets the general engineering target.

- **Owner:** Repository maintainers
- **Consumers:** the command-line client (`apps/cli`) now; the desktop app's utility process next.
- **Dependency direction:** depends on `@charrette/domain`, `@charrette/persistence-sqlite`, `@charrette/provider-adapters` and `effect`. It imports nothing from Electron.

## What it holds

| Module | What it does |
| --- | --- |
| `Runtime.ts` | Composes the store, this launch and the services; `envelope` makes a person's command |
| `Instance.ts` | Records this launch, finds or creates the device and its actors, and reconciles before anything starts |
| `reconcile.ts` | Settles what an earlier launch left: stops its processes if they are provably its own, and marks sessions, turns and requests |
| `Projects.ts` | Opens folders as projects; creates tasks, their threads and their worktrees |
| `Sessions.ts` | Starts, supervises and stops agent sessions; delivers the thread's input as turns and records them |
| `Permissions.ts` | Records permission requests and decisions; asks the person what the rules keep for them |
| `rules.ts` | The MVP's rules: everything allowed except the always-ask list |
| `threads.ts` | Turns agent events into thread items; writes the thread as text for a brief |
| `Live.ts` | What is happening now, for clients that watch |
| `git.ts` | The git commands the runtime runs itself |

## Principles

- **Accepted, then acted on.** Input is committed to the thread's queue, with its user message, before anything is sent; a turn is recorded as delivered before its prompt goes out. After a crash, a delivered turn may have acted, so it is marked uncertain, never repeated.
- **No I/O inside a transaction.** Git and agents run between transactions. A task's worktree is added after the task is committed, and its workspace marked ready or failed after git finishes.
- **Every change of state is recorded with its revision.** Rows move on with `change`, which bumps the revision; facts go to the record with `fact`. Session states move only along the lifecycle in `@charrette/domain`.
- **Thread items are what the person reads.** An agent's message is one item, placed when its first chunk arrives and written when something else happens; a tool call is one item, updated as it runs. Updates reach clients through the change feed without adding facts to the record.
- **Permission decisions are recorded before they are sent,** with the option the adapter will send. A failed decision is a rejection. A question to the person is withdrawn when the turn is cancelled or the agent goes.
- **Processes are owned.** A process is recorded as launching before it is spawned, then with its pid, OS start time and environment digest. Stopping a session ends its turn first, then its process group, and records both. Reconciliation stops an earlier launch's process only when the pid and its OS start time both match the record.
- **One runtime per profile.** The store holds the database in exclusive locking mode, so a second runtime on the same profile fails to open it (`DatabaseInUse`) instead of reconciling live sessions away.
- **Services capture what they need.** Each service's methods return effects with no requirements, so the adapter can call `Permissions.decide` from its own fibers.

## Checks

- `bun run check`: format, type-aware lint and type checks.
- `bun run test:coverage`: the runtime against in-memory and temporary databases, temporary git repositories and the scripted fake agent, in process and as a process; gated at 90% of lines and branches.

## Gaps

- **No workflow graph yet.** Sessions run on a task's thread directly, not as node attempts of a run; controller generations are always 1 and not yet fenced.
- **Starting a session is not a command** with a receipt; it is an operation the client calls.
- **Rules see commands and file paths only.** A shell command that writes outside the worktree is not detected unless it matches the always-ask list.
- **Briefs are text in the first prompt,** not artifacts, and there are no Charrette MCP tools yet for the part that doesn't fit.
- **Sessions are not loaded after a restart;** a lost session stays lost, and the person starts a new one.
- **Raw protocol capture** is not written to its bounded file yet.
- **Questions the agent asks** (ACP elicitation) are cancelled; they don't become attention requests yet.
