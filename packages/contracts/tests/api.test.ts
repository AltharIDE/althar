import { MessageChannel } from 'node:worker_threads'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Schema, Stream } from 'effect'
import { RpcClient, RpcServer } from 'effect/rpc'

import {
  AgentsAtOnce,
  Api,
  ApiError,
  AtOnceCount,
  CommandId,
  FOUND_MOST,
  GraphRound,
  Load,
  NewProjectId,
  PAGE,
  Product,
  type SentImage,
  SentImages,
  TaskCard,
  ThreadItem,
  WatchEvent,
} from '../src/Api'
import { MESSAGE_IMAGES } from '../src/pictures'
import { clientProtocol, emitterPort, serverProtocol } from '../src/transport'

const at = '2026-09-29T12:00:00.000Z'
const commandId = `cmd_${'a'.repeat(32)}`

describe('the API', () => {
  it('takes from one to sixteen agents at once, whole, and says why the default is what it is', () => {
    const count = Schema.decodeUnknownSync(AtOnceCount)
    assert.strictEqual(count(1), 1)
    assert.strictEqual(count(16), 16)
    for (const wrong of [0, 17, 2.5, '4', null]) assert.throws(() => count(wrong), undefined, undefined, String(wrong))
    const settings = Schema.decodeUnknownSync(AgentsAtOnce)
    assert.deepStrictEqual(settings({ count: 2, own: 2, machine: { count: 4, cores: 10, memory: 16 } }).machine, {
      count: 4,
      cores: 10,
      memory: 16,
    })
    assert.throws(() => settings({ count: 4, own: 0, machine: { count: 4, cores: 10, memory: 16 } }))
  })

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
        built: null,
        evidence: [],
        unverified: [],
        agentId: 'codex',
        change: null,
      },
    })
    assert.strictEqual(review.kind === 'step_result' && review.content.findings.length, 1)
    // The lead's, with what it showed: a test run, and what it couldn't show.
    const implement = decode({
      ...base,
      kind: 'step_result',
      content: {
        step: 'implement',
        round: 0,
        summary: 'Added the retry.',
        verdict: null,
        findings: [],
        built: 'A retry button on a failed checkout.',
        evidence: [{ kind: 'test_run', caption: 'The tests', picture: null, command: 'bun test', exit: 0, text: '1 passed', dropped: 0 }],
        unverified: ['Not tried in Safari'],
        agentId: null,
        change: null,
      },
    })
    assert.strictEqual(implement.kind === 'step_result' && implement.content.evidence[0]?.exit, 0)
    assert.throws(() =>
      decode({
        ...base,
        kind: 'step_result',
        content: { ...(implement.content as object), evidence: [{ kind: 'video', caption: 'x' }] },
      }),
    )
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
        logs: [],
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
        kind: 'change',
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
        queued: null,
      },
    })
    assert.strictEqual(task.kind === 'task' && task.content.plan?.steps.length, 2)
    assert.throws(() => decode({ ...base, kind: 'task', content: { taskId: 't1' } }))
  })

  it('says what a task makes on its card: a plain task with what it handed back, a review with the pull request it reads', () => {
    const card = Schema.decodeUnknownSync(TaskCard)
    const plain = {
      taskId: 't2',
      threadId: 'th2',
      title: 'Which partners still call v1?',
      slug: 'which-partners-still-call-v1',
      phase: 'ready',
      kind: 'plain',
      plan: null,
      issue: null,
      change: null,
      step: null,
      summary: 'Two do.',
      lead: 'claude-code',
      leadModel: null,
      leadEffort: null,
      branch: null,
      startedAt: at,
      waits: null,
      queued: null,
    }
    const picture = { digest: 'a'.repeat(64), mediaType: 'image/png', bytes: 10, width: 4, height: 3, name: 'home.png', unkept: null }
    const handed = card({
      ...plain,
      handed: {
        pictures: [picture],
        files: [
          { path: 'notes/partners.md', add: 12 },
          { path: '/tmp/x.csv', add: null },
        ],
      },
    })
    assert.deepStrictEqual(
      handed.handed?.files.map((file) => file.add),
      [12, null],
    )
    // Older runtimes said nothing of either.
    assert.strictEqual(card(plain).handed, undefined)
    // A file says the lines it added, or that git can't say.
    assert.throws(() => card({ ...plain, handed: { pictures: [], files: [{ path: 'a.md' }] } }))
    assert.throws(() => card({ ...plain, kind: 'question' }))
    assert.throws(() => card({ ...plain, kind: undefined }))
    const brief = {
      product: 'github',
      repository: 'meridian/api',
      number: 1199,
      url: 'https://github.com/meridian/api/pull/1199',
      title: 'Send back won’t restart a dead lead session',
      author: 'ninemate',
      outside: true,
      additions: 58,
      deletions: 20,
      findings: 3,
      blocking: 1,
      verdict: 'changes',
      posted: null,
    }
    assert.strictEqual(card({ ...plain, kind: 'review', reviewing: brief }).reviewing?.author, 'ninemate')
    assert.strictEqual(card({ ...plain, kind: 'review', reviewing: { ...brief, verdict: null, additions: null } }).reviewing?.verdict, null)
    assert.throws(() => card({ ...plain, kind: 'review', reviewing: { ...brief, verdict: 'request_changes' } }))
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

  it('takes a task’s rounds of work only with steps of the graph’s kinds and states', () => {
    const decode = Schema.decodeUnknownSync(GraphRound)
    const step = {
      id: 'node_1',
      key: 'review',
      iteration: 1,
      state: 'held',
      hold: 'machine_busy',
      agentId: 'codex',
      model: 'gpt-5.2',
      startedAt: null,
      endedAt: null,
      added: false,
    }
    const round = { id: 'run_1', followUp: true, createdAt: at, endedAt: null, said: null, changedAt: null, steps: [step] }
    assert.strictEqual(decode(round).steps[0]?.hold, 'machine_busy')
    // What started a follow-up: the person's message, or what the coordinator passed on.
    assert.isTrue(decode({ ...round, said: { itemId: 'i1', text: 'One more thing', relayed: true } }).said?.relayed)
    assert.throws(() => decode({ ...round, steps: [{ ...step, key: 'verify' }] }))
    assert.throws(() => decode({ ...round, steps: [{ ...step, state: 'stuck' }] }))
    assert.throws(() => decode({ ...round, steps: [{ ...step, iteration: 0.5 }] }))
    assert.throws(() => decode({ ...round, steps: [{ ...step, hold: 'tired' }] }))
  })

  it('takes a load only as parts of the whole and bytes', () => {
    const load = { cpu: 0.5, memoryUsed: 8e9, memoryTotal: 16e9, pressure: null, shares: [], althar: null, history: [] }
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
    // Althar itself, as its own part.
    assert.deepStrictEqual(decode({ ...load, althar: { cpu: 0.03, memory: 1e9, processes: 9 } }).althar, {
      cpu: 0.03,
      memory: 1e9,
      processes: 9,
    })
    assert.throws(() => decode({ ...load, althar: { cpu: 1.5, memory: 1e9, processes: 9 } }))
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
              SearchTasks: ({ text, projectId }) =>
                Effect.succeed({
                  tasks: [
                    {
                      taskId: 'task_1',
                      threadId: 'th1',
                      projectId: projectId ?? 'p1',
                      title: 'Retry the checkout',
                      slug: 'retry-the-checkout',
                      phase: 'ready' as const,
                      state: 'open',
                      pullRequest: '#143',
                      changedAt: '2026-10-14T09:00:00.000Z',
                      matched: [
                        { text: '…the card ', hit: false },
                        { text, hit: true },
                      ],
                    },
                  ],
                }),
              CreateTask: () => Effect.die('unused'),
              GetThread: () => Effect.die('unused'),
              GetFileDiff: () => Effect.die('unused'),
              GetBoard: () => Effect.die('unused'),
              GetOlderSettled: () => Effect.die('unused'),
              GetHome: () => Effect.die('unused'),
              LeftHome: () => Effect.die('unused'),
              SeeTask: () => Effect.die('unused'),
              Merge: () => Effect.die('unused'),
              ClosePullRequest: () => Effect.die('unused'),
              Push: () => Effect.die('unused'),
              ReplacePullRequest: () => Effect.die('unused'),
              MergeNote: () => Effect.die('unused'),
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
                  althar: null,
                  history: [{ cpu: 0.4, work: 0.1 }],
                }),
              GetPlanUsage: () => Effect.succeed({ accounts: [] }),
              GetModelRooms: () => Effect.succeed([]),
              InstallAgent: () => Effect.die('unused'),
              OpenInEditor: () => Effect.die('unused'),
              SetEffort: () => Effect.die('unused'),
              GetModels: () => Effect.die('unused'),
              SetDefaultEffort: () => Effect.die('unused'),
              SetModelBlocked: () => Effect.die('unused'),
              GetSettings: () => Effect.die('unused'),
              SetCoAuthor: () => Effect.die('unused'),
              SetPostTeamReviews: () => Effect.die('unused'),
              GetAutomations: () => Effect.die('unused'),
              GetAutomation: () => Effect.die('unused'),
              MakeAutomation: () => Effect.die('unused'),
              ChangeAutomation: () => Effect.die('unused'),
              TurnOnAutomation: () => Effect.die('unused'),
              PauseAutomation: () => Effect.die('unused'),
              RunAutomationNow: () => Effect.die('unused'),
              DeleteAutomation: () => Effect.die('unused'),
              UndoAutomationChange: () => Effect.die('unused'),
              SetAutomationPostsReviews: () => Effect.die('unused'),
              SetAutomationsPaused: () => Effect.die('unused'),
              SetAgentsAtOnce: () => Effect.die('unused'),
              SetFolderWait: () => Effect.die('unused'),
              GetTaskFolders: () => Effect.die('unused'),
              CleanUpFolders: () => Effect.die('unused'),
              RemoveTaskFolder: () => Effect.die('unused'),
              MoveInLine: () => Effect.die('unused'),
              LineOldestFirst: () => Effect.die('unused'),
              StartAccountSignIn: () => Effect.die('unused'),
              GetAccountSignIn: () => Effect.die('unused'),
              PasteAccountSignInCode: () => Effect.die('unused'),
              CancelAccountSignIn: () => Effect.die('unused'),
              GetThreadItem: () => Effect.die('unused'),
              ReadOutput: () => Effect.die('unused'),
              ReadDocument: () => Effect.die('unused'),
              FindCode: () => Effect.die('unused'),
              ReadCode: () => Effect.die('unused'),
              OpenCode: () => Effect.die('unused'),
              GetCoordinator: () => Effect.die('unused'),
              StartTask: () => Effect.die('unused'),
              StartPlan: () => Effect.void,
              HoldPlan: () => Effect.void,
              ChangePlan: () => Effect.void,
              ChangeIssueDraft: () => Effect.void,
              FileIssueDraft: () => Effect.void,
              DiscardIssueDraft: () => Effect.void,
              ApplyIssueChanges: () => Effect.void,
              DiscardIssueChanges: () => Effect.void,
              ChangeReviewDraft: () => Effect.void,
              PostReviewDraft: () => Effect.void,
              DiscardReviewDraft: () => Effect.void,
              AnswerStuck: () => Effect.void,
              HandOverHeld: () => Effect.void,
              StartSession: ({ commandId: id }) => Effect.succeed(id),
              SwitchAgent: () => Effect.die('unused'),
              SetModel: () => Effect.void,
              Interrupt: () => Effect.void,
              TryAgain: () => Effect.void,
              CompactContext: () => Effect.void,
              StopSession: () => Effect.void,
              StopTask: () => Effect.void,
              SetTaskResolveConflicts: () => Effect.void,
              ResolveConflictsNow: () => Effect.void,
              LookForConflicts: () => Effect.void,
              SetTaskAllowEverything: () => Effect.void,
              ResumeTask: () => Effect.void,
              LeaveOutCommits: () => Effect.void,
              AbandonTask: () => Effect.void,
              MarkTaskDone: () => Effect.void,
              KeepTaskForLater: () => Effect.void,
              RenameTask: () => Effect.void,
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
              EditProjectNote: () => Effect.void,
              GetVocabulary: () => Effect.die('unused'),
              RenameProject: () => Effect.die('unused'),
              SetProjectInk: () => Effect.die('unused'),
              GetProjectTracker: () => Effect.die('unused'),
              SetProjectTracker: () => Effect.die('unused'),
              ListContainers: () => Effect.die('unused'),
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
              SkipReview: () => Effect.void,
              RefreshTask: () => Effect.void,
              StopListening: () => Effect.void,
              AttachPullRequest: () =>
                Effect.succeed({ kind: 'attached' as const, name: 'PR #1', source: 'main', started: false, kept: 0, own: 0 }),
              ReadBackgroundOutput: () => Effect.succeed({ text: '', dropped: 0 }),
              StopBackground: () => Effect.void,
              ClearBackground: () => Effect.void,
              RunProject: () => Effect.die('unused'),
              KeepRunnable: () => Effect.die('unused'),
              DropRunnable: () => Effect.void,
              OrderRunnables: () => Effect.void,
              GetRepositoryScripts: () => Effect.succeed([]),
              GetRunnableRefs: () => Effect.succeed([]),
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
        // A search crosses with what matched; one asking for too many, or for pages of text, never leaves.
        const [found] = (yield* client.SearchTasks({ text: 'retr', projectId: 'p2' })).tasks
        assert.deepStrictEqual([found?.projectId, found?.matched?.[1]], ['p2', { text: 'retr', hit: true }])
        assert.isTrue((yield* Effect.exit(client.SearchTasks({ text: 'retr', limit: FOUND_MOST + 1 })))._tag === 'Failure')
        assert.isTrue((yield* Effect.exit(client.SearchTasks({ text: 'x'.repeat(501) })))._tag === 'Failure')
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
