import { Effect, Schema } from 'effect'

import { Errands } from './Errands'
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
    description:
      'Read this live turn’s origin, byPerson and the ids of its messages from the person. Only those messages or an open errand can authorize an asked-for tool.',
    input: { type: 'object', properties: {} },
    call: (_input, access) => Effect.map(errands.turn(access), JSON.stringify),
  },
  {
    name: 'keep_errand',
    description:
      'Keep what the person asked for later, from a message id in this turn. Each ordered step binds its tool, semantic arguments, target, head, branch, task and what it waits on. Only the window or a paired device gives the person’s word. No action happens now.',
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
              taskId: { type: 'string' },
              target: { type: 'string' },
              head: { type: 'string' },
              branch: { type: 'string' },
              request: { type: 'object' },
              waits: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { kind: { type: 'string' }, target: { type: 'string' }, since: { type: 'string' } },
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
