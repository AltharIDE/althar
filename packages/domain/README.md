# @althar/domain

Althar's domain, as [Effect](https://effect.website) schemas: the identifiers, the vocabularies, the lifecycles and the command envelope that the runtime, the store and the app–runtime contract share. It is pure: nothing here reads files, talks to processes, or knows about SQLite or Electron.

## Use it

```ts
import { Ids, newId, now, nodeAttemptLifecycle, transition } from '@althar/domain'

const program = Effect.gen(function* () {
  const taskId = yield* newId(Ids.task) // task_0192f0b3c4d57e8f9a0b1c2d3e4f5a6b
  const at = yield* now // 2026-09-28T20:34:23.123Z, from the Effect clock
  const next = yield* transition(nodeAttemptLifecycle, 'running', 'superseded')
})
```

`newId` needs Effect's `Crypto` service, and `now` reads the Effect clock, so tests control both.

## Work on it

From `packages/domain`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests |
| `bun run test:coverage` | The tests with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
