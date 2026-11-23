import { computerCallOf, computerDecisionOf, computerOwnerOf, type ComputerDone } from '@althar/runtime/computerBridge'
import { ipcMain, type WebContents } from 'electron'

import type { ComputerSessions } from './sessions'

const task = (value: unknown): value is string => typeof value === 'string' && /^task_[0-9a-f]{32}$/.test(value)

export const handleComputerWindow = (sessions: ComputerSessions, mine: (sender: WebContents) => boolean) => {
  const handle = (name: string, use: (...args: ReadonlyArray<unknown>) => unknown) =>
    ipcMain.handle(`althar:computer-${name}`, (event, ...args: ReadonlyArray<unknown>) => {
      if (!mine(event.sender) || event.senderFrame !== event.sender.mainFrame)
        throw new Error('This window cannot control computer access.')
      return use(...args)
    })
  handle('states', () => sessions.states())
  handle('allow', (id, raw) => {
    const decision = computerDecisionOf(raw)
    return task(id) && decision !== null && sessions.allow(id, decision)
  })
  handle('control', (id, action) => {
    if (!task(id)) return false
    if (action === 'stop') return sessions.stop(id)
    if (action === 'pause') return sessions.pause(id)
    if (action === 'resume') return sessions.resume(id)
    return false
  })
}

export const computerChannel = (sessions: ComputerSessions) => {
  const requests = new Map<string, AbortController>()
  const handle = (message: unknown, reply: (request: string, done: ComputerDone) => void) => {
    if (typeof message !== 'object' || message === null) return
    const raw = message as { readonly type?: unknown; readonly id?: unknown; readonly owner?: unknown; readonly call?: unknown }
    if (raw.type === 'computer-turn-ended') {
      const owner = computerOwnerOf(raw.owner)
      if (owner !== null) sessions.ended(owner)
      return
    }
    const id = raw.id
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return
    if (raw.type === 'computer-cancel') {
      requests.get(id)?.abort()
      return
    }
    if (raw.type !== 'computer' || requests.has(id)) return
    const owner = computerOwnerOf(raw.owner)
    const call = computerCallOf(raw.call)
    if (owner === null || call === null) {
      reply(id, { error: 'That computer request was invalid.' })
      return
    }
    const controller = new AbortController()
    requests.set(id, controller)
    void sessions.call(owner, call, controller.signal).then(
      (done) => {
        requests.delete(id)
        if (!controller.signal.aborted) reply(id, done)
      },
      () => {
        requests.delete(id)
        if (!controller.signal.aborted) reply(id, { error: 'Computer use was interrupted.' })
      },
    )
  }
  const stop = (reason: string) => {
    sessions.stopAll(reason)
    for (const controller of requests.values()) controller.abort()
    requests.clear()
  }
  return { handle, stop }
}
