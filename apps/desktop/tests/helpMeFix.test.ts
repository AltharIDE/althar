import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { draftOf, setDraftText } from '../src/renderer/shared/drafts'
import { helpPrompt, useHelpMeFix } from '../src/renderer/shared/helpMeFix'

const run = {
  name: 'Mobile on iOS simulator',
  command: 'bun --filter mobile ios',
  ended: { at: 'x', code: 65, stopped: false, last: null },
}

describe('Help me fix it', () => {
  it('names the run, its exit code and where its output is', () => {
    const said = helpPrompt(run)
    expect(said).toContain('“Mobile on iOS simulator”')
    expect(said).toContain('exit code 65')
    expect(said).toContain('Output')
  })

  it('suggests it for Tab where nothing is written, and sends nothing', () => {
    const key = 'thread:help-a'
    const { result } = renderHook(() => useHelpMeFix(key, false, { current: null }))
    act(() => result.current.help(run))
    expect(result.current.suggestion).toBe(helpPrompt(run))
    expect(draftOf(key).text).toBe('')
  })

  it('goes on a new line under what is written, or while the agent works', () => {
    const key = 'thread:help-b'
    setDraftText(key, 'Also check the Podfile  ')
    const { result } = renderHook(() => useHelpMeFix(key, false, { current: null }))
    act(() => result.current.help(run))
    expect(draftOf(key).text).toBe(`Also check the Podfile\n${helpPrompt(run)}`)
    expect(result.current.suggestion).toBeUndefined()
    const busy = 'thread:help-c'
    const again = renderHook(() => useHelpMeFix(busy, true, { current: null }))
    act(() => again.result.current.help(run))
    expect(draftOf(busy).text).toBe(helpPrompt(run))
  })
})
