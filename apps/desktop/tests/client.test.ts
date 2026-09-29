// @vitest-environment node
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ApiError, emitterPort, type WatchEvent } from '@charrette/contracts'
import { serve } from '@charrette/runtime'
import { Effect, Exit, Layer, Scope } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'

import { connect, messageOf, receivePort } from '../src/renderer/data/client'
import { fakeAgents } from '../src/runtime/fakeAgents'
import { repository } from './repository'

/*
 * The window's client against the real runtime, over a message channel as
 * the app has it, with the fake agent leading.
 */

const scopes: Array<Scope.Closeable> = []
afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void))
})

const connected = async () => {
  const channel = new MessageChannel()
  const scope = await Effect.runPromise(Scope.make())
  scopes.push(scope)
  await Effect.runPromise(
    Layer.buildWithScope(
      serve(
        emitterPort(channel.port1 as never, (data) => data),
        {
          database: ':memory:',
          worktreeRoot: mkdtempSync(join(tmpdir(), 'charrette-worktrees-')),
          appVersion: '0.0.0-test',
          deviceName: 'Test Mac',
          agents: fakeAgents,
        },
      ),
      scope,
    ),
  )
  return connect(channel.port2)
}

const eventually = async <A>(read: () => Promise<A>, check: (value: A) => boolean): Promise<A> => {
  for (let tries = 0; tries < 250; tries += 1) {
    const value = await read()
    if (check(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out')
}

describe('the client', () => {
  it('opens a project, starts a task, talks to its lead, and hears what changes', async () => {
    const client = await connected()
    const events: Array<WatchEvent> = []
    const unwatch = client.watch((event) => events.push(event))

    expect((await client.status()).agents.map((agent) => [agent.name, agent.signIn])).toEqual([
      ['Claude Code', 'signed_in'],
      ['Codex', 'signed_in'],
    ])
    const project = await client.openProject(repository())
    expect(await client.listProjects()).toHaveLength(1)
    const task = await client.createTask({ projectId: project.id, title: 'Say hello' })
    expect((await client.listTasks(project.id)).map((each) => each.title)).toEqual(['Say hello'])
    await client.startSession({ threadId: task.threadId, agentId: 'claude-code' })
    await eventually(
      () => client.getThread(task.threadId),
      (thread) => thread.session?.turnRunning === false && thread.items.length > 0,
    )

    await client.send({ threadId: task.threadId, body: 'hello', disposition: 'after_current' })
    const thread = await eventually(
      () => client.getThread(task.threadId),
      (snapshot) => snapshot.items.some((item) => (item.content as { text?: string }).text === 'Hello'),
    )
    expect(thread.session?.agentName).toBe('Claude Code')
    await eventually(
      async () => events,
      (seen) => seen.some((event) => event._tag === 'Changed' && event.projectId === project.id),
    )
    expect(events.some((event) => event._tag === 'Streaming' && event.threadId === task.threadId)).toBe(true)

    await client.setModel({ threadId: task.threadId, model: 'large' })
    await client.interrupt(task.threadId)
    await client.switchAgent({ threadId: task.threadId, agentId: 'codex' })
    await client.stopSession(task.threadId)
    unwatch()
    await client.close()
  })

  it('rejects with what went wrong, in words', async () => {
    const client = await connected()
    const failure = await client.openProject('/no/such/folder').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect(messageOf(failure)).not.toBe('')
    await expect(client.answer({ attentionId: 'nothing', decision: 'allow' })).rejects.toBeInstanceOf(ApiError)
    await client.close()
  })
})

describe('messages', () => {
  it('says what went wrong, whatever was thrown', () => {
    expect(messageOf(new ApiError({ reason: 'NotARepository', message: 'Not a repository' }))).toBe('Not a repository')
    expect(messageOf(new Error('Broken'))).toBe('Broken')
    expect(messageOf('plain')).toBe('plain')
  })

  it('takes the port the preload hands on, and nothing else', async () => {
    const target = new EventTarget()
    const received = receivePort(target)
    const { port1 } = new MessageChannel()
    target.dispatchEvent(new MessageEvent('message', { data: 'something else', ports: [port1] }))
    target.dispatchEvent(new MessageEvent('message', { data: 'charrette:port' }))
    target.dispatchEvent(new MessageEvent('message', { data: 'charrette:port', ports: [port1] }))
    expect(await received).toBe(port1)
    port1.close()
  })
})
