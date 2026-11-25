import { Option, Result, Schema, SchemaIssue } from 'effect'

const words = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max), Schema.isPattern(/^[^\0]+$/))
const UUID = /^[0-9a-f-]{36}$/
const uuid = Schema.String.check(Schema.isPattern(UUID))
const target = Schema.Union([uuid, Schema.Literal('desktop')])
const pixel = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 32767 }))
const point = Schema.Struct({ x: pixel, y: pixel })
const element = Schema.String.check(Schema.isPattern(/^e[1-9][0-9]{0,3}$/))
const position = Schema.Union([Schema.Struct({ element }), point])
const key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_+.-]{1,32}$/))
const snapshot = { target, observation: uuid, foreground: Schema.optional(Schema.Boolean) }

/** Each operation, and how to call it, for a lead that called it wrong. */
const ops = {
  status: [Schema.Struct({ op: Schema.Literal('status') }), '{"op":"status"}'],
  request: [
    Schema.Struct({ op: Schema.Literal('request'), reason: words(360) }),
    '{"op":"request","reason":"Read today’s tasks in Akiflow"}',
  ],
  // An app by the id a request or status gave it, or by its name, bundle id or path: any installed app, running or not.
  launch: [Schema.Struct({ op: Schema.Literal('launch'), app: words(240) }), '{"op":"launch","app":"Akiflow"}'],
  observe: [
    Schema.Struct({ op: Schema.Literal('observe'), target, screenshot: Schema.optional(Schema.Boolean) }),
    '{"op":"observe","target":"<window id>"} or {"op":"observe","target":"desktop"}',
  ],
  click: [
    Schema.Struct({
      op: Schema.Literal('click'),
      ...snapshot,
      at: position,
      button: Schema.optional(Schema.Literals(['left', 'middle', 'right'])),
      double: Schema.optional(Schema.Boolean),
    }),
    '{"op":"click","target":"<window id>","observation":"<observation id>","at":{"element":"e4"}} or "at":{"x":120,"y":40}',
  ],
  type: [
    Schema.Struct({ op: Schema.Literal('type'), ...snapshot, text: words(12_000), at: Schema.optional(position) }),
    '{"op":"type","target":"<window id>","observation":"<observation id>","text":"hello","at":{"element":"e2"}}',
  ],
  key: [
    Schema.Struct({ op: Schema.Literal('key'), ...snapshot, keys: Schema.Array(key).check(Schema.isMinLength(1), Schema.isMaxLength(5)) }),
    '{"op":"key","target":"desktop","observation":"<observation id>","keys":["cmd","space"]} or "keys":["return"]',
  ],
  scroll: [
    Schema.Struct({ op: Schema.Literal('scroll'), ...snapshot, at: point, direction: Schema.Literals(['up', 'down', 'left', 'right']) }),
    '{"op":"scroll","target":"<window id>","observation":"<observation id>","at":{"x":300,"y":400},"direction":"down"}',
  ],
  drag: [
    Schema.Struct({ op: Schema.Literal('drag'), ...snapshot, from: point, to: point }),
    '{"op":"drag","target":"<window id>","observation":"<observation id>","from":{"x":10,"y":10},"to":{"x":200,"y":10}}',
  ],
  evidence: [
    Schema.Struct({ op: Schema.Literal('evidence'), target, caption: words(240) }),
    '{"op":"evidence","target":"<window id>","caption":"Akiflow’s Today list"}',
  ],
  release: [Schema.Struct({ op: Schema.Literal('release') }), '{"op":"release"}'],
} as const

const call = Schema.Union([
  ops.status[0],
  ops.request[0],
  ops.launch[0],
  ops.observe[0],
  ops.click[0],
  ops.type[0],
  ops.key[0],
  ops.scroll[0],
  ops.drag[0],
  ops.evidence[0],
  ops.release[0],
])

export type ComputerCall = typeof call.Type
const json = Schema.toJsonSchemaDocument(call)
export const computerInput = { type: 'object', ...json.schema, $defs: json.definitions }
export const computerCallOf = (value: unknown): ComputerCall | null =>
  Option.getOrNull(Schema.decodeUnknownOption(call, { onExcessProperty: 'error' })(value))

/** Whether an app is named by the id Althar gave it, rather than by its name, bundle id or path. */
export const isComputerId = (value: string) => UUID.test(value)

const format = SchemaIssue.makeFormatterDefault()
const plainly = (line: string) =>
  line
    .replaceAll(`a string matching the RegExp ${UUID.source}`, 'an id Althar gave (a UUID) or "desktop"')
    .replaceAll('a string matching the RegExp ^e[1-9][0-9]{0,3}$', 'an element reference such as "e4"')
    .replaceAll('a string matching the RegExp ^[A-Za-z0-9_+.-]{1,32}$', 'a key name such as "cmd", "space" or "return"')

const POINT = 'a point {"x":120,"y":40} in whole pixels of the latest screenshot'
const PLACES: Readonly<Record<string, string>> = {
  at: `an element of the latest observation, {"element":"e4"}, or ${POINT}`,
  from: POINT,
  to: POINT,
}

/** What is wrong with a call that isn't one, in words a lead can correct it by: the field, what it needs, and an example. */
export const computerCallProblem = (value: unknown): string => {
  const known = Object.keys(ops).join(', ')
  const op = typeof value === 'object' && value !== null && 'op' in value ? (value as { readonly op: unknown }).op : undefined
  if (op === undefined) return `Give op, one of: ${known}. Start with {"op":"status"}.`
  if (typeof op !== 'string' || !Object.hasOwn(ops, op)) return `"${String(op)}" isn't a computer operation. op is one of: ${known}.`
  const [schema, example] = ops[op as keyof typeof ops]
  const decoded = Schema.decodeUnknownResult(schema as Schema.Codec<unknown>, { onExcessProperty: 'error', errors: 'all' })(value)
  const issue = Result.isFailure(decoded) ? decoded.failure.issue : undefined
  const lines = issue === undefined ? [] : format(issue).split('\n')
  const fields = value as Record<string, unknown>
  // The formatter gives a message, then the field it is at, in pairs.
  const problems = new Map<string, string>()
  for (let at = 0; at < lines.length; at++) {
    const message = plainly(lines[at]!.trim())
    const field = lines[at + 1]?.trim().match(/^at (.+)$/)?.[1]
    if (field !== undefined) at++
    const keys = [...(field ?? '').matchAll(/\[(?:"([^"]+)"|(\d+))\]/g)].map((one) => one[1] ?? Number(one[2]))
    const top = String(keys[0] ?? '')
    const name = keys.map((one, index) => (typeof one === 'number' ? `[${one}]` : index === 0 ? one : `.${one}`)).join('')
    // A place is an element or a point: one line for it, rather than one for each it could have been.
    const place = op === 'scroll' && top === 'at' ? POINT : PLACES[top]
    if (place !== undefined && fields[top] !== undefined) {
      problems.set(top, `${top}: ${place}, got ${JSON.stringify(fields[top]).slice(0, 80)}`)
      continue
    }
    const given = keys.reduce<unknown>(
      (inside, one) => (typeof inside === 'object' && inside !== null ? (inside as Record<string, unknown>)[one] : undefined),
      value,
    )
    if (message === 'Missing key') problems.set(name, `${name} is missing`)
    else if (message === 'Expected no excess property') problems.set(name, `${op} takes no ${name}`)
    else {
      const got = given === undefined || /^Expected .*, got /.test(message) ? '' : `, got ${JSON.stringify(given).slice(0, 80)}`
      problems.set(name, name === '' ? message : `${name}: ${message}${got}`)
    }
  }
  return `${op}: ${[...problems.values()].join('; ') || 'its arguments are invalid'}. For example ${example}.`
}

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
  /** One ask, whether the task may use this computer for its turn: why, and whether its grant would take in the primary display. */
  readonly request?: {
    readonly id: string
    readonly primaryDisplay: boolean
    readonly reason: string
  }
  readonly preview?: { readonly target: string; readonly picture: ComputerPicture }
}

/** The person's answer to that ask: yes lets the task use any app, foreground input and the display it may share, for its turn. */
const decision = Schema.Struct({ requestId: uuid, allow: Schema.Boolean })
export type ComputerDecision = typeof decision.Type
export const computerDecisionOf = (value: unknown): ComputerDecision | null =>
  Option.getOrNull(Schema.decodeUnknownOption(decision, { onExcessProperty: 'error' })(value))
