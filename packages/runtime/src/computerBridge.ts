import { Option, Schema } from 'effect'

const words = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max), Schema.isPattern(/^[^\0]+$/))
const uuid = Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/))
const target = Schema.Union([uuid, Schema.Literal('desktop')])
const pixel = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 32767 }))
const point = Schema.Struct({ x: pixel, y: pixel })
const element = Schema.String.check(Schema.isPattern(/^e[1-9][0-9]{0,3}$/))
const position = Schema.Union([Schema.Struct({ element }), point])
const key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_+.-]{1,32}$/))
const snapshot = { target, observation: uuid, foreground: Schema.optional(Schema.Boolean) }

const call = Schema.Union([
  Schema.Struct({ op: Schema.Literal('status') }),
  Schema.Struct({ op: Schema.Literal('request'), reason: words(360), desktop: Schema.optional(Schema.Boolean) }),
  Schema.Struct({ op: Schema.Literal('launch'), app: uuid }),
  Schema.Struct({ op: Schema.Literal('observe'), target, screenshot: Schema.optional(Schema.Boolean) }),
  Schema.Struct({
    op: Schema.Literal('click'),
    ...snapshot,
    at: position,
    button: Schema.optional(Schema.Literals(['left', 'middle', 'right'])),
    double: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ op: Schema.Literal('type'), ...snapshot, text: words(12_000), at: Schema.optional(position) }),
  Schema.Struct({ op: Schema.Literal('key'), ...snapshot, keys: Schema.Array(key).check(Schema.isMinLength(1), Schema.isMaxLength(5)) }),
  Schema.Struct({ op: Schema.Literal('scroll'), ...snapshot, at: point, direction: Schema.Literals(['up', 'down', 'left', 'right']) }),
  Schema.Struct({ op: Schema.Literal('drag'), ...snapshot, from: point, to: point }),
  Schema.Struct({ op: Schema.Literal('evidence'), target, caption: words(240) }),
  Schema.Struct({ op: Schema.Literal('release') }),
])

export type ComputerCall = typeof call.Type
const json = Schema.toJsonSchemaDocument(call)
export const computerInput = { type: 'object', ...json.schema, $defs: json.definitions }
export const computerCallOf = (value: unknown): ComputerCall | null =>
  Option.getOrNull(Schema.decodeUnknownOption(call, { onExcessProperty: 'error' })(value))

/** Taken from the authenticated tool session, never from its arguments. */
const owner = Schema.Struct({
  taskId: Schema.String.check(Schema.isPattern(/^task_[0-9a-f]{32}$/)),
  sessionId: words(100),
  threadId: words(100),
  turnId: words(100),
  title: words(240),
})
export type ComputerOwner = typeof owner.Type
export const computerOwnerOf = (value: unknown): ComputerOwner | null => Option.getOrNull(Schema.decodeUnknownOption(owner)(value))

export interface ComputerPicture {
  readonly data: string
  readonly mimeType: 'image/png' | 'image/jpeg'
}

export interface ComputerAnswer {
  readonly text: string
  readonly picture?: ComputerPicture
}

export type ComputerDone = { readonly value: ComputerAnswer } | { readonly error: string }

export interface ComputerWindow {
  readonly id: string
  readonly app: string
  readonly title: string
}

export interface ComputerState {
  readonly taskId: string
  readonly threadId: string
  readonly title: string
  readonly phase: 'asking' | 'active' | 'paused' | 'stopped'
  readonly windows: ReadonlyArray<ComputerWindow>
  readonly desktop: boolean
  readonly foreground: boolean
  readonly action: string
  readonly request?: {
    readonly id: string
    readonly desktop: boolean
    readonly reason: string
    readonly windows: ReadonlyArray<ComputerWindow>
    readonly apps: ReadonlyArray<{ readonly id: string; readonly app: string }>
  }
  readonly preview?: { readonly target: string; readonly picture: ComputerPicture }
}

const decision = Schema.Struct({
  requestId: uuid,
  windows: Schema.Array(uuid).check(Schema.isMaxLength(40)),
  desktop: Schema.Boolean,
  foreground: Schema.Boolean,
})
export type ComputerDecision = typeof decision.Type
export const computerDecisionOf = (value: unknown): ComputerDecision | null =>
  Option.getOrNull(Schema.decodeUnknownOption(decision, { onExcessProperty: 'error' })(value))
