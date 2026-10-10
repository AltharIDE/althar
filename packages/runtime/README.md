# @althar/runtime

Althar's runtime: the one writer of the local store. It opens folders as projects, gives each task a worktree of its own, starts agent sessions on a task's thread, and delivers the thread's input to them one turn at a time. Each project has a coordinator that plans tasks, and a task's plan runs as Implement, then Review. Everything that happens is recorded: the thread's items, every turn and how it ended, every permission request and its decision, every agent process and how it stopped. Written with [Effect](https://effect.website).

It runs under plain Node: in Electron's utility process in the desktop app (`apps/desktop`), and inside the command-line client (`apps/cli`).

## Use it

```ts
import { Live, Projects, Runtime, Sessions } from '@althar/runtime'

const program = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: '/Users/ada/work/meridian' })
  const task = yield* projects.createTask({ envelope: yield* Runtime.envelope('task.create', {}), projectId: project.projectId, title: 'Retry the checkout' })
  yield* sessions.start({ threadId: task.threadId, agentId: 'claude-code' })
  yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: task.threadId, body: 'Add a retry to the checkout call.' })
})

Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(Runtime.layer({ database, worktreeRoot, appVersion, deviceName }))))
```

- **`Projects`** opens a folder in a git repository as a project, or finds the one it already is, and creates tasks. A task gets its thread and a worktree at `<worktreeRoot>/<project>/<task>/<repository>`, on the branch `althar/<task>` (ADR-006).
- **`Sessions`** starts an agent on a task's thread, in the task's worktree and in the mode that asks. It accepts input into the thread's queue, delivers it a turn at a time (an `interrupt_and_continue` input stops the turn and goes first), changes the model, hands the thread to another agent with a brief (ADR-005), and stops sessions.
- **`Permissions`** applies project rules to every permission request, asks the coordinator in its opt-in mode, and falls back to the person when needed. Always-ask items become attention requests, answered with `answer`. `PermissionJudge` runs a fresh, bounded read-only coordinator session and records the reason and usage.
- **`Live`** streams what is happening now: agent events, turns, sessions, and questions for the person.
- **`Coordinator`** is the project's coordinator. `say` starts it, on the agent the person last used, with what they said; it answers questions and turns changes into tasks with Althar's tools.
- **`Plans`** proposes a task's plan (its steps and who does each), and holds, changes or starts it; left alone, it starts when its countdown ends.
- **`Runs`** runs a started plan: the lead implements, another agent reviews, the lead settles what the review found, and the review looks again, up to three rounds.

- **`Queries`** reads what a client's screens show: projects, tasks, and a task's thread a page at a time, each with the change-feed cursor it read at.
- **`Folders`** holds the folders the person chose, by grant, so a client opens a project without naming a path.

To serve the API of `@althar/contracts` over a port, as the desktop app does, build `services` once and launch a `connection` per port:

```ts
import { emitterPort } from '@althar/contracts'
import { connection, services } from '@althar/runtime'

const context = yield* Layer.build(services({ database, worktreeRoot, appVersion, deviceName }))
yield* Effect.forkScoped(Layer.launch(connection(emitterPort(port))).pipe(Effect.provideContext(context)))
```

Commands from a person carry a `CommandEnvelope` (`Runtime.envelope` makes one), so a retry is answered from its receipt instead of running again.

## Work on it

From `packages/runtime`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against in-memory databases, temporary git repositories and the fake agent |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |
| `bun run test:agents` | On the real agents signed in on this Mac: the coordinator loop (a small repository, one request, and the plan run until the task is ready), and a reader refused a write. It costs usage; set `ALTHAR_ASK` to ask the loop something else |

The process tests run the fake agent with Bun. To try the runtime with real agents by hand, use the command-line client in `apps/cli`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
