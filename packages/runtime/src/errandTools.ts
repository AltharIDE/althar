import { Effect, Schema } from 'effect'

import { Errands } from './Errands'
import { errandWaitKinds } from './errandWaits'
import type { Tool } from './ToolServer'
import { ToolRefused } from './toolErrors'

const Step = Schema.Struct({
  key: Schema.String,
  tool: Schema.String,
  taskId: Schema.optional(Schema.String),
  target: Schema.String,
  head: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  request: Schema.Record(Schema.String, Schema.Unknown),
  waits: Schema.Array(Schema.Struct({ kind: Schema.String, target: Schema.String, since: Schema.optional(Schema.String) })),
})
const Kept = Schema.Struct({ message: Schema.String, steps: Schema.Array(Step) })
const Changed = Schema.Struct({ errand: Schema.String, message: Schema.optional(Schema.String), reason: Schema.optional(Schema.String) })
const decode = <S extends Schema.Top>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => new ToolRefused({ message: 'The errand arguments do not match the tool’s input.' })),
  )

/** Record and manage waits only. Acting tools are later tasks. */
export const errandTools = (errands: typeof Errands.Service): ReadonlyArray<Tool> => [
  {
    name: 'read_turn',
    inReview: true,
    description:
      'Read this live turn’s origin, byPerson and the ids of its messages from the person. Only those messages or an open errand can authorize an asked-for tool.',
    input: { type: 'object', properties: {} },
    call: (_input, access) => Effect.map(errands.turn(access), JSON.stringify),
  },
  {
    name: 'keep_errand',
    description: `Keep what the person asked for later, from their message id in this turn (read_turn). Steps run in order. taskId accepts any task’s slug or internal id in this project. Each step needs key, tool, target, request (the tool’s semantic arguments only; no message/errand/step), and nonempty waits [{kind, target}]. Watched kinds: ${errandWaitKinds.join(', ')}; other kinds are refused. For "once the task’s PR is ready and green, merge it, then tag its merge commit vX", keep these two steps: {key:"merge",tool:"merge_pull_request",taskId:"<slug>",target:"task:<slug>",request:{},waits:[{kind:"task_pull_request",target:"<slug>"}]} then {key:"tag",tool:"push_tag",taskId:"<slug>",target:"<owner/repo> tag vX",request:{tag:"vX",commit:"task:<slug>"},waits:[{kind:"task_merged",target:"<slug>"}]}. Omit head and branch for these task references: the merge watcher binds the PR when ready, checks its gates, and wakes you with merge_pull_request {errand,step:"merge"}; after that step confirms the merge, the tag watcher wakes you with the tag call. No further person message is needed. For an already known merge, use merge_pull_request on their message and the head you read; it keeps the concrete merge errand for you. Other release steps bind the targets and requests their tools describe: checks/post-merge/required-check-missing target a commit; run targets a tag whose run needs approval; draft targets a tag whose draft exists. merge_line/merge_queue/merge_train/merge_in_flight and checks are the concrete merge watcher’s waits. Only a window or paired-device message gives their word. No action happens while keeping.`,
    input: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              tool: { type: 'string' },
              taskId: {
                type: 'string',
                description: 'The task slug from list_tasks/read_task, or its internal id. Any task in this project.',
              },
              target: { type: 'string' },
              head: { type: 'string' },
              branch: { type: 'string' },
              request: { type: 'object' },
              waits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { kind: { type: 'string', enum: errandWaitKinds }, target: { type: 'string' }, since: { type: 'string' } },
                  required: ['kind', 'target'],
                },
              },
            },
            required: ['key', 'tool', 'target', 'request', 'waits'],
          },
        },
      },
      required: ['message', 'steps'],
    },
    call: (input, access) => Effect.flatMap(decode(Kept, input), (kept) => errands.keep(access, kept.message, kept.steps)),
  },
  {
    name: 'read_errands',
    description: 'Read this thread’s open errands, including their ids, words, steps, heads and waits.',
    input: { type: 'object', properties: {} },
    call: (_input, access) => errands.list(access),
  },
  ...(['pause', 'resume', 'cancel'] as const).map((how): Tool => ({
    name: `${how}_errand`,
    description: `${how === 'pause' ? 'Pause an errand for an objection and say why. Resume needs the person’s fresh word.' : how === 'resume' ? 'Resume a paused errand on a fresh message from the person in this turn.' : 'Call off an errand on the person’s message in this turn.'}`,
    input: {
      type: 'object',
      properties: { errand: { type: 'string' }, message: { type: 'string' }, reason: { type: 'string' } },
      required: ['errand', ...(how === 'pause' ? ['reason'] : ['message'])],
    },
    call: (input, access) =>
      Effect.flatMap(decode(Changed, input), (changed) =>
        how === 'pause'
          ? errands.pause(access, changed.errand, changed.reason ?? 'An objection needs the person’s word again.')
          : how === 'resume'
            ? errands.resume(access, changed.errand, changed.message ?? '')
            : errands.cancel(access, changed.errand, changed.message ?? ''),
      ),
  })),
]
