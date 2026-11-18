import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DraftComposer } from '../src/renderer/shared/DraftComposer'
import { draftOf, setDraftFiles, setDraftText } from '../src/renderer/shared/drafts'
import { helpPrompt, tailOf, useHelpMeFix } from '../src/renderer/shared/helpMeFix'

const run = {
  name: 'Mobile on iOS simulator',
  command: 'bun --filter mobile ios',
  ended: { at: 'x', code: 65, stopped: false, last: null },
}
const printed = () => Promise.resolve('Building…\nerror: no such module Foo')
const noRef = { current: null }

describe('Help me fix it', () => {
  it('names the run and its exit code, and carries the end of its output', () => {
    const said = helpPrompt(run, tailOf('a\nb\nerror: no such module Foo\n'))
    expect(said).toContain('“Mobile on iOS simulator”')
    expect(said).toContain('exit code 65')
    expect(said).toContain('error: no such module Foo')
    expect(helpPrompt(run)).toContain('no longer kept')
    expect(tailOf(Array.from({ length: 100 }, (_, n) => `l${n}`).join('\n')).split('\n')).toHaveLength(40)
  })

  it('suggests it for Tab where nothing is written, and sends nothing', async () => {
    const key = 'thread:help-a'
    const { result } = renderHook(() => useHelpMeFix(key, false, noRef))
    await act(async () => result.current.help(run, printed))
    expect(result.current.suggestion).toContain('no such module Foo')
    expect(draftOf(key).text).toBe('')
  })

  it('goes on a new line under what is written, with a file attached, or while the agent works', async () => {
    const key = 'thread:help-b'
    setDraftText(key, 'Also check the Podfile  ')
    const { result } = renderHook(() => useHelpMeFix(key, false, noRef))
    await act(async () => result.current.help(run, printed))
    expect(draftOf(key).text).toBe(`Also check the Podfile\n${helpPrompt(run, 'Building…\nerror: no such module Foo')}`)
    expect(result.current.suggestion).toBeUndefined()
    const busy = renderHook(() => useHelpMeFix('thread:help-c', true, noRef))
    await act(async () => busy.result.current.help(run, printed))
    expect(draftOf('thread:help-c').text).toContain('exit code 65')
    setDraftFiles('thread:help-d', () => [{ id: 'f' }])
    const attached = renderHook(() => useHelpMeFix('thread:help-d', false, noRef))
    await act(async () => attached.result.current.help(run, printed))
    expect(draftOf('thread:help-d').text).toContain('exit code 65')
    expect(attached.result.current.suggestion).toBeUndefined()
  })

  it('falls back to pointing at Output where the output can’t be read', async () => {
    const key = 'thread:help-e'
    const { result } = renderHook(() => useHelpMeFix(key, false, noRef))
    await act(async () => result.current.help(run, () => Promise.reject(new Error('gone'))))
    expect(result.current.suggestion).toBe(helpPrompt(run))
    // A card kept past a restart: the output is gone, and the prompt says so, with the line the card kept.
    expect(helpPrompt({ ...run, ended: { ...run.ended, last: 'Error: Port 5173 is already in use' } })).toContain(
      'no longer kept; the last line it printed was: Error: Port 5173 is already in use',
    )
    expect(helpPrompt(run)).not.toContain('Output on its run card')
  })

  it('in the real composer: grey for Tab, taken into the field by Tab, and never sent', async () => {
    const key = 'thread:help-f'
    const onSend = vi.fn()
    const input = createRef<HTMLTextAreaElement>()
    function Screen() {
      const help = useHelpMeFix(key, false, input)
      return (
        <>
          <button type="button" onClick={() => help.help(run, printed)}>
            help
          </button>
          <DraftComposer
            draft={key}
            placeholder="Say"
            inputRef={input}
            onSubmit={onSend}
            {...(help.suggestion === undefined ? {} : { suggestion: help.suggestion })}
          />
        </>
      )
    }
    render(<Screen />)
    await userEvent.click(screen.getByRole('button', { name: 'help' }))
    const field = await screen.findByRole('textbox')
    await vi.waitFor(() => expect((field as HTMLTextAreaElement).placeholder).toContain('exit code 65'))
    await userEvent.tab()
    expect((field as HTMLTextAreaElement).value).toContain('exit code 65')
    expect(onSend).not.toHaveBeenCalled()
  })
})
