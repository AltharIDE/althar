# @althar/provider-adapters

How Althar talks to coding agents: one adapter over the [Agent Client Protocol](https://agentclientprotocol.com), the registry of agents it runs (Claude Code, Codex and OpenCode), and a scripted fake agent that lets the adapter's contract run in CI. Written with [Effect](https://effect.website).

## Use it

```ts
import { agents, connect, signInStatus } from '@althar/provider-adapters'

const program = Effect.scoped(
  Effect.gen(function* () {
    const agent = agents.codex
    if ((yield* signInStatus(agent)) === 'signed_out') return yield* Effect.fail(`Run: ${agent.signIn.login}`)
    const connection = yield* connect({
      transport: { _tag: 'Process', spec: agent.launch(process.execPath), cwd: worktree },
      onPermission: (request) => Effect.succeed(rules.allows(request) ? { decision: 'allow' } : { decision: 'reject', reason: 'kept for review' }),
      permissions: agent.permissions,
    })
    const session = yield* connection.newSession({
      cwd: worktree,
      mode: agent.modes.ask,
      modeOptionId: agent.options.mode,
      ...(agent.sessionMeta === undefined ? {} : { meta: agent.sessionMeta() }),
    })
    yield* session.setOption(agent.options.model, 'gpt-5.6-luna')
    yield* Stream.runForEach(session.prompt('Fix the failing test'), (event) => Effect.log(event._tag))
  }),
)
```

- **The agent runs as a process Althar owns,** in its own process group, with only an allowlist of Althar's environment. Closing the scope stops it and everything it started, even what outlived the agent, and says how that went.
- **Every session starts in the mode it is given,** such as the agent's asking mode or its read-only mode, never the one the agent defaults to. Closing its scope closes it with the agent.
- **A session runs one turn at a time.** A turn is a stream of normalized events in the order they arrived, ending with `TurnEnded`. A prompt during a turn fails with `TurnInProgress`; `interrupt` cancels the turn and waits for it to end. What the agent says between turns arrives on `events`.
- **Permission requests go to `onPermission`.** The adapter sends the narrowest option that carries the decision out, never an "always" option, and resumes a turn that a rejection stopped. Cancelling a turn answers its waiting requests.
- **Failures are classified:** usage limit (with its reset time), full context, missing sign-in, bad request, or transient. Claude reports them in structured form. An agent that has gone fails with `AgentExited`. An update this version doesn't know arrives as `Other`, never as an error.

## Work on it

From `packages/provider-adapters`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The contract and unit tests, against the fake agent |
| `bun run test:coverage` | The same, with the coverage gate: 90% of lines and branches |
| `bun run test:agents` | The contract against the real agents, as installed and signed in here. Costs a little usage; pick agents with `ALTHAR_AGENTS=codex,opencode` |
| `bun run probe` | Prints what each real agent reports: capabilities, sign-in methods, modes, config options. Sends no prompt |
| `bun run verify` | Check and coverage, as CI runs them |

The process tests run the fake agent with Bun.

The judge's real-provider check is `ALTHAR_AGENTS=claude-code bun run test:agents tests/agents/permissionJudge.test.ts`. It needs Claude sign-in and sends two short prompts: an ordinary judgment, then an injected request to read a synthetic fixture outside the working directory. It checks that no tool runs and the fixture never appears in the answer. Codex and OpenCode judgments remain disabled until a configuration that removes their tools is verified.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the rules this package follows.
