import { MessageChannel } from 'node:worker_threads'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Schema, Stream } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'

import { Api, ApiError, CommandId, PAGE, Product, ThreadItem, WatchEvent } from '../src/Api'
import { clientProtocol, emitterPort, serverProtocol } from '../src/transport'

const at = '2026-09-29T12:00:00.000Z'
const commandId = `cmd_${'a'.repeat(32)}`

describe('the API', () => {
  it('knows each kind of thread item by its content, and nothing else', () => {
    const decode = Schema.decodeUnknownSync(ThreadItem)
    const base = { id: 'i1', sequence: 1, agentId: 'codex', createdAt: at }
    assert.strictEqual(
      decode({ ...base, kind: 'user_message', content: { text: 'Hi', links: [] }, input: { state: 'queued', interrupting: false } }).kind,
      'user_message',
    )
    assert.strictEqual(decode({ ...base, kind: 'agent_thought', content: { text: 'Hmm' } }).kind, 'agent_thought')
    const tool = decode({
      ...base,
      kind: 'tool_call',
      content: {
        title: 'Edit a.ts',
        toolKind: 'edit',
        status: 'completed',
        command: null,
        locations: [{ path: '/w/a.ts', line: 3 }],
        declined: false,
      },
    })
    assert.deepStrictEqual(tool.kind === 'tool_call' && tool.content.locations, [{ path: '/w/a.ts', line: 3 }])
    assert.strictEqual(decode({ ...base, kind: 'plan', content: { entries: [{ content: 'Test it', status: 'pending' }] } }).kind, 'plan')
    assert.strictEqual(
      decode({ ...base, kind: 'notice', content: { source: 'runtime', severity: 'info', title: 'Codex takes over.', description: null } })
        .kind,
      'notice',
    )
    // A tool call's content is its own; a message's text is no tool call.
    assert.throws(() => decode({ ...base, kind: 'tool_call', content: { text: 'Hi' } }))
    assert.throws(() => decode({ ...base, kind: 'step_result', content: {} }))
    const review = decode({
      ...base,
      kind: 'step_result',
      content: {
        step: 'review',
        round: 0,
        summary: 'One thing to fix.',
        verdict: 'changes_requested',
        findings: [{ severity: 'major', file: 'src/a.ts', line: 3, claim: 'The retry never stops.' }],
        agentId: 'codex',
        change: null,
      },
    })
    assert.strictEqual(review.kind === 'step_result' && review.content.findings.length, 1)
    // Something heard from outside: a comment on the task's pull request, with where it is.
    const heard = decode({
      ...base,
      kind: 'arrival',
      content: {
        source: 'github',
        kind: 'comment',
        from: 'dana',
        where: 'PR #12',
        text: 'Seconds or a date?',
        verdict: null,
        path: 'src/limit.ts',
        line: 14,
        passed: null,
        failed: null,
        failing: [],
        url: null,
        outsider: false,
      },
    })
    assert.strictEqual(heard.kind === 'arrival' && heard.content.from, 'dana')
    // A pasted link, unfurled on the message that has it.
    const linked = decode({
      ...base,
      kind: 'user_message',
      content: {
        text: 'Do https://linear.app/m/issue/MER-231/x',
        links: [
          {
            kind: 'issue',
            product: 'linear',
            key: 'MER-231',
            title: 'Rate-limit refunds',
            url: 'https://linear.app/m/issue/MER-231/x',
            status: { name: 'Todo', category: 'todo' },
            priority: null,
            container: 'Meridian',
          },
        ],
      },
      input: null,
    })
    assert.strictEqual(linked.kind === 'user_message' && linked.content.links[0]?.key, 'MER-231')
    // A task in the coordinator's thread: its plan, then its card.
    const task = decode({
      ...base,
      kind: 'task',
      content: {
        taskId: 't1',
        threadId: 'th1',
        title: 'Add a retry',
        slug: 'add-a-retry',
        phase: 'planned',
        plan: {
          id: 'plan_1',
          steps: [
            { key: 'implement', agentId: 'claude-code', model: 'opus', skipped: false },
            { key: 'review', agentId: 'codex', model: null, skipped: false },
          ],
          startsAt: at,
          reason: 'A small change in code Claude Code knows.',
          end: 'draft',
        },
        issue: { product: 'linear', key: 'MER-231', title: 'Rate-limit refunds', url: 'https://linear.app/m/issue/MER-231/x' },
        change: null,
        step: null,
        summary: null,
        lead: null,
        branch: null,
        startedAt: null,
        waits: null,
      },
    })
    assert.strictEqual(task.kind === 'task' && task.content.plan?.steps.length, 2)
    assert.throws(() => decode({ ...base, kind: 'task', content: { taskId: 't1' } }))
  })

  it('takes a command id only in its own shape, and a change with its cursor', () => {
    assert.strictEqual(Schema.decodeUnknownSync(CommandId)(commandId), commandId)
    assert.throws(() => Schema.decodeUnknownSync(CommandId)('cmd_nope'))
    assert.throws(() =>
      Schema.decodeUnknownSync(WatchEvent)({ _tag: 'Changed', aggregateType: 'task', aggregateId: 't', projectId: null, threadId: null }),
    )
    assert.strictEqual(PAGE, 100)
  })

  it.live('runs over a port, checking what is sent on the way', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const channel = new MessageChannel()
        yield* Effect.addFinalizer(() => Effect.sync(() => channel.port1.close()))
        const handlers = Api.toLayer(
          Effect.succeed(
            Api.of({
              Status: ({ recheck }) => Effect.succeed({ apiVersion: 1, appVersion: recheck === true ? 'rechecked' : 'cached', agents: [] }),
              ListProjects: () => Effect.succeed({ cursor: 0, projects: [] }),
              OpenProject: ({ grant }) => Effect.fail(new ApiError({ reason: 'NotFound', message: `No folder was chosen as ${grant}.` })),
              ListTasks: () => Effect.succeed({ cursor: 0, tasks: [] }),
              CreateTask: () => Effect.die('unused'),
              GetThread: () => Effect.die('unused'),
              GetFileDiff: () => Effect.die('unused'),
              GetBoard: () => Effect.die('unused'),
              Merge: () => Effect.die('unused'),
              SetEffort: () => Effect.die('unused'),
              GetModels: () => Effect.die('unused'),
              SetDefaultEffort: () => Effect.die('unused'),
              GetThreadItem: () => Effect.die('unused'),
              GetCoordinator: () => Effect.die('unused'),
              StartTask: () => Effect.die('unused'),
              StartPlan: () => Effect.void,
              HoldPlan: () => Effect.void,
              ChangePlan: () => Effect.void,
              AnswerStuck: () => Effect.void,
              StartSession: ({ commandId: id }) => Effect.succeed(id),
              SwitchAgent: () => Effect.die('unused'),
              SetModel: () => Effect.void,
              Interrupt: () => Effect.void,
              StopSession: () => Effect.void,
              Send: () => Effect.void,
              Answer: () => Effect.void,
              ListConnections: () => Effect.succeed({ cursor: 0, connections: [], products: [] }),
              StartSignIn: ({ commandId: id }) =>
                Effect.succeed({ flowId: id, kind: 'browser' as const, url: 'https://linear.app/oauth/authorize' }),
              GetSignIn: () => Effect.succeed({ state: 'waiting' as const }),
              CancelSignIn: () => Effect.void,
              ConnectToken: ({ product, token }) =>
                Effect.succeed({
                  id: 'conn_1',
                  product,
                  name: 'GitHub',
                  webUrl: 'https://github.com',
                  account: { login: token === 't' ? 'you' : 'someone', name: null },
                  auth: 'token' as const,
                  state: 'ready' as const,
                }),
              Disconnect: () => Effect.void,
              ListIssues: () => Effect.succeed({ issues: [] }),
              MarkReady: () => Effect.void,
              SetUsageLimit: () => Effect.void,
              RenameAccount: () => Effect.void,
              RemoveAccount: () => Effect.void,
              OrderAccounts: () => Effect.void,
              AddAccount: () => Effect.die('unused'),
              FindAccounts: () => Effect.succeed({ found: [] }),
              SignInAccount: () => Effect.succeed({ line: 'codex login', opened: false }),
              OpenChange: () => Effect.void,
              RefreshTask: () => Effect.void,
              Watch: ({ since }) =>
                Stream.make({
                  _tag: 'Changed' as const,
                  cursor: (since ?? 0) + 1,
                  aggregateType: 'task',
                  aggregateId: 't1',
                  projectId: 'p1',
                  threadId: 'th1',
                }),
            }),
          ),
        )
        yield* Effect.forkScoped(
          Layer.launch(
            RpcServer.layer(Api).pipe(Layer.provide(handlers), Layer.provide(serverProtocol(emitterPort(channel.port1, (data) => data)))),
          ),
        )
        const protocol = yield* Layer.build(clientProtocol(emitterPort(channel.port2, (data) => data)))
        const client = yield* RpcClient.make(Api).pipe(Effect.provideContext(protocol))

        assert.strictEqual((yield* client.Status({ recheck: true })).appVersion, 'rechecked')
        assert.strictEqual(yield* client.StartSession({ commandId, threadId: 'th1', agentId: 'codex' }), commandId)
        assert.strictEqual((yield* client.ConnectToken({ commandId, product: 'github', token: 't' })).account.login, 'you')
        assert.strictEqual((yield* client.StartSignIn({ commandId, product: 'linear' })).kind, 'browser')
        // A product Charrette doesn't know isn't one.
        assert.throws(() => Schema.decodeUnknownSync(Product)('gitea'))
        const refused = yield* Effect.flip(client.OpenProject({ commandId, grant: 'g1' }))
        assert.strictEqual(refused.message, 'No folder was chosen as g1.')
        assert.deepStrictEqual(
          (yield* Stream.runCollect(client.Watch({ since: 41 }))).map((event) => event._tag === 'Changed' && event.cursor),
          [42],
        )
        // A command without its id doesn't leave the client.
        const bad = yield* Effect.exit(client.Send({ commandId: 'cmd_nope', threadId: 'th1', body: 'Hi', disposition: 'after_current' }))
        assert.strictEqual(bad._tag, 'Failure')
      }),
    ),
  )
})
