import { MessageChannel } from 'node:worker_threads'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Schema, Stream } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'

import { Api, ApiError, CommandId, Load, NewProjectId, PAGE, Product, type SentImage, SentImages, ThreadItem, WatchEvent } from '../src/Api'
import { MESSAGE_IMAGES } from '../src/pictures'
import { clientProtocol, emitterPort, serverProtocol } from '../src/transport'

const at = '2026-09-29T12:00:00.000Z'
const commandId = `cmd_${'a'.repeat(32)}`

describe('the API', () => {
  it('knows each kind of thread item by its content, and nothing else', () => {
    const decode = Schema.decodeUnknownSync(ThreadItem)
    const base = { id: 'i1', sequence: 1, agentId: 'codex', createdAt: at }
    assert.strictEqual(
      decode({
        ...base,
        kind: 'user_message',
        content: { text: 'Hi', links: [], pictures: [] },
        input: { state: 'queued', interrupting: false },
      }).kind,
      'user_message',
    )
    // The images the person sent with what they said, by their digests.
    const shown = decode({
      ...base,
      kind: 'user_message',
      content: {
        text: '',
        links: [],
        pictures: [{ digest: 'a'.repeat(64), mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: 'shot.png', unkept: null }],
      },
      input: null,
    })
    assert.strictEqual(shown.kind === 'user_message' && shown.content.pictures[0]?.name, 'shot.png')
    assert.throws(() => decode({ ...base, kind: 'user_message', content: { text: 'Hi', links: [] }, input: null }))
    assert.strictEqual(decode({ ...base, kind: 'agent_thought', content: { text: 'Hmm', pictures: [], files: [] } }).kind, 'agent_thought')
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
        pictures: [],
        files: [],
        output: null,
        exit: null,
      },
    })
    assert.deepStrictEqual(tool.kind === 'tool_call' && tool.content.locations, [{ path: '/w/a.ts', line: 3 }])
    // What a command printed and the pictures it handed back come with it; a picture not kept says why.
    const ran = decode({
      ...base,
      kind: 'tool_call',
      content: {
        title: 'npm test',
        toolKind: 'execute',
        status: 'failed',
        command: 'npm test',
        locations: [],
        declined: false,
        pictures: [
          { digest: null, mediaType: 'image/png', bytes: 30_000_000, width: null, height: null, name: 'big.png', unkept: 'too_large' },
        ],
        files: [{ path: '/w/docs/plan.md', how: 'wrote', mediaType: null, bytes: null, title: null }],
        output: { kept: true, lines: 12, bytes: 420, dropped: 0, error: 'Interrupted' },
        exit: 1,
      },
    })
    assert.deepStrictEqual(ran.kind === 'tool_call' && [ran.content.exit, ran.content.output?.lines], [1, 12])
    assert.throws(() =>
      decode({
        ...base,
        kind: 'agent_message',
        content: {
          text: 'Look',
          pictures: [{ digest: 'a', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: null, unkept: 'lost' }],
          files: [],
        },
      }),
    )
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
        pictures: [],
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
        leadModel: null,
        leadEffort: null,
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
    // A new project's id, made by the window, is a project's id in its own shape, and nothing else's.
    assert.strictEqual(Schema.decodeUnknownSync(NewProjectId)(`proj_${'0'.repeat(32)}`), `proj_${'0'.repeat(32)}`)
    assert.throws(() => Schema.decodeUnknownSync(NewProjectId)(commandId))
    assert.throws(() =>
      Schema.decodeUnknownSync(WatchEvent)({ _tag: 'Changed', aggregateType: 'task', aggregateId: 't', projectId: null, threadId: null }),
    )
    assert.strictEqual(PAGE, 100)
  })

  it('takes a load only as parts of the whole and bytes', () => {
    const load = { cpu: 0.5, memoryUsed: 8e9, memoryTotal: 16e9, pressure: null, shares: [], history: [] }
    const share = {
      kind: 'task',
      projectId: 'p1',
      project: 'Meridian',
      taskId: 't1',
      threadId: 'th1',
      title: 'Fix it',
      cpu: 0.2,
      memory: 1e9,
      processes: 3,
    }
    const decode = Schema.decodeUnknownSync(Load)
    assert.strictEqual(decode({ ...load, shares: [{ ...share, agent: { id: 'codex', name: 'Codex' } }] }).shares?.length, 1)
    assert.throws(() => decode({ ...load, cpu: 1.2 }))
    assert.throws(() => decode({ ...load, memoryUsed: -1 }))
    assert.throws(() => decode({ ...load, pressure: 'high' }))
    // A share has at least the one process it is.
    assert.throws(() => decode({ ...load, shares: [{ ...share, agent: null, processes: 0 }] }))
  })

  it('takes images sent with a message as bytes or a digest, as many as a message carries', () => {
    const decode = Schema.decodeUnknownSync(SentImages)
    const sent: ReadonlyArray<SentImage> = [
      { data: 'iVBORw0KGgo=', name: 'shot.png' },
      { digest: 'b'.repeat(64), name: null },
    ]
    assert.deepStrictEqual(decode(sent), sent)
    // A digest is 64 hex digits, and nothing else; neither is an image without its name.
    assert.throws(() => decode([{ digest: '../../etc/passwd', name: null }]))
    assert.throws(() => decode([{ data: 'iVBORw0KGgo=' }]))
    const one = { data: 'iVBORw0KGgo=', name: null }
    assert.strictEqual(decode(Array.from({ length: MESSAGE_IMAGES.count }, () => one)).length, MESSAGE_IMAGES.count)
    assert.throws(() => decode(Array.from({ length: MESSAGE_IMAGES.count + 1 }, () => one)))
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
              ReadFolder: () => Effect.die('unused'),
              ListTasks: () => Effect.succeed({ cursor: 0, tasks: [] }),
              CreateTask: () => Effect.die('unused'),
              GetThread: () => Effect.die('unused'),
              GetFileDiff: () => Effect.die('unused'),
              GetBoard: () => Effect.die('unused'),
              GetHome: () => Effect.die('unused'),
              LeftHome: () => Effect.die('unused'),
              Merge: () => Effect.die('unused'),
              Push: () => Effect.die('unused'),
              MergeHere: () => Effect.die('unused'),
              PushHere: () => Effect.die('unused'),
              PushBranch: () => Effect.die('unused'),
              ListEditors: () => Effect.die('unused'),
              GetLoad: () =>
                Effect.succeed({
                  cpu: 0.4,
                  memoryUsed: 8e9,
                  memoryTotal: 16e9,
                  pressure: 'normal' as const,
                  shares: null,
                  history: [{ cpu: 0.4, work: 0.1 }],
                }),
              InstallAgent: () => Effect.die('unused'),
              OpenInEditor: () => Effect.die('unused'),
              SetEffort: () => Effect.die('unused'),
              GetModels: () => Effect.die('unused'),
              SetDefaultEffort: () => Effect.die('unused'),
              SetModelBlocked: () => Effect.die('unused'),
              GetSettings: () => Effect.die('unused'),
              SetCoAuthor: () => Effect.die('unused'),
              StartAccountSignIn: () => Effect.die('unused'),
              GetAccountSignIn: () => Effect.die('unused'),
              PasteAccountSignInCode: () => Effect.die('unused'),
              CancelAccountSignIn: () => Effect.die('unused'),
              GetThreadItem: () => Effect.die('unused'),
              ReadOutput: () => Effect.die('unused'),
              ReadDocument: () => Effect.die('unused'),
              GetCoordinator: () => Effect.die('unused'),
              StartTask: () => Effect.die('unused'),
              StartPlan: () => Effect.void,
              HoldPlan: () => Effect.void,
              ChangePlan: () => Effect.void,
              ChangeIssueDraft: () => Effect.void,
              FileIssueDraft: () => Effect.void,
              DiscardIssueDraft: () => Effect.void,
              AnswerStuck: () => Effect.void,
              StartSession: ({ commandId: id }) => Effect.succeed(id),
              SwitchAgent: () => Effect.die('unused'),
              SetModel: () => Effect.void,
              Interrupt: () => Effect.void,
              StopSession: () => Effect.void,
              StopTask: () => Effect.void,
              SetTaskResolveConflicts: () => Effect.void,
              ResumeTask: () => Effect.void,
              AbandonTask: () => Effect.void,
              ReopenTask: () => Effect.void,
              // What was sent, said back in the error, so the test reads what crossed the port.
              Send: ({ body, images }) =>
                images === undefined
                  ? Effect.void
                  : Effect.fail(new ApiError({ reason: 'Echo', message: `${body}: ${images.map((image) => image.name ?? '').join(',')}` })),
              TakeBack: () => Effect.die('unused'),
              AnswerQuestion: () => Effect.void,
              Answer: () => Effect.void,
              ListConnections: () => Effect.succeed({ cursor: 0, connections: [], products: [], places: [] }),
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
              GetConnectGuide: () => Effect.die('unused'),
              FindServer: () => Effect.die('unused'),
              ConnectCli: () => Effect.die('unused'),
              CheckConnection: () => Effect.die('unused'),
              Disconnect: () => Effect.void,
              ListIssues: () => Effect.succeed({ issues: [] }),
              MarkReady: () => Effect.void,
              SetUsageLimit: () => Effect.void,
              GetProjectRules: () => Effect.die('unused'),
              GetProjectNotes: () => Effect.succeed([]),
              DropProjectNote: () => Effect.void,
              GetVocabulary: () => Effect.die('unused'),
              RenameProject: () => Effect.die('unused'),
              SetProjectInk: () => Effect.die('unused'),
              RemoveProject: () => Effect.die('unused'),
              GetRepositories: () => Effect.die('unused'),
              AddRepositories: () => Effect.die('unused'),
              LeaveOutRepository: () => Effect.die('unused'),
              SetRepository: () => Effect.die('unused'),
              SetProjectRules: () => Effect.die('unused'),
              SetProjectAccounts: () => Effect.void,
              RenameAccount: () => Effect.void,
              RemoveAccount: () => Effect.void,
              OrderAccounts: () => Effect.void,
              AddAccount: () => Effect.die('unused'),
              FindAccounts: () => Effect.succeed({ found: [] }),
              SignInAccount: () => Effect.succeed({ line: 'codex login', opened: false }),
              OpenChange: () => Effect.void,
              RefreshTask: () => Effect.void,
              StopListening: () => Effect.void,
              StopBackground: () => Effect.void,
              ClearBackground: () => Effect.void,
              RunProject: () => Effect.die('unused'),
              StopLaunch: () => Effect.void,
              ClearLaunch: () => Effect.void,
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
        // A product Althar doesn't know isn't one.
        assert.throws(() => Schema.decodeUnknownSync(Product)('gitea'))
        // Where Althar's processes can't be read, its work's part is unknown, not none.
        assert.strictEqual((yield* client.GetLoad({})).shares, null)
        const refused = yield* Effect.flip(client.OpenProject({ commandId, grant: 'g1' }))
        assert.strictEqual(refused.message, 'No folder was chosen as g1.')
        assert.deepStrictEqual(
          (yield* Stream.runCollect(client.Watch({ since: 41 }))).map((event) => event._tag === 'Changed' && event.cursor),
          [42],
        )
        // Images cross the port with what was said, bytes and digests alike.
        const echoed = yield* Effect.flip(
          client.Send({
            commandId,
            threadId: 'th1',
            body: 'Look',
            disposition: 'after_current',
            images: [
              { data: 'iVBORw0KGgo=', name: 'a.png' },
              { digest: 'c'.repeat(64), name: 'b.png' },
            ],
          }),
        )
        assert.strictEqual(echoed.message, 'Look: a.png,b.png')
        // A command without its id doesn't leave the client.
        const bad = yield* Effect.exit(client.Send({ commandId: 'cmd_nope', threadId: 'th1', body: 'Hi', disposition: 'after_current' }))
        assert.strictEqual(bad._tag, 'Failure')
      }),
    ),
  )
})
