import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import type { ThreadItem } from '@althar/contracts'

import { ServicesProvider } from '../src/renderer/data/services'
import { useOutputs } from '../src/renderer/shared/useOutputs'
import { fakeClient, items } from './fixtures'
import { servicesFor } from './render'

/*
 * Commands' output as it streams, on a screen left open: what the store
 * has whole is no longer kept here, nor another thread's.
 */

const hook = () => {
  const fake = fakeClient()
  const services = servicesFor(fake.client)
  const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>
  const run = items.tool({ title: 'npm test', toolKind: 'execute', command: 'npm test', status: 'in_progress' })
  const view = renderHook(
    ({ threadId, shown }: { threadId: string; shown: ReadonlyArray<ThreadItem> }) => useOutputs(threadId, shown, true),
    { wrapper, initialProps: { threadId: 'th1', shown: [run] } },
  )
  return { ...fake, view, run }
}

const ended = (run: ThreadItem): ThreadItem =>
  run.kind === 'tool_call'
    ? { ...run, content: { ...run.content, status: 'completed', output: { kept: true, lines: 1, bytes: 3, dropped: 0, error: null } } }
    : run

describe('commands’ output', () => {
  it('lets go of what streamed once the store has the command whole', () => {
    const { emit, view, run } = hook()
    act(() => emit({ _tag: 'Output', threadId: 'th1', itemId: run.id, text: 'ok\n', dropped: 0 }))
    expect(view.result.current.get(run.id)?.text).toBe('ok\n')
    view.rerender({ threadId: 'th1', shown: [ended(run)] })
    expect(view.result.current.size).toBe(0)
    // Not kept behind: shown as running again, nothing of it is left.
    view.rerender({ threadId: 'th1', shown: [run] })
    expect(view.result.current.size).toBe(0)
  })

  it('lets go of a thread’s output as another shows', () => {
    const { emit, view, run } = hook()
    act(() => emit({ _tag: 'Output', threadId: 'th1', itemId: run.id, text: 'ok\n', dropped: 0 }))
    view.rerender({ threadId: 'th2', shown: [run] })
    expect(view.result.current.size).toBe(0)
  })
})
