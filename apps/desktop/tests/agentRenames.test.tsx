import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { heardRename, useAgentRename } from '../src/renderer/data/agentRenames'

/* The title an agent last gave a task, as the feed tells it, and who clears it. */

describe('agent renames', () => {
  it('is the title an agent gave that task, and no other task’s', () => {
    const one = renderHook(() => useAgentRename('task_a'))
    const other = renderHook(() => useAgentRename('task_b'))
    act(() => heardRename('task_a', 'Repair sessions', true))
    expect(one.result.current).toBe('Repair sessions')
    expect(other.result.current).toBeNull()
  })

  it('is cleared by a person’s rename, in this window or another', () => {
    const one = renderHook(() => useAgentRename('task_c'))
    act(() => heardRename('task_c', 'By agent', true))
    act(() => heardRename('task_c', 'By person', false))
    expect(one.result.current).toBeNull()
  })

  it('knows nothing of a task not given', () => {
    expect(renderHook(() => useAgentRename(null)).result.current).toBeNull()
  })
})
