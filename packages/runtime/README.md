# @charrette/runtime

Charrette's runtime: the one writer of the local store. It opens folders as projects, gives each task a worktree of its own, starts agent sessions on a task's thread, and delivers the thread's input to them one turn at a time. Everything that happens is recorded: the thread's items, every turn and how it ended, every permission request and its decision, every agent process and how it stopped. Written with [Effect](https://effect.website).

It runs under plain Node: in Electron's utility process in the app, and inside the command-line client (`apps/cli`) until the app exists.

## Use it

```ts
import { Live, Projects, Runtime, Sessions } from '@charrette/runtime'

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

- **`Projects`** opens a folder in a git repository as a project, or finds the one it already is, and creates tasks. A task gets its thread and a worktree at `<worktreeRoot>/<project>/<task>/<repository>`, on the branch `charrette/<task>` (ADR-006).
- **`Sessions`** starts an agent on a task's thread, in the task's worktree and in the mode that asks. It accepts input into the thread's queue, delivers it a turn at a time (an `interrupt_and_continue` input stops the turn and goes first), changes the model, hands the thread to another agent with a brief (ADR-005), and stops sessions.
- **`Permissions`** answers every permission request from the rules. What the always-ask list keeps for the person becomes an attention request, answered with `answer`.
- **`Live`** streams what is happening now: agent events, turns, sessions, and questions for the person.

Commands from a person carry a `CommandEnvelope` (`Runtime.envelope` makes one), so a retry is answered from its receipt instead of running again.

## Work on it

From `packages/runtime`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests, against in-memory databases, temporary git repositories and the fake agent |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |

The process tests run the fake agent with Bun. To try the runtime with real agents, use the command-line client in `apps/cli`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
