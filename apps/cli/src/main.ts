import { mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import { agents, signInStatus } from '@charrette/provider-adapters'
import { type Instance, Live, Permissions, Projects, Runtime, Sessions } from '@charrette/runtime'
import { Cause, type Crypto, Effect, Exit, Option, Queue, Stream } from 'effect'

import { type Action, HELP, parseLine } from './input'
import { defaultProfile, defaultWorktrees, parseOptions, USAGE } from './options'
import { printer } from './printer'

const write = (text: string) => {
  if (text !== '') process.stdout.write(text)
}

const parsed = parseOptions(process.argv.slice(2), {
  profile: defaultProfile(process.env, process.platform),
  worktrees: defaultWorktrees(process.env),
})
if ('error' in parsed) {
  process.stderr.write(`${parsed.error}\n\n${USAGE}\n`)
  process.exit(2)
}
const { options } = parsed

/** The agent's own sign-in, checked before anything starts (docs/architecture/03). */
const signedIn = (agentId: string) =>
  Effect.gen(function* () {
    const agent = Object.values(agents).find((entry) => entry.id === agentId)
    if (agent === undefined) return yield* Effect.fail(`There is no agent ${agentId}. The agents are ${Object.keys(agents).join(', ')}.`)
    if ((yield* signInStatus(agent)) === 'signed_out')
      return yield* Effect.fail(`${agent.name} is not signed in. Run: ${agent.signIn.login}`)
  })

const messageOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    const { _tag, ...fields } = error as unknown as Record<string, unknown>
    return `${String(_tag)} ${JSON.stringify(fields)}`
  }
  return String(error)
}

const program = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const permissions = yield* Permissions
  const live = yield* Live

  const folder = resolve(options.folder)
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', { path: folder }), path: folder })
  write(`Project ${project.name}, ${project.repository}\n`)
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', { projectId: project.projectId, title: options.task }),
    projectId: project.projectId,
    title: options.task,
  })
  write(`Task "${options.task}" in ${task.worktree}, on ${task.branch}\n`)

  const out = printer(task.threadId)
  // Subscribed before the session starts, so the printer misses nothing.
  const events = yield* live.subscribe
  yield* Effect.forkScoped(Stream.runForEach(events, (event) => Effect.sync(() => write(out.print(event)))))
  yield* sessions.start({
    threadId: task.threadId,
    agentId: options.agent,
    ...(options.model === undefined ? {} : { model: options.model }),
  })
  write(`${HELP}\n`)

  const lines = yield* Queue.unbounded<string>()
  const input = createInterface({ input: process.stdin })
  input.on('line', (line) => Queue.offerUnsafe(lines, line))
  input.on('close', () => Queue.offerUnsafe(lines, '/quit'))
  yield* Effect.addFinalizer(() => Effect.sync(() => input.close()))

  const send = (body: string, disposition: 'after_current' | 'interrupt_and_continue') =>
    Effect.flatMap(Runtime.envelope('thread.send', { threadId: task.threadId, body, disposition }), (envelope) =>
      sessions.send({ envelope, threadId: task.threadId, body, disposition }),
    )

  /** A message sent with no agent running waits in the queue; say so, rather than leave it silent. */
  const idleWarning = Effect.flatMap(sessions.running(task.threadId), (running) =>
    Effect.sync(() => {
      if (Option.isNone(running)) write('No agent is running; your message waits for one. Start one with /agent <id>.\n')
    }),
  )

  const handle = (action: Action): Effect.Effect<'quit' | undefined, unknown, Instance | Crypto.Crypto> => {
    switch (action._tag) {
      case 'Say':
        return Effect.as(Effect.andThen(send(action.text, 'after_current'), idleWarning), undefined)
      case 'Interrupt':
        return Effect.as(Effect.andThen(send(action.text, 'interrupt_and_continue'), idleWarning), undefined)
      case 'Model':
        return Effect.as(sessions.setModel({ threadId: task.threadId, model: action.model }), undefined)
      case 'Agent':
        return Effect.gen(function* () {
          yield* signedIn(action.agent)
          yield* sessions.switchAgent({
            threadId: task.threadId,
            agentId: action.agent,
            ...(action.model === undefined ? {} : { model: action.model }),
          })
          return undefined
        })
      case 'Answer': {
        const attentionId = out.waiting
        if (attentionId === undefined)
          return Effect.as(
            Effect.sync(() => write('No question is waiting.\n')),
            undefined,
          )
        return Effect.gen(function* () {
          const envelope = yield* Runtime.envelope('attention.answer', { attentionId, decision: action.decision })
          yield* permissions.answer({
            envelope,
            attentionId,
            decision: action.decision,
            ...(action.reason === undefined ? {} : { reason: action.reason }),
          })
          return undefined
        })
      }
      case 'Stop':
        return Effect.as(sessions.stop(task.threadId), undefined)
      case 'Quit':
        return Effect.succeed('quit')
      case 'Help':
        return Effect.as(
          Effect.sync(() => write(`${HELP}\n`)),
          undefined,
        )
      case 'Unknown':
        return Effect.as(
          Effect.sync(() => write(`${action.message}\n`)),
          undefined,
        )
      case 'Nothing':
        return Effect.succeed(undefined)
    }
  }

  for (;;) {
    const outcome = yield* Effect.exit(handle(parseLine(yield* Queue.take(lines))))
    if (Exit.isFailure(outcome)) write(`! ${messageOf(outcome.cause)}\n`)
    else if (outcome.value === 'quit') return
  }
})

mkdirSync(options.profile, { recursive: true })
const layer = Runtime.layer({
  database: join(options.profile, 'charrette.sqlite'),
  worktreeRoot: options.worktrees,
  accountsRoot: join(options.profile, 'accounts'),
  appVersion: '0.0.0',
  deviceName: hostname(),
})

const stop = new AbortController()
process.once('SIGINT', () => {
  write('\nStopping the session…\n')
  stop.abort()
})

const exit = await Effect.runPromiseExit(Effect.andThen(signedIn(options.agent), Effect.scoped(program).pipe(Effect.provide(layer))), {
  signal: stop.signal,
})
if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
  process.stderr.write(`${messageOf(exit.cause)}\n`)
  process.exit(1)
}
process.exit(0)
