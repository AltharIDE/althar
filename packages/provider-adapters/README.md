# @charrette/provider-adapters

How Charrette talks to coding agents: one adapter over the [Agent Client Protocol](https://agentclientprotocol.com), the registry of agents it runs (Claude Code, Codex and OpenCode), and a scripted fake agent that lets the adapter's contract run in CI. Written with [Effect](https://effect.website).

## Use it

```ts
import { agents, connect, signInStatus } from '@charrette/provider-adapters'

const program = Effect.scoped(
  Effect.gen(function* () {
    const agent = agents.codex
    if ((yield* signInStatus(agent)) === 'signed_out') return yield* Effect.fail(`Run: ${agent.signIn.login}`)
    const connection = yield* connect({
      transport: { _tag: 'Process', spec: agent.launch(process.execPath), cwd: worktree },
      onPermission: (request) => Effect.succeed(rules.allows(request) ? 'allow' : 'reject'),
    })
    const session = yield* connection.newSession({ cwd: worktree, mode: agent.modes.ask })
    yield* session.setOption(agent.options.model, 'gpt-5.6-luna')
    yield* Stream.runForEach(session.prompt('Fix the failing test'), (event) => Effect.log(event._tag))
  }),
)
```

- **The agent runs as a process Charrette owns,** in its own process group. Closing the scope stops it and everything it started.
- **Every session starts in the mode it is given,** such as the agent's asking mode or its read-only mode, never the one the agent defaults to.
- **Permission requests go to `onPermission`,** and the answer is sent back as a one-time option only.
- **A turn is a stream of normalized events,** ending with `TurnEnded` and the tokens it used. An update this version doesn't know arrives as `Other`, never as an error.
- **Failures are classified.** A usage limit, a missing sign-in, a bad request or a network problem each fails with its own class, with the reset time when the agent gave one. An agent that has gone fails with `AgentExited`.

## Work on it

From `packages/provider-adapters`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The contract and unit tests, against the fake agent |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:agents` | The contract against the real agents, as installed and signed in here. Costs a little usage; pick agents with `CHARRETTE_AGENTS=codex,opencode` |
| `bun run probe` | Prints what each real agent reports: capabilities, sign-in methods, modes, config options. Sends no prompt |
| `bun run verify` | Check and coverage, as CI runs them |

The process tests run the fake agent with Bun.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
